import { createComputeClient } from './compute-client';
import { useEffect, useRef, useState } from 'react';
import { type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, BASES } from '../data/airports';
import { AIRCRAFT } from '../data/aircraft';
import { marketsReady, prepareMarkets } from '../sim/markets';
import { addRoundTrip, airlineName, cycleOf, emptyPlan, hasCodeshare, hhmm, localMinutes, newAircraft, routePairs, setCodeshareShare, setHostedShare, toggleHosted, toggleCodeshare, utcFromLocal, warmCompetition, type NetworkResult, type Plan } from '../sim/simulate';
import { CodeshareLink, CodeshareSheet } from './codeshare';
import { HostedLink, HostedSheet } from './hosted';
import { closeRoute, leaseFor, removeOneRoundTrip, unitOf, type Unit } from '../sim/schedule';
import MapCanvas, { LF_COLORS, type Selection, type Theme } from './MapCanvas';
import { AircraftSheet, ResultsSheet, RouteSheet, Sheet, SheetNavContext, routeName, type SheetNav, type SheetSize } from './sheets';
import { AirportSheet, AirportsPanel } from './airports';
import { airlines } from '../sim/competitors';
import { AirlineLink, AirlineSheet, AirlinesPanel, type Section as AirlineSection } from './airlines';
import { AddFlightSheet, FleetPanel, FlightEditor, GapSheet, LeaseSheet, RoutesPanel, SchedulePanel, type RoutesView } from './panels';
import { hkSigned, money } from './format';
import { NewRouteSheet, type NewRouteState } from './NewRoute';
import { dayAt, GameClock, HISTORY_DAYS, newGame, SPEEDS, type DayRecord, type GameState, type Speed } from './clock';

const SAVE_KEY = 'waypoint.plan.v2';
const GAME_KEY = 'waypoint.game.v1';
const THEME_KEY = 'waypoint.theme';
/**
 * Longest the background build of the demand model holds the main thread at a time: short while the player is only
 * looking at the map, longer once a view is waiting for it (still short enough for taps and scrolling to go through).
 */
const MARKET_SLICE_MS = 8, MARKET_SLICE_WAITING_MS = 40;

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

type Panel = 'routes' | 'airports' | 'airlines' | 'schedule' | 'fleet';
/** A page pushed over the home sheet: a route, airport, aircraft or airline, or the money report. */
type Page = (Selection & { full?: boolean }) | { kind: 'report' };
/** How the last page change should move: slide in, slide back, rise from the map, or not at all. */
type NavMove = 'push' | 'back' | 'rise' | 'none';
type Overlay =
  | { kind: 'edit'; acId: string; leg: number }
  | { kind: 'add'; key: string; prefer?: { from: string; dep: number; acId?: string; gap?: number }; returnGap?: { acId: string; t: number } }
  | { kind: 'move'; acId: string; unit: Unit; key: string }
  | { kind: 'gap'; acId: string; t: number }
  | { kind: 'lease' }
  | { kind: 'codeshare'; airline: string; key: string; focus?: string }
  | { kind: 'hosted'; key: string; airline?: string }
  | ({ kind: 'new' } & NewRouteState)
  | null;

