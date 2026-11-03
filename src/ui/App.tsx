import { useEffect, useMemo, useRef, useState } from 'react';
import { type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, BASES } from '../data/airports';
import { addRoundTrip, emptyPlan, newAircraft, routePairs, simulate, type NetworkResult, type Plan } from '../sim/simulate';
import MapCanvas, { type Selection, type Theme } from './MapCanvas';
import { AircraftSheet, AirportSheet, FleetSheet, ResultsSheet, RouteSheet } from './sheets';
import { count, money, pct } from './format';
import { dayAt, GameClock, HISTORY_DAYS, newGame, SPEEDS, type GameState, type Speed } from './clock';

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

type Panel = 'fleet' | 'report' | null;

export default function App() {
  const [plan, setPlan] = useState<Plan | null>(() => {
    const p = load<Plan>(SAVE_KEY);
    return p && p.version === 2 ? p : null;
  });
  const [theme, setTheme] = useState<Theme>(() => load<Theme>(THEME_KEY) ?? 'day');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(() => {
    const g = load<GameState>(GAME_KEY);
    return g && g.version === 1 ? g : null;
  });
  const clockRef = useRef<GameClock | null>(null);
  if (plan && !clockRef.current) clockRef.current = new GameClock((game ?? newGame(plan.base)).utcMin);
  const [speed, setSpeedState] = useState<Speed>(1);
  const result = useMemo<NetworkResult | null>(() => (plan && plan.fleet.length ? simulate(plan) : null), [plan]);
  const resultRef = useRef(result);
  resultRef.current = result;
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);

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
  }, [plan?.base]);
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
    setToast('從機場拖曳到另一個機場，即可開每日來回航班');
  }} />;
  const clock = clockRef.current;
  const setSpeed = (s: Speed) => { clock.setSpeed(s); setSpeedState(s); };

  const update = (next: Plan) => setPlan(next);
  const select = (s: Selection | null) => { setSelection(s); setPanel(null); setConnectFrom(null); };

  const addTrip = (a: string, b: string, type?: AircraftModel) => {
    const r = addRoundTrip(plan, a, b, type);
    if ('error' in r) { setToast(r.error); return; }
    update(r.plan);
    const isNew = !plan.fleet.some((ac) => ac.id === r.aircraftId);
    const reg = r.plan.fleet.find((ac) => ac.id === r.aircraftId)!.reg;
    setToast(isNew ? `租了新飛機 ${reg}，每日來回一班` : `由 ${reg} 加飛一班來回`);
    select({ kind: 'route', id: [a, b].sort().join('-') });
  };

  const routeKey = selection?.kind === 'route' ? selection.id : undefined;
  const routeExists = routeKey && routePairs(plan).some((r) => r.key === routeKey);
  const aircraft = selection?.kind === 'aircraft' ? plan.fleet.find((a) => a.id === selection.id) : undefined;
  const airport = selection?.kind === 'airport' ? selection.id : undefined;

  return (
    <div className="app">
      <MapCanvas
        plan={plan}
        result={result}
        clock={clock}
        selection={selection}
        connectFrom={connectFrom}
        theme={theme}
        onTapAirport={(code) => {
          if (connectFrom && connectFrom !== code) addTrip(connectFrom, code);
          else select({ kind: 'airport', id: code });
        }}
        onTapRoute={(key) => select({ kind: 'route', id: key })}
        onTapEmpty={() => select(null)}
        onDragRoute={(a, b) => addTrip(a, b)}
      />

      <TopBar result={result} balance={game?.balance ?? 0} theme={theme} onTheme={() => setTheme(theme === 'day' ? 'night' : 'day')}
        onReset={() => {
          if (confirmReset()) { setPlan(null); setGame(null); clockRef.current = null; select(null); try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }
        }} />

      {connectFrom && <div className="banner">點選目的地機場，從{AIRPORT_BY_CODE[connectFrom].name}開航<button onClick={() => setConnectFrom(null)}>取消</button></div>}
      {toast && <div className="toast">{toast}</div>}

      <div className="fab-row">
        <div className="speed" role="group" aria-label="時間速度">
          {SPEEDS.map((sp) => (
            <button key={sp} className={speed === sp ? 'on' : ''} onClick={() => setSpeed(sp)} aria-label={sp === 0 ? '暫停' : `${sp} 倍速`}>
              {sp === 0 ? '❚❚' : sp === 1 ? '▶' : sp === 4 ? '▶▶' : '▶▶▶'}
            </button>
          ))}
        </div>
        <button className="fab secondary" onClick={() => { setSelection(null); setPanel(panel === 'fleet' ? null : 'fleet'); }}>機隊 {plan.fleet.length}</button>
        <button className="fab secondary" onClick={() => { setSelection(null); setPanel(panel === 'report' ? null : 'report'); }} disabled={!result}>報表</button>
      </div>

      {routeKey && routeExists && (
        <RouteSheet key={routeKey} plan={plan} routeKey={routeKey} result={result?.routes[routeKey]}
          onFare={(mult) => update({ ...plan, fares: { ...plan.fares, [routeKey]: mult } })}
          onAddTrip={(type) => { const [a, b] = routeKey.split('-'); addTrip(a, b, type); }}
          onPickAircraft={(id) => select({ kind: 'aircraft', id })}
          onClose={() => select(null)} />
      )}
      {aircraft && (
        <AircraftSheet key={aircraft.id} plan={plan} ac={aircraft} result={result?.aircraft[aircraft.id]}
          onChange={(ac) => update({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) })}
          onRemove={() => { update({ ...plan, fleet: plan.fleet.filter((x) => x.id !== aircraft.id) }); select(null); }}
          onClose={() => select(null)} />
      )}
      {airport && (
        <AirportSheet plan={plan} code={airport}
          onConnect={() => { setSelection(null); setConnectFrom(airport); }}
          onOpen={(to) => addTrip(airport, to)}
          onClose={() => select(null)} />
      )}
      {panel === 'fleet' && (
        <FleetSheet plan={plan} result={result}
          onPick={(id) => select({ kind: 'aircraft', id })}
          onLease={(type) => { const ac = newAircraft(plan, type); update({ ...plan, fleet: [...plan.fleet, ac] }); select({ kind: 'aircraft', id: ac.id }); }}
          onClose={() => setPanel(null)} />
      )}
      {panel === 'report' && result && (
        <ResultsSheet result={result} history={game?.history ?? []} balance={game?.balance ?? 0} onPick={(key) => select({ kind: 'route', id: key })} onClose={() => setPanel(null)} />
      )}
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
        <div className="logo">航點<span>Waypoint</span></div>
        <p>在真實的東亞地圖上規劃你的航線網。旅客會比較票價、時間與班次，在你的航班、其他航空、高鐵新幹線之間選擇。租飛機、排每日班表，讓每架飛機多飛、每班多載。時間會自己流動，每天結算一次。目標：讓收入打平成本，越高越好。</p>
        <h2>選擇你的基地</h2>
        <div className="base-grid">
          {BASES.map((c) => (
            <button key={c} onClick={() => onPick(c)}>
              <strong>{AIRPORT_BY_CODE[c].name}</strong>
              <span>{c}</span>
            </button>
          ))}
        </div>
        <p className="fine">需求由人口與機場規模推估，僅供遊戲使用。資料來源：OurAirports、GeoNames（CC BY 4.0）、Natural Earth。</p>
      </div>
    </div>
  );
}

