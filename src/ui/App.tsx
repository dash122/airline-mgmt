import { createComputeClient } from './compute-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, BASES } from '../data/airports';
import { AIRCRAFT } from '../data/aircraft';
import { addRoundTrip, cycleOf, emptyPlan, hhmm, localMinutes, newAircraft, routePairs, simulate, utcFromLocal, type NetworkResult, type Plan } from '../sim/simulate';
import { closeRoute, leaseFor, removeOneRoundTrip, unitOf, type Unit } from '../sim/schedule';
import MapCanvas, { LF_COLORS, type Selection, type Theme } from './MapCanvas';
import { AircraftSheet, ResultsSheet, RouteSheet } from './sheets';
import { AirportSheet, AirportsPanel } from './airports';
import { airlines } from '../sim/competitors';
import { AirlineLink, AirlineSheet, AirlinesPanel } from './airlines';
import { AddFlightSheet, FleetPanel, FlightEditor, GapSheet, LeaseSheet, RoutesPanel, SchedulePanel } from './panels';
import { money } from './format';
import { NewRouteSheet, type NewRouteState } from './NewRoute';
import { dayAt, GameClock, HISTORY_DAYS, newGame, SPEEDS, type DayRecord, type GameState, type Speed } from './clock';

const SAVE_KEY = 'waypoint.plan.v2';
const GAME_KEY = 'waypoint.game.v1';
const THEME_KEY = 'waypoint.theme';

function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

type Panel = 'routes' | 'airports' | 'airlines' | 'schedule' | 'fleet' | 'report' | null;
type Overlay =
  | { kind: 'edit'; acId: string; leg: number }
  | { kind: 'add'; key: string; prefer?: { from: string; dep: number; acId?: string; gap?: number }; returnGap?: { acId: string; t: number } }
  | { kind: 'move'; acId: string; unit: Unit; key: string }
  | { kind: 'gap'; acId: string; t: number }
  | { kind: 'lease' }
  | ({ kind: 'new' } & NewRouteState)
  | null;