export default function App() {
  const [plan, setPlan] = useState<Plan | null>(() => {
    const p = load<Plan>(SAVE_KEY);
    if (!p || p.version !== 2 || !AIRPORT_BY_CODE[p.base]) return null;
    return { ...p, hub: p.hub && AIRPORT_BY_CODE[p.hub] ? p.hub : undefined,
      codeshares: (p.codeshares ?? []).filter((c) => c.key.split('-').every((x) => AIRPORT_BY_CODE[x])),
      hosted: (p.hosted ?? []).filter((c) => c.key.split('-').every((x) => AIRPORT_BY_CODE[x])),
      fleet: p.fleet.map(ac => ({ ...ac, legs: ac.legs.filter(l => AIRPORT_BY_CODE[l.from] && AIRPORT_BY_CODE[l.to]) })) };
  });
  const [theme, setTheme] = useState<Theme>(() => load<Theme>(THEME_KEY) ?? 'day');
  const [stack, setStack] = useState<Page[]>([]);
  const [navMove, setNavMove] = useState<NavMove>('none');
  const top = stack.at(-1) ?? null;
  const selection: Selection | null = top && top.kind !== 'report' ? top : null;
  const reportOpen = top?.kind === 'report';
  /** A route opened from a list shows in full; one tapped on the map is a small preview. */
  const routeFull = !!(top && top.kind === 'route' && top.full);
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
  // Whether the world demand model is built (see the background build below), and whether a view is waiting for it.
  const [marketsBuilt, setMarketsBuilt] = useState(marketsReady);
  const marketsWanted = useRef(false);
  // The route sheet's figures come from the calculation worker's result for the current plan. The last result is kept
  // until the next one arrives, so an edit doesn't block the main thread with a second full simulation.
  const lastNetwork = useRef<NetworkResult | null>(null);
  if (result) lastNetwork.current = result;
  const routeOpen = !!plan && !!selectedRouteKey && routePairs(plan).some((r) => r.key === selectedRouteKey);
  const liveRouteResult = routeOpen ? (result ?? lastNetwork.current) : null;
  const resultRef = useRef(result);
  resultRef.current = result;
  const [panel, setPanel] = useState<Panel>('routes');
  /** The home sheet's height. It starts small, so the map is home. */
  const [detent, setDetent] = useState<SheetSize>(() => (typeof matchMedia === 'function' && matchMedia('(min-width: 820px)').matches ? 'full' : 'compact'));
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [transitHint, setTransitHint] = useState<[string, string][] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [schedAirport, setSchedAirport] = useState<{ airport: string } | null>(null);
  const [airlineRoute, setAirlineRoute] = useState<string | null>(null);
  const [airlineTab, setAirlineTab] = useState<AirlineSection | undefined>(undefined);
  const [routesView, setRoutesView] = useState<RoutesView>('own');

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
          const out = Object.values(r?.codeshares ?? {}), inn = Object.values(r?.hosted ?? {});
          const cs = out.reduce((s, c) => s + c.feedRevenue, 0) + inn.reduce((s, h) => s + h.revenue, 0) - (r?.codeshareCost ?? 0);
          const csPax = out.reduce((s, c) => s + c.pax, 0) + inn.reduce((s, h) => s + h.pax, 0);
          history.push({ day: d, ...last, pax: (r?.pax ?? 0) / 7, cs: cs / 7, csPax: csPax / 7 });
        }
        if (r) setToast(`第 ${today - 1} 天結算：${hkSigned(last.revenue - last.cost)}`);
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
  // Route, airport and airline views need the world demand model, which takes seconds to build on a phone. Build it in
  // short slices between frames after the app starts, so the first route opened doesn't freeze the screen. A view
  // opened before it is ready shows a short wait instead, and the slices grow until it is done.
  useEffect(() => {
    if (marketsBuilt) return;
    let timer = setTimeout(function slice() {
      if (prepareMarkets(marketsWanted.current ? MARKET_SLICE_WAITING_MS : MARKET_SLICE_MS)) setMarketsBuilt(true);
      else timer = setTimeout(slice, 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [marketsBuilt]);
  // Then the competitor schedules around the player's airports, which a route's first simulation needs.
  const planAirports = plan ? [...new Set([plan.base, ...(plan.hub ? [plan.hub] : []), ...routePairs(plan).flatMap((r) => [r.a, r.b])])].join() : '';
  useEffect(() => {
    if (!marketsBuilt || !planAirports) return;
    const steps = warmCompetition(planAirports.split(','));
    let timer = setTimeout(function slice() {
      const end = performance.now() + MARKET_SLICE_MS;
      while (!steps.next().done) if (performance.now() >= end) { timer = setTimeout(slice, 0); return; }
    }, 0);
    return () => clearTimeout(timer);
  }, [marketsBuilt, planAirports]);
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
  const reset = () => { setOverlay(null); setAirlineRoute(null); setAirlineTab(undefined); };
  /** From the map: a fresh page rises over the home sheet (or, with null, back to the map). */
  const select = (s: Selection | null) => { reset(); setStack(s ? [s] : []); setNavMove(s ? 'rise' : 'back'); };
  /** From a list or another page: push a page, with ‹ back to where it came from. */
  const push = (p: Page) => {
    reset(); setNavMove('push');
    setStack((st) => { const i = st.findIndex((x) => x.kind === p.kind && ('id' in x ? x.id : '') === ('id' in p ? p.id : '')); return i >= 0 ? [...st.slice(0, i), p] : [...st, p]; });
  };
  const pop = () => { reset(); setNavMove('back'); setStack((st) => st.slice(0, -1)); };
  /** Swap the page in place, for ‹ › through a list. */
  const swap = (p: Page) => { reset(); setNavMove('none'); setStack((st) => [...st.slice(0, -1), p]); };
  const openRoute = (key: string) => push({ kind: 'route', id: key, full: true });
  const openAirline = (id: string, tab?: AirlineSection) => { push({ kind: 'airline', id }); setAirlineTab(tab); };
  const openTab = (p: Panel) => { setStack([]); setNavMove('none'); setOverlay(null); setPanel(p); if (detent === 'compact') setDetent('half'); if (p !== 'schedule') setSchedAirport(null); };
  /** The new-route planner: pick two airports, see what the route would earn, confirm. */
  const planRoute = (from: string, to: string | null = null) => {
    setStack([]);
    setOverlay({ kind: 'new', from, to: to === from ? null : to, pick: to && to !== from ? null : 'to' });
  };
  const newRoute = overlay?.kind === 'new' ? overlay : null;
  const openCodeshare = (airline: string, key: string, focus?: string) => setOverlay({ kind: 'codeshare', airline, key, focus });
  const openHosted = (key: string, airline?: string) => setOverlay({ kind: 'hosted', key, airline });
  const toggleHost = (airline: string, key: string) => {
    const on = plan.hosted?.some((h) => h.airline === airline && h.key === key);
    update(toggleHosted(plan, airline, key));
    setToast(on ? `${airlineName(airline)} 停止賣 ${key.replace('-', '⇄')}` : `${airlineName(airline)} 開始賣 ${key.replace('-', '⇄')}`);
  };
  const csLabel = (airline: string, key: string) => `${airlineName(airline)} ${key.replace('-', '⇄')}`;
  const toggleShare = (airline: string, key: string) => {
    const on = hasCodeshare(plan, airline, key);
    update(toggleCodeshare(plan, airline, key));
    setToast(on ? `已取消共享 ${csLabel(airline, key)}` : `開始共享 ${csLabel(airline, key)}`);
  };

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
  /** A short name for a page, for the ‹ back button of the page above it. */
  const pageLabel = (p: Page) => (p.kind === 'report' ? '報表' : p.kind === 'airport' ? AIRPORT_BY_CODE[p.id].name : p.kind === 'route' ? p.id.replace('-', '⇄') : p.kind === 'aircraft' ? plan.fleet.find((a) => a.id === p.id)?.reg ?? '飛機' : airlineLabel(p.id));
  const homeLabel = detent === 'compact' ? '地圖' : SECTION_LABEL[panel];
  const pageNav: SheetNav = { back: { label: stack.length > 1 ? pageLabel(stack[stack.length - 2]) : homeLabel, go: pop } };
  /** Codeshare sheets open over the page they came from; their back closes them. */
  const overNav: SheetNav = { back: { label: top ? pageLabel(top) : SECTION_LABEL[panel], go: () => setOverlay(null) } };
  const section: Section = panel === 'fleet' || panel === 'schedule' ? 'fleet' : panel === 'airports' || panel === 'airlines' ? 'market' : 'routes';
  const homeNav: SheetNav = {
    detent, onDetent: setDetent,
    switcher: <div className="seg three switcher" role="tablist" aria-label="主要導覽">
      {SECTIONS.map(([id, label, first]) => <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''}
        onClick={() => { if (section !== id) openTab(first); else if (detent === 'compact') setDetent('half'); }}><TabIcon tab={first} />{label}</button>)}
    </div>,
    menu: section === 'fleet' ? { items: [['fleet', '飛機'], ['schedule', '班表']], value: panel, onPick: (id) => openTab(id as Panel) }
      : section === 'market' ? { items: [['airports', '機場'], ['airlines', '航空公司']], value: panel, onPick: (id) => openTab(id as Panel) }
      : undefined,
  };
  const editing = overlay?.kind === 'edit' ? plan.fleet.find((a) => a.id === overlay.acId) : undefined;
  const editingUnit = editing && overlay?.kind === 'edit' && editing.legs[overlay.leg] ? unitOf(editing, overlay.leg) : null;
  const schedSel = editing && editingUnit ? { acId: editing.id, legs: Array.from({ length: editingUnit.count }, (_, k) => editingUnit.start + k) } : null;
  /** The home sheet stays mounted under pages, hidden, so it comes back where it was. */
  const homeCovered = stack.length > 0 || !!newRoute;
  const showPanel = panel;
  /** Previous / next item in a list, for swiping across route and airport sheets. */
  const pagerFor = (list: string[], id: string, go: (id: string) => void) => {
    const i = list.indexOf(id);
    if (i < 0 || list.length < 2) return undefined;
    return { label: `${i + 1}/${list.length}`, prev: i > 0 ? () => go(list[i - 1]) : undefined, next: i < list.length - 1 ? () => go(list[i + 1]) : undefined };
  };
  const routeOrder = routePairs(plan).map((r) => r.key);
  const airportOrder = [...new Set(routePairs(plan).flatMap((r) => [r.a, r.b]))]
    .sort((x, y) => (x === plan.base ? -1 : y === plan.base ? 1 : x === plan.hub ? -1 : y === plan.hub ? 1 : AIRPORT_BY_CODE[x].name.localeCompare(AIRPORT_BY_CODE[y].name)));
  // A codeshare sheet opens over whatever sheet it came from (a route, a partner, the routes list). Hide that one
  // while it is open, so only one sheet ever shows; it comes back as it was when the codeshare sheet closes.
  const stacked = overlay?.kind === 'codeshare' || overlay?.kind === 'hosted';
  // These views read the demand model as they render. Until it is built they wait behind one small sheet.
  const waiting = marketsBuilt ? null
    : routeKey && routeExists ? routeName(...(routeKey.split('-') as [string, string]))
    : airport ? AIRPORT_BY_CODE[airport].name
    : airlineId ? '航空公司'
    : newRoute ? '開新航線'
    : overlay?.kind === 'codeshare' || overlay?.kind === 'hosted' ? '共享航班'
    : !homeCovered && showPanel === 'airlines' ? '航空公司'
    : !homeCovered && showPanel === 'airports' ? '市場'
    : null;
  marketsWanted.current = waiting !== null;

  return (
    <AirlineLink.Provider value={openAirline}>
    <CodeshareLink.Provider value={openCodeshare}>
    <HostedLink.Provider value={openHosted}>
    <div className={`app${stacked ? ' sheet-stacked' : ''}${homeCovered ? ' home-covered' : ''}${detent === 'compact' && !homeCovered ? ' map-mode' : ''}`} data-nav={navMove}>
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
        onTapEmpty={() => { if (newRoute) return; if (stack.length) select(null); else setDetent('compact'); }}
        onDragRoute={(a, b) => planRoute(a, b)}
      />

      <Island clock={clock} base={plan.base} speed={speed} onSpeed={setSpeed} result={result} balance={game?.balance ?? 0} history={game?.history ?? []} note={toast}
        theme={theme} onTheme={() => setTheme(theme === 'day' ? 'night' : 'day')}
        onReport={() => { if (!reportOpen) push({ kind: 'report' }); }}
        onReset={() => {
          if (confirmReset()) { setPlan(null); setGame(null); clockRef.current = null; select(null); setPanel('routes'); setDetent('compact'); try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }
        }} />

      {result && !stack.length && !overlay && detent === 'compact' && (
        <div className="map-legend" aria-label="地圖圖例：航線顏色是載客率，越粗旅客越多">
          <span><i style={{ background: LF_COLORS.good }} />80%+</span>
          <span><i style={{ background: LF_COLORS.ok }} />60%</span>
          <span><i style={{ background: LF_COLORS.bad }} />低</span>
          <span className="w"><i className="thin" /><i className="thick" />客量</span>
          {!!plan.codeshares?.length && <span><i className="dash" />共享</span>}
        </div>
      )}

      {waiting && (
        <Sheet title={waiting} size={routeKey && routeFull ? 'full' : 'half'} onClose={() => { if (newRoute || stacked) setOverlay(null); else if (stack.length) pop(); else setDetent('compact'); }}>
          <p className="hint" role="status">正在準備全球市場資料…</p>
        </Sheet>
      )}
      {marketsBuilt && routeKey && routeExists && (
        <SheetNavContext.Provider value={pageNav}>
        <RouteSheet key={routeKey} size={routeFull ? 'full' : 'compact'} pager={pagerFor(routeOrder, routeKey, (k) => swap({ kind: 'route', id: k, full: routeFull }))} plan={plan} routeKey={routeKey} result={liveRouteResult?.routes[routeKey]} net={liveRouteResult}
          onFare={(mult) => update({ ...plan, fares: { ...plan.fares, [routeKey]: mult } })}
          onAdd={() => setOverlay({ kind: 'add', key: routeKey })}
          onRemoveOne={() => removeOne(routeKey)}
          onEditFlight={(acId, leg) => setOverlay({ kind: 'edit', acId, leg })}
          onCloseRoute={() => { update(closeRoute(plan, routeKey)); setToast('已停飛'); pop(); }}
          onClose={() => select(null)} />
        </SheetNavContext.Provider>
      )}
      {aircraft && (
        <SheetNavContext.Provider value={pageNav}>
        <AircraftSheet key={aircraft.id} plan={plan} ac={aircraft} result={result?.aircraft[aircraft.id]}
          onChange={(ac) => update({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) })}
          onRemove={() => { update({ ...plan, fleet: plan.fleet.filter((x) => x.id !== aircraft.id) }); setToast(`已退租 ${aircraft.reg}`); pop(); }}
          onEditFlight={(leg) => setOverlay({ kind: 'edit', acId: aircraft.id, leg })}
          onAddHere={() => setOverlay({ kind: 'gap', acId: aircraft.id, t: aircraft.legs.length ? aircraft.legs[aircraft.legs.length - 1].dep + 60 : utcMorning(plan.base) })}
          onClose={() => select(null)} />
        </SheetNavContext.Provider>
      )}
      {marketsBuilt && airport && (
        <SheetNavContext.Provider value={pageNav}>
        <AirportSheet key={airport} pager={pagerFor(airportOrder, airport, (c) => swap({ kind: 'airport', id: c }))} plan={plan} result={result} code={airport}
          onConnect={() => planRoute(airport)}
          onOpen={(to: string) => planRoute(airport, to)}
          onOpenPair={(a: string, b: string) => addTrip(a, b, undefined, true)}
          onSuggest={(from: string, to: string, local: number) => setOverlay({ kind: 'add', key: [from, to].sort().join('-'), prefer: { from, dep: utcFromLocal(from, local) } })}
          onOpenRoute={openRoute}
          onAddFlight={(key) => setOverlay({ kind: 'add', key })}
          onRemoveFlight={removeOne}
          onToggleHub={() => {
            const on = plan.hub === airport;
            update({ ...plan, hub: on ? undefined : airport });
            setToast(on ? '已取消轉運站' : `${AIRPORT_BY_CODE[airport].name}設為轉運站`);
          }}
          onShowSchedule={() => { openTab('schedule'); setSchedAirport({ airport }); }}
          onPickAirport={(code) => push({ kind: 'airport', id: code })}
          onPickAirline={openAirline}
          onHint={setTransitHint}
          onClose={() => select(null)} />
        </SheetNavContext.Provider>
      )}
      {marketsBuilt && airlineId && (
        <SheetNavContext.Provider value={pageNav}>
        <AirlineSheet key={airlineId} plan={plan} result={result} id={airlineId} focus={airlineRoute} onFocus={setAirlineRoute} initialTab={airlineTab}
          onCodeshare={(key) => toggleShare(airlineId, key)}
          onPickAirport={(code) => push({ kind: 'airport', id: code })}
          onOpenRoute={(key) => push({ kind: 'route', id: key })}
          onOpen={(a, b) => planRoute(a, b)}
          onClose={() => select(null)} />
        </SheetNavContext.Provider>
      )}
      {reportOpen && result && (
        <SheetNavContext.Provider value={pageNav}>
          <ResultsSheet result={result} history={game?.history ?? []} balance={game?.balance ?? 0} onPick={openRoute} onClose={pop} />
        </SheetNavContext.Provider>
      )}

      <SheetNavContext.Provider value={homeNav}>
      {marketsBuilt && showPanel === 'airlines' && (
        <AirlinesPanel plan={plan} onPick={(id) => openAirline(id)} onClose={() => setDetent('compact')} />
      )}
      {showPanel === 'routes' && (
        <RoutesPanel plan={plan} result={result} history={game?.history ?? []} view={routesView} onView={setRoutesView} onOpen={openRoute} onNew={() => planRoute(plan.hub ?? plan.base)}
          onOpenCodeshare={openCodeshare} onShare={toggleShare} onPartners={() => openTab('airlines')} onOpenHosted={openHosted} onHost={toggleHost}
          onAdd={(key) => setOverlay({ kind: 'add', key })} onRemoveOne={removeOne} onClose={() => setDetent('compact')} />
      )}
      {marketsBuilt && showPanel === 'airports' && (
        <AirportsPanel plan={plan} result={result} onPick={(code) => push({ kind: 'airport', id: code })} onClose={() => setDetent('compact')} />
      )}
      {showPanel === 'schedule' && (
        <SchedulePanel key={schedAirport?.airport ?? 'all'} plan={plan} result={result} now={clock.now()} selected={schedSel} preset={schedAirport}
          onPickLeg={(acId, leg) => setOverlay({ kind: 'edit', acId, leg })}
          onGap={(acId, t) => setOverlay({ kind: 'gap', acId, t })}
          onChange={(next, msg) => { update(next); setToast(msg); }}
          onClose={() => setDetent('compact')} />
      )}
      {showPanel === 'fleet' && (
        <FleetPanel plan={plan} result={result} onPick={(id) => push({ kind: 'aircraft', id })} onLease={() => setOverlay({ kind: 'lease' })} onClose={() => setDetent('compact')} />
      )}
      </SheetNavContext.Provider>

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
      {marketsBuilt && newRoute && (
        <NewRouteSheet plan={plan} result={result} state={newRoute}
          onState={(s) => setOverlay({ kind: 'new', ...s })}
          onHint={setTransitHint}
          onDone={(next, msg, key) => { update(next); setToast(msg); setTransitHint(null); select({ kind: 'route', id: key }); }}
          onClose={() => { setOverlay(null); setTransitHint(null); }} />
      )}
      {overlay?.kind === 'gap' && (
        <GapSheet plan={plan} acId={overlay.acId} t={overlay.t}
          onChoose={(key, prefer) => setOverlay({ kind: 'add', key, prefer, returnGap: { acId: overlay.acId, t: overlay.t } })}
          onClose={() => setOverlay(null)} />
      )}
      {marketsBuilt && overlay?.kind === 'codeshare' && (
        <SheetNavContext.Provider value={overNav}>
        <CodeshareSheet key={`${overlay.airline}|${overlay.key}`} plan={plan} airline={overlay.airline} routeKey={overlay.key} focus={overlay.focus}
          onShare={(share) => {
            const was = hasCodeshare(plan, overlay.airline, overlay.key);
            update(setCodeshareShare(plan, overlay.airline, overlay.key, share));
            setToast(was ? `共享座位改成每班 ${Math.round(share * 100)}%` : `開始共享 ${csLabel(overlay.airline, overlay.key)}`);
          }}
          onStop={() => { update(toggleCodeshare(plan, overlay.airline, overlay.key)); setToast(`已取消共享 ${csLabel(overlay.airline, overlay.key)}`); setOverlay(null); }}
          onOpenRoute={openRoute}
          onPartner={() => openAirline(overlay.airline, 'share')}
          onClose={() => setOverlay(null)} />
        </SheetNavContext.Provider>
      )}
      {marketsBuilt && overlay?.kind === 'hosted' && (
        <SheetNavContext.Provider value={overNav}>
        <HostedSheet key={overlay.key} plan={plan} routeKey={overlay.key} airline={overlay.airline}
          onSet={(airline, share) => {
            const was = plan.hosted?.some((h) => h.airline === airline && h.key === overlay.key);
            update(setHostedShare(plan, airline, overlay.key, share));
            setToast(was ? `給${airlineName(airline)}的座位改成每班 ${Math.round(share * 100)}%` : `${airlineName(airline)} 開始賣 ${overlay.key.replace('-', '⇄')}`);
          }}
          onStop={(airline) => toggleHost(airline, overlay.key)}
          onOpenRoute={() => openRoute(overlay.key)}
          onPartner={(airline) => openAirline(airline)}
          onClose={() => setOverlay(null)} />
        </SheetNavContext.Provider>
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

    </div>
    </HostedLink.Provider>
    </CodeshareLink.Provider>
    </AirlineLink.Provider>
  );
}

const airlineLabel = (id: string) => airlines().find((a) => a.id === id)?.name ?? '航空';
type Section = 'routes' | 'fleet' | 'market';
/** The home sheet's three sections, each with the view it opens first. */
const SECTIONS: [Section, string, Panel][] = [['routes', '航線', 'routes'], ['fleet', '機隊', 'fleet'], ['market', '市場', 'airports']];
const SECTION_LABEL: Record<Panel, string> = { routes: '航線', fleet: '機隊', schedule: '班表', airports: '市場', airlines: '航空公司' };
const utcMorning = (code: string) => utcFromLocal(code, 7 * 60);

function TabIcon({ tab }: { tab: Panel | null }) {
  const d = {
    map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14',
    routes: 'M5 18c4-10 10-10 14-12 M5 18a2 2 0 1 0 0.01 0 M19 6a2 2 0 1 0 0.01 0',
    schedule: 'M3 6h18 M3 12h18 M3 18h18 M6 4v4 M12 10v4 M9 16v4 M17 4v4 M15 10v4',
    airports: 'M12 3a5 5 0 0 1 5 5c0 4-5 10-5 10S7 12 7 8a5 5 0 0 1 5-5z M12 6.5a1.6 1.6 0 1 0 0.01 0 M5 21h14',
    fleet: 'M2 13l8-2 2-7h2l-1 7 8 1v2l-8 1 1 4-2 1-3-4-7-1z',
    report: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
    airlines: 'M4 20h16 M6 20l4-16h3l-1 8h6l2 8',
    market: 'M12 3a5 5 0 0 1 5 5c0 4-5 10-5 10S7 12 7 8a5 5 0 0 1 5-5z M12 6.5a1.6 1.6 0 1 0 0.01 0 M5 21h14',
  }[tab ?? 'map'];
  return <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/**
 * The status pill at the top of the map: money and the clock, with play/pause. Tap it for speed, the report, the
 * theme and restarting. Notes (a day's result, "added a flight") show inside it for a moment, so nothing lands on a
 * sheet.
 */
function Island({ clock, base, speed, onSpeed, result, balance, history, note, theme, onTheme, onReport, onReset }: {
  clock: GameClock; base: string; speed: Speed; onSpeed: (s: Speed) => void; result: NetworkResult | null; balance: number; history: DayRecord[];
  note: string | null; theme: Theme; onTheme: () => void; onReport: () => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const lastRun = useRef<Exclude<Speed, 0>>(speed === 0 ? 1 : speed);
  if (speed !== 0) lastRun.current = speed;
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 500); return () => clearInterval(id); }, []);
  const now = clock.now();
  // The daily figure is the week's network result over seven. While an edit is being worked out the last figure stays
  // on screen and changes in place, instead of blanking to a dash for as long as the calculation takes.
  const fresh = result ? (result.revenue - result.cost) / 7 : null;
  const lastEstimate = useRef<number | null>(null);
  if (fresh !== null) lastEstimate.current = fresh;
  const estimate = fresh ?? lastEstimate.current;
  const last = history.at(-1);
  const toneOf = (v: number | null) => (v === null ? '' : v >= 0 ? 'good' : 'bad');
  const close = () => setOpen(false);
  return (
    <>
    {open && <div className="island-scrim" onClick={close} />}
    <header className={`island${open ? ' open' : ''}`}>
      <div className="island-bar">
        <button className="island-main" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="狀態與設定">
          <span className="i-kpi"><small>累計 HK$</small><b className={toneOf(balance)}>{money(balance)}</b></span>
          <span className="i-kpi"><small>每日 HK$</small><b className={toneOf(estimate)}>{estimate === null ? '—' : `${estimate >= 0 ? '+' : ''}${money(estimate)}`}</b></span>
          <span className="i-kpi"><small>第 {dayAt(base, now)} 天</small><b>{hhmm(localMinutes(base, now))}</b></span>
        </button>
        <button className={`island-play${speed === 0 ? ' paused' : ''}`} onClick={() => onSpeed(speed === 0 ? lastRun.current : 0)} aria-label={speed === 0 ? '繼續' : '暫停'}>
          {speed === 0 ? <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" fill="currentColor" /></svg>}
        </button>
      </div>
      {note && !open && <div className="island-note" role="status" key={note}>{note}</div>}
      {open && <>
        <div className="island-card">
          <div className="seg four island-speed" role="group" aria-label="時間速度">
            {SPEEDS.map((sp) => <button key={sp} className={speed === sp ? 'on' : ''} onClick={() => onSpeed(sp)} aria-label={sp === 0 ? '暫停' : `${sp} 倍速`}>{sp === 0 ? '暫停' : `${sp}×`}</button>)}
          </div>
          <div className="island-list">
            <button onClick={() => { close(); onReport(); }} disabled={!result}>
              <span className="grow">報表</span>
              <span className="island-val">{last ? <>上日 <b className={toneOf(last.revenue - last.cost)}>{money(last.revenue - last.cost)}</b></> : '尚未結算'}</span>
              <span className="chev" aria-hidden="true" />
            </button>
            <button onClick={() => { onTheme(); }}><span className="grow">{theme === 'day' ? '夜間模式' : '日間模式'}</span></button>
            <button className="danger-text" onClick={() => { close(); onReset(); }}><span className="grow">重新開始</span></button>
          </div>
        </div>
      </>}
    </header>
    </>
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