function TopBar({ result, balance, theme, onTheme, onReset }: { result: NetworkResult | null; balance: number; theme: Theme; onTheme: () => void; onReset: () => void }) {
  const cr = result?.costRecovery ?? 0;
  return (
    <div className="topbar">
      <div className="kpi main">
        <span className="label">成本回收率</span>
        <span className={`value ${result ? (cr >= 1 ? 'good' : 'bad') : ''}`}>{result ? pct(cr) : '—'}</span>
      </div>
      <div className="kpi"><span className="label">週旅客</span><span className="value">{result ? count(result.pax) : '—'}</span></div>
      <div className="kpi"><span className="label">載客率</span><span className="value">{result ? pct(result.loadFactor) : '—'}</span></div>
      <div className="kpi"><span className="label">利用率</span><span className="value">{result ? pct(result.avgUtilisation) : '—'}</span></div>
      <div className="kpi"><span className="label">累計損益</span><span className={`value ${balance > 0 ? 'good' : balance < 0 ? 'bad' : ''}`}>{money(balance)}</span></div>
      <div className="top-actions">
        <button onClick={onTheme} aria-label="切換主題">{theme === 'day' ? '夜' : '日'}</button>
        <button onClick={onReset} aria-label="重新開始">↺</button>
      </div>
    </div>
  );
}