export default function App() {
  const [plan, setPlan] = useState<Plan | null>(() => {
    const p = load<Plan>(SAVE_KEY);
    if (!p || p.version !== 2 || !AIRPORT_BY_CODE[p.base]) return null;
    return { ...p, hub: p.hub && AIRPORT_BY_CODE[p.hub] ? p.hub : undefined,
      fleet: p.fleet.map(ac => ({ ...ac, legs: ac.legs.filter(l => AIRPORT_BY_CODE[l.from] && AIRPORT_BY_CODE[l.to]) })) };
  });
  const [theme, setTheme] = useState<Theme>(() => load<Theme>(THEME_KEY) ?? 'day');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [game, setGame] = useState<GameState | null>(() => {
    const g = load<GameState>(GAME_KEY);
    return g && g.version === 1 ? g : null;
  });
  const clockRef = useRef<GameClock | null>(null);
  if (plan && !clockRef.current) clockRef.current = new GameClock((game ?? newGame(plan.base)).utcMin);
  const [speed, setSpeedState] = useState<Speed>(1);
  const [simulation, setSimulation] = useState<{ plan: Plan; result: NetworkResult } | null>(null);
  const simulationWorker = useRef<Worker | null>(null);
  const simulationId = useRef(0);
  useEffect(() => {
    if (!plan?.fleet.length) return;
    const worker = simulationWorker.current ??= createComputeClient('simulation');
    const id = ++simulationId.current;
    const onMessage = (event: MessageEvent<{ id: number; result?: NetworkResult; error?: string }>) => {
      if (event.data.id === id && event.data.result) setSimulation({ plan, result: event.data.result });
      else if (event.data.id === id && event.data.error) console.error('Simulation failed:', event.data.error);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, plan });
    return () => worker.removeEventListener('message', onMessage);
  }, [plan]);
  useEffect(() => () => { simulationWorker.current?.terminate(); simulationWorker.current = null; }, []);
  const result = simulation?.plan === plan ? simulation.result : null;
  const selectedRouteKey = selection?.kind === 'route' ? selection.id : undefined;
  // Keep route detail metrics in sync with the current itinerary while the worker
  // computes the full network result used by the map and other panels.
  const liveRouteResult = useMemo(() => plan && selectedRouteKey && routePairs(plan).some((r) => r.key === selectedRouteKey) ? simulate(plan) : null, [plan, selectedRouteKey]);
  const resultRef = useRef(result);
  resultRef.current = result;
  const [panel, setPanel] = useState<Panel>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [transitHint, setTransitHint] = useState<[string, string][] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [schedAirport, setSchedAirport] = useState<{ airport: string } | null>(null);
  /** Where the airline profile was opened from, for its back button. */
  const [back, setBack] = useState<Selection | null>(null);
  const [airlineRoute, setAirlineRoute] = useState<string | null>(null);

  useEffect(() => { if (plan) save(SAVE_KEY, plan); }, [plan]);
  useEffect(() => { if (game) save(GAME_KEY, game); }, [game]);

  // Time runs on its own. At each local midnight at the base, book that day's results.
  useEffect(() => {
    if (!plan) return;
    const base = plan.base;
    const tick = () => {
      const clock = clockRef.current;
      if (!clock) return;
      const now = clock.now();
      setGame((g) => {
        const cur = g ?? newGame(base);
        const lastDay = dayAt(base, cur.utcMin);
        const today = dayAt(base, now);
        if (today <= lastDay) return g ? g : cur;
        const r = resultRef.current;
        // Never book a day using an incomplete or outdated simulation.
        if (plan.fleet.length && !r) return g ? g : cur;
        const history = [...cur.history];
        let balance = cur.balance;
        let last = { revenue: 0, cost: 0 };
        for (let d = Math.max(lastDay, today - 7); d < today; d++) {
          last = { revenue: (r?.revenue ?? 0) / 7, cost: (r?.cost ?? 0) / 7 };
          balance += last.revenue - last.cost;
          history.push({ day: d, ...last, pax: (r?.pax ?? 0) / 7 });
        }
        if (r) setToast(`第 ${today - 1} 天結算：${last.revenue >= last.cost ? '+' : ''}${money(last.revenue - last.cost)}`);
        return { version: 1, utcMin: now, balance, history: history.slice(-HISTORY_DAYS) };
      });
    };
    const id = setInterval(tick, 250);
    // Pause while the tab is hidden, so days do not pass unseen.
    let resumeTo: Speed | null = null;
    const vis = () => {
      const clock = clockRef.current;
      if (!clock) return;
      if (document.hidden) { resumeTo = clock.speed; clock.setSpeed(0); }
      else if (resumeTo !== null) { clock.setSpeed(resumeTo); resumeTo = null; }
    };
    document.addEventListener('visibilitychange', vis);
    const persist = () => { const c = clockRef.current; if (c) setGame((g) => (g ? { ...g, utcMin: Math.max(g.utcMin, c.now()) } : g)); };
    window.addEventListener('pagehide', persist);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', persist); };
  }, [plan?.base, !!plan?.fleet.length]);
  useEffect(() => { save(THEME_KEY, theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!plan || !clockRef.current) return <StartScreen onPick={(base) => {
    const g = newGame(base);
    clockRef.current = new GameClock(g.utcMin, 1);
    setSpeedState(1);
    setGame(g);
    setPlan(emptyPlan(base));
    setOverlay({ kind: 'new', from: base, to: null, pick: 'to' });
  }} />;
  const clock = clockRef.current;
  const setSpeed = (s: Speed) => { clock.setSpeed(s); setSpeedState(s); };

  const update = (next: Plan) => setPlan(next);
  const select = (s: Selection | null) => { setSelection(s); setOverlay(null); setBack(null); setAirlineRoute(null); };
  const openAirline = (id: string) => {
    const from = selection && selection.kind !== 'airline' ? selection : null;
    select({ kind: 'airline', id });
    setBack(from);
  };
  /** From the airline profile to an airport or route, with a way back to the airline. */
  const fromAirline = (s: Selection) => { const prev = selection; select(s); setBack(prev); };
  const openTab = (p: Panel) => { setSelection(null); setOverlay(null); setPanel(p); if (p !== 'schedule') setSchedAirport(null); };
  /** The new-route planner: pick two airports, see what the route would earn, confirm. */
  const planRoute = (from: string, to: string | null = null) => {
    setSelection(null);
    setOverlay({ kind: 'new', from, to: to === from ? null : to, pick: to && to !== from ? null : 'to' });
  };
  const newRoute = overlay?.kind === 'new' ? overlay : null;

  const addTrip = (a: string, b: string, type?: AircraftModel, stay = false) => {
    const r = addRoundTrip(plan, a, b, type);
    if ('error' in r) { setToast(r.error); return; }
    update(r.plan);
    const isNew = !plan.fleet.some((ac) => ac.id === r.aircraftId);
    const added = r.plan.fleet.find((ac) => ac.id === r.aircraftId)!;
    const reg = added.reg;
    const cadence = cycleOf(added) > 1 ? `每 ${cycleOf(added)} 天一班來回` : '每日一班來回';
    setToast(isNew ? `租了 ${reg}，${cadence}` : `${reg} 加飛一班來回`);
    if (!stay) select({ kind: 'route', id: [a, b].sort().join('-') });
  };
  const removeOne = (key: string) => {
    const next = removeOneRoundTrip(plan, key, localMinutes);
    if (!next) { setToast('沒有完整的來回航班，請到班表調整'); return; }
    update(next);
    setToast('已減一班來回');
  };

  const routeKey = selection?.kind === 'route' ? selection.id : undefined;
  const routeExists = routeKey && routePairs(plan).some((r) => r.key === routeKey);
  const aircraft = selection?.kind === 'aircraft' ? plan.fleet.find((a) => a.id === selection.id) : undefined;
  const airport = selection?.kind === 'airport' ? selection.id : undefined;
  const airlineId = selection?.kind === 'airline' ? selection.id : undefined;
  const backToAirline = back?.kind === 'airline' ? <button className="back" onClick={() => openAirline(back.id)}>‹ {airlineLabel(back.id)}</button> : undefined;
  const backLabel = (s: Selection) => (s.kind === 'airport' ? s.id : s.kind === 'route' ? s.id.replace('-', '⇄') : s.kind === 'aircraft' ? plan.fleet.find((a) => a.id === s.id)?.reg ?? '飛機' : '航空');
  const editing = overlay?.kind === 'edit' ? plan.fleet.find((a) => a.id === overlay.acId) : undefined;
  const editingUnit = editing && overlay?.kind === 'edit' && editing.legs[overlay.leg] ? unitOf(editing, overlay.leg) : null;
  const schedSel = editing && editingUnit ? { acId: editing.id, legs: Array.from({ length: editingUnit.count }, (_, k) => editingUnit.start + k) } : null;
  const showPanel = !selection && !newRoute && panel;

  return (
    <AirlineLink.Provider value={openAirline}>
    <div className="app">
      <MapCanvas
        plan={plan}
        result={result}
        clock={clock}
        selection={selection ?? (editing ? { kind: 'aircraft', id: editing.id } : newRoute ? { kind: 'airport', id: newRoute.to && !newRoute.pick ? newRoute.to : newRoute.from } : null)}
        connectFrom={newRoute?.from ?? null}
        hint={airport || newRoute ? transitHint : null}
        theme={theme}
        airline={airlineId ? { id: airlineId, route: airlineRoute } : null}
        onTapAirport={(code) => {
          // While the planner is open, a tap on the map fills in the airport it is asking for.
          if (newRoute) {
            const field = newRoute.pick ?? 'to';
            if (field === 'from') setOverlay({ ...newRoute, from: code, to: newRoute.to === code ? null : newRoute.to, pick: newRoute.to && newRoute.to !== code ? null : 'to' });
            else if (code !== newRoute.from) setOverlay({ ...newRoute, to: code, pick: null });
          }
          else select({ kind: 'airport', id: code });
        }}
        onTapRoute={(key) => select({ kind: 'route', id: key })}
        onTapEmpty={() => { if (newRoute) return; if (selection) select(null); else openTab(null); }}
        onDragRoute={(a, b) => planRoute(a, b)}
      />

      <TopBar result={result} balance={game?.balance ?? 0} history={game?.history ?? []} theme={theme} onTheme={() => setTheme(theme === 'day' ? 'night' : 'day')}
        onReset={() => {
          if (confirmReset()) { setPlan(null); setGame(null); clockRef.current = null; select(null); setPanel(null); try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }
        }} />
      <ClockBar clock={clock} base={plan.base} speed={speed} onSpeed={setSpeed} />

      {toast && <div className="toast">{toast}</div>}
      {result && !selection && !overlay && !panel && (
        <div className="map-legend" aria-label="地圖圖例：航線顏色是載客率，越粗旅客越多">
          <span><i style={{ background: LF_COLORS.good }} />80%+</span>
          <span><i style={{ background: LF_COLORS.ok }} />60%</span>
          <span><i style={{ background: LF_COLORS.bad }} />低</span>
          <span className="w"><i className="thin" /><i className="thick" />客量</span>
        </div>
      )}

      {routeKey && routeExists && (
        <RouteSheet key={routeKey} plan={plan} routeKey={routeKey} result={liveRouteResult?.routes[routeKey]} net={liveRouteResult}
          onFare={(mult) => update({ ...plan, fares: { ...plan.fares, [routeKey]: mult } })}
          onAdd={() => setOverlay({ kind: 'add', key: routeKey })}
          onRemoveOne={() => removeOne(routeKey)}
          onEditFlight={(acId, leg) => setOverlay({ kind: 'edit', acId, leg })}
          onCloseRoute={() => { update(closeRoute(plan, routeKey)); setToast('已停飛'); select(null); }}
          action={backToAirline}
          onClose={() => select(null)} />
      )}
      {aircraft && (
        <AircraftSheet key={aircraft.id} plan={plan} ac={aircraft} result={result?.aircraft[aircraft.id]}
          onChange={(ac) => update({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) })}
          onRemove={() => { update({ ...plan, fleet: plan.fleet.filter((x) => x.id !== aircraft.id) }); setToast(`已退租 ${aircraft.reg}`); select(null); }}
          onEditFlight={(leg) => setOverlay({ kind: 'edit', acId: aircraft.id, leg })}
          onAddHere={() => setOverlay({ kind: 'gap', acId: aircraft.id, t: aircraft.legs.length ? aircraft.legs[aircraft.legs.length - 1].dep + 60 : utcMorning(plan.base) })}
          onClose={() => select(null)} />
      )}
      {airport && (
        <AirportSheet key={airport} plan={plan} result={result} code={airport}
          onConnect={() => planRoute(airport)}
          onOpen={(to: string) => planRoute(airport, to)}
          onOpenPair={(a: string, b: string) => addTrip(a, b, undefined, true)}
          onSuggest={(from: string, to: string, local: number) => setOverlay({ kind: 'add', key: [from, to].sort().join('-'), prefer: { from, dep: utcFromLocal(from, local) } })}
          onOpenRoute={(key) => select({ kind: 'route', id: key })}
          onToggleHub={() => {
            const on = plan.hub === airport;
            update({ ...plan, hub: on ? undefined : airport });
            setToast(on ? '已取消轉運站' : `${AIRPORT_BY_CODE[airport].name}設為轉運站`);
          }}
          onShowSchedule={() => { setSchedAirport({ airport }); setSelection(null); setPanel('schedule'); }}
          onPickAirport={(code) => select({ kind: 'airport', id: code })}
          onHint={setTransitHint}
          action={backToAirline}
          onClose={() => select(null)} />
      )}
      {airlineId && (
        <AirlineSheet key={airlineId} plan={plan} result={result} id={airlineId} focus={airlineRoute} onFocus={setAirlineRoute}
          onPickAirport={(code) => fromAirline({ kind: 'airport', id: code })}
          onOpenRoute={(key) => fromAirline({ kind: 'route', id: key })}
          onOpen={(a, b) => planRoute(a, b)}
          back={back ? { label: backLabel(back), go: () => { const b = back; select(b); } } : undefined}
          onClose={() => select(null)} />
      )}
      {showPanel === 'airlines' && (
        <AirlinesPanel plan={plan} onPick={openAirline} onClose={() => openTab(null)} />
      )}
      {showPanel === 'routes' && (
        <RoutesPanel plan={plan} result={result} onOpen={(key) => select({ kind: 'route', id: key })} onNew={() => planRoute(plan.hub ?? plan.base)}
          onAdd={(key) => setOverlay({ kind: 'add', key })} onRemoveOne={removeOne} onClose={() => openTab(null)} />
      )}
      {showPanel === 'airports' && (
        <AirportsPanel plan={plan} result={result} onPick={(code) => select({ kind: 'airport', id: code })} onClose={() => openTab(null)} />
      )}
      {showPanel === 'schedule' && (
        <SchedulePanel key={schedAirport?.airport ?? 'all'} plan={plan} result={result} now={clock.now()} selected={schedSel} preset={schedAirport}
          onPickLeg={(acId, leg) => setOverlay({ kind: 'edit', acId, leg })}
          onGap={(acId, t) => setOverlay({ kind: 'gap', acId, t })}
          onClose={() => openTab(null)} />
      )}
      {showPanel === 'fleet' && (
        <FleetPanel plan={plan} result={result} onPick={(id) => select({ kind: 'aircraft', id })} onLease={() => setOverlay({ kind: 'lease' })} onClose={() => openTab(null)} />
      )}
      {showPanel === 'report' && result && (
        <ResultsSheet result={result} history={game?.history ?? []} balance={game?.balance ?? 0} onPick={(key) => select({ kind: 'route', id: key })} onClose={() => openTab(null)} />
      )}

      {overlay?.kind === 'edit' && (
        <FlightEditor plan={plan} result={result} acId={overlay.acId} leg={overlay.leg}
          onChange={(next, msg) => { update(next); if (msg) setToast(msg); }}
          onMove={(acId, unit) => { const l = plan.fleet.find((x) => x.id === acId)!.legs[unit.start]; setOverlay({ kind: 'move', acId, unit, key: [l.from, l.to].sort().join('-') }); }}
          onClose={() => setOverlay(null)} />
      )}
      {(overlay?.kind === 'add' || overlay?.kind === 'move') && (
        <AddFlightSheet key={JSON.stringify(overlay)} plan={plan} routeKey={overlay.key} move={overlay.kind === 'move' ? { acId: overlay.acId, unit: overlay.unit } : undefined} prefer={overlay.kind === 'add' ? overlay.prefer : undefined}
          onDone={(next, msg) => { update(next); setToast(msg); setOverlay(null); }}
          onClose={() => setOverlay(overlay.kind === 'move' ? { kind: 'edit', acId: overlay.acId, leg: overlay.unit.start } : overlay.returnGap ? { kind: 'gap', ...overlay.returnGap } : null)} />
      )}
      {newRoute && (
        <NewRouteSheet plan={plan} result={result} state={newRoute}
          onState={(s) => setOverlay({ kind: 'new', ...s })}
          onHint={setTransitHint}
          onDone={(next, msg, key) => { update(next); setToast(msg); setOverlay(null); setTransitHint(null); setSelection({ kind: 'route', id: key }); }}
          onClose={() => { setOverlay(null); setTransitHint(null); }} />
      )}
      {overlay?.kind === 'gap' && (
        <GapSheet plan={plan} acId={overlay.acId} t={overlay.t}
          onChoose={(key, prefer) => setOverlay({ kind: 'add', key, prefer, returnGap: { acId: overlay.acId, t: overlay.t } })}
          onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'lease' && (
        <LeaseSheet plan={plan} onClose={() => setOverlay(null)}
          onLease={(type, to) => {
            if (to) {
              const r = leaseFor(plan, plan.base, to, type);
              update(r.plan);
              setToast(`租了 ${r.plan.fleet.find((x) => x.id === r.aircraftId)!.reg}（${AIRCRAFT[type].name}），${cycleOf(r.plan.fleet.find((x) => x.id === r.aircraftId)!) > 1 ? '長程，每幾天' : '每日'}來回${AIRPORT_BY_CODE[to].name}`);
            } else {
              const ac = newAircraft(plan, type);
              update({ ...plan, fleet: [...plan.fleet, ac] });
              setToast(`租了 ${ac.reg}，到班表排航班`);
            }
            setOverlay(null);
          }} />
      )}

      {!selection && (panel === 'fleet' || panel === 'schedule' || panel === 'report' || panel === 'airports' || panel === 'airlines') && (
        <nav className="subnav" aria-label="分類">
          {(panel === 'fleet' || panel === 'schedule'
            ? [['fleet', '飛機'], ['schedule', '班表']]
            : [['report', '報表'], ['airports', '機場'], ['airlines', '對手']]).map(([p, label]) => (
              <button key={p} className={panel === p ? 'on' : ''} disabled={p === 'report' && !result} onClick={() => openTab(p as Panel)}>{label}</button>
            ))}
        </nav>
      )}
      <nav className="tabbar" aria-label="主要導覽">
        {([[null, '地圖'], ['routes', '航線'], ['fleet', '機隊'], ['report', '經營']] as [Panel, string][]).map(([p, label]) => {
          const active = !selection && (p === 'fleet' ? panel === 'fleet' || panel === 'schedule' : p === 'report' ? panel === 'report' || panel === 'airports' || panel === 'airlines' : panel === p);
          return <button key={label} className={active ? 'on' : ''} onClick={() => openTab(p === 'report' && !result ? 'airports' : p)} aria-current={active ? 'page' : undefined}>
            <TabIcon tab={p} /><span>{label}</span>
          </button>;
        })}
      </nav>
    </div>
    </AirlineLink.Provider>
  );
}

const airlineLabel = (id: string) => airlines().find((a) => a.id === id)?.name ?? '航空';
const utcMorning = (code: string) => utcFromLocal(code, 7 * 60);

function TabIcon({ tab }: { tab: Panel }) {
  const d = {
    map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14',
    routes: 'M5 18c4-10 10-10 14-12 M5 18a2 2 0 1 0 0.01 0 M19 6a2 2 0 1 0 0.01 0',
    schedule: 'M3 6h18 M3 12h18 M3 18h18 M6 4v4 M12 10v4 M9 16v4 M17 4v4 M15 10v4',
    airports: 'M12 3a5 5 0 0 1 5 5c0 4-5 10-5 10S7 12 7 8a5 5 0 0 1 5-5z M12 6.5a1.6 1.6 0 1 0 0.01 0 M5 21h14',
    fleet: 'M2 13l8-2 2-7h2l-1 7 8 1v2l-8 1 1 4-2 1-3-4-7-1z',
    report: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
    airlines: 'M4 20h16 M6 20l4-16h3l-1 8h6l2 8',
  }[tab ?? 'map'];
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ClockBar({ clock, base, speed, onSpeed }: { clock: GameClock; base: string; speed: Speed; onSpeed: (s: Speed) => void }) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 500); return () => clearInterval(id); }, []);
  const now = clock.now();
  return (
    <div className="clockbar">
      <span className="when">第 {dayAt(base, now)} 天 <b>{hhmm(localMinutes(base, now))}</b></span>
      <div className="speed" role="group" aria-label="時間速度">
        {SPEEDS.map((sp) => (
          <button key={sp} className={speed === sp ? 'on' : ''} onClick={() => onSpeed(sp)} aria-label={sp === 0 ? '暫停' : `${sp} 倍速`}>
            {sp === 0 ? '❚❚' : `${sp}×`}
          </button>
        ))}
      </div>
    </div>
  );
}

function confirmReset() {
  return window.confirm('要清除目前的航線網並重新選擇基地嗎？');
}

function StartScreen({ onPick }: { onPick: (base: string) => void }) {
  return (
    <div className="start">
      <div className="start-card">
        <div className="start-intro"><div className="start-brand"><span className="brand-mark" aria-hidden="true">✳</span> WAYPOINT <small>AIRLINE MANAGEMENT</small></div><div className="start-kicker">AIRLINE MANAGEMENT</div><h1>經營航線，<br /><em>連接城市。</em></h1><p>選擇基地，規劃航線與航班。</p><div className="start-decoration" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit-plane">✈</span><span className="orbit-caption">ROUTE PLANNING<br />AIRLINE MANAGEMENT</span></div></div>
        <div className="start-choice"><div className="eyebrow">選擇基地</div>
        <div className="logo">航點<span>Waypoint</span></div>
        <p>開航線、租飛機、排班表，在真實地圖上和其他航空搶旅客。目標：收入大於成本。</p>
        <h2>選擇你的基地</h2>
        <div className="base-grid">
          {BASES.map((c) => (
            <button key={c} onClick={() => onPick(c)}>
              <span className="base-icon" aria-hidden="true">↗</span>
              <strong>{AIRPORT_BY_CODE[c].name}</strong>
              <span>{c}</span>
            </button>
          ))}
        </div>
        <p className="fine">需求由人口與機場規模推估，僅供遊戲使用。資料來源：OurAirports、GeoNames（CC BY 4.0）、Natural Earth。</p>
        </div>
      </div>
    </div>
  );
}

function TopBar({ result, balance, history, theme, onTheme, onReset }: { result: NetworkResult | null; balance: number; history: DayRecord[]; theme: Theme; onTheme: () => void; onReset: () => void }) {
  const estimate = result ? (result.revenue - result.cost) / 7 : null;
  const last = history.at(-1);
  return (
    <div className="topbar">
      <div className="dashboard-brand"><span className="dashboard-mark" aria-hidden="true">✳</span><span><strong>航點</strong><small>WAYPOINT AIRLINES</small></span></div>
      <div className="kpi main"><span className="label">累計損益</span><span className={`value ${balance >= 0 ? 'good' : 'bad'}`}>{money(balance)}</span></div>
      <div className="kpi" title={last ? `上日已結算 ${money(last.revenue - last.cost)}` : '尚未結算'}><span className="label">預估損益／日</span><span className={`value ${estimate === null ? '' : estimate >= 0 ? 'good' : 'bad'}`}>{estimate === null ? '—' : money(estimate)}</span></div>
      <div className="top-actions">
        <button onClick={onTheme} aria-label="切換主題">{theme === 'day' ? '夜' : '日'}</button>
        <button onClick={onReset} aria-label="重新開始">↺</button>
      </div>
    </div>
  );
}
