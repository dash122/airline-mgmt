import { useEffect, useMemo, useState } from 'react';
import { AIRCRAFT, CLASS_ORDER, type AircraftClass } from '../data/aircraft';
import { AIRPORT_BY_CODE, BASES } from '../data/airports';
import { routeProblem, simulate, simulateRoute, topMarketsFrom, weeklyDepartures, type NetworkResult, type Plan, type Route } from '../sim/simulate';
import { marketBetween, modelledAnnualPax } from '../sim/markets';
import MapCanvas, { type Selection, type Theme } from './MapCanvas';
import { count, money, pct } from './format';

const SAVE_KEY = 'waypoint.plan.v1';
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

const PREFERRED: AircraftClass[] = ['narrowbody', 'regional', 'turboprop', 'widebody'];
function defaultAircraft(a: string, b: string): AircraftClass | null {
  return PREFERRED.find((c) => !routeProblem(a, b, c)) ?? null;
}

const routeName = (r: { a: string; b: string }) => `${AIRPORT_BY_CODE[r.a].name} ⇄ ${AIRPORT_BY_CODE[r.b].name}`;

export default function App() {
  const [plan, setPlan] = useState<Plan | null>(() => load<Plan>(SAVE_KEY));
  const [theme, setTheme] = useState<Theme>(() => load<Theme>(THEME_KEY) ?? 'day');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [result, setResult] = useState<NetworkResult | null>(null);
  const [stale, setStale] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { if (plan) save(SAVE_KEY, plan); }, [plan]);
  useEffect(() => { save(THEME_KEY, theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!plan) return <StartScreen onPick={(base) => { setPlan({ base, routes: [] }); setToast('從機場拖曳到另一個機場，即可開新航線'); }} />;

  const update = (next: Plan) => { setPlan(next); setStale(true); };

  const addRoute = (a: string, b: string) => {
    const existing = plan.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (existing) { setSelection({ kind: 'route', id: existing.id }); return; }
    const aircraft = defaultAircraft(a, b);
    if (!aircraft) { setToast(routeProblem(a, b, 'widebody') ?? '無法開航'); return; }
    const freq = 7;
    for (const c of [a, b]) {
      if (weeklyDepartures(plan, c) + freq > AIRPORT_BY_CODE[c].slotCap) { setToast(`${AIRPORT_BY_CODE[c].name}時間帶已滿`); return; }
    }
    const route: Route = { id: `${a}-${b}-${Date.now().toString(36)}`, a, b, aircraft, freq, fareMult: 1 };
    update({ ...plan, routes: [...plan.routes, route] });
    setSelection({ kind: 'route', id: route.id });
    setConnectFrom(null);
  };

  const runSim = () => {
    setResult(simulate(plan));
    setStale(false);
  };

  const selectedRoute = selection?.kind === 'route' ? plan.routes.find((r) => r.id === selection.id) : undefined;
  const selectedAirport = selection?.kind === 'airport' ? selection.id : undefined;

  return (
    <div className="app">
      <MapCanvas
        plan={plan}
        result={result}
        stale={stale}
        selection={selection}
        connectFrom={connectFrom}
        theme={theme}
        onTapAirport={(code) => {
          if (connectFrom && connectFrom !== code) addRoute(connectFrom, code);
          else { setSelection({ kind: 'airport', id: code }); setConnectFrom(null); }
          setShowResults(false);
        }}
        onTapRoute={(id) => { setSelection({ kind: 'route', id }); setConnectFrom(null); setShowResults(false); }}
        onTapEmpty={() => { setSelection(null); setConnectFrom(null); }}
        onDragRoute={addRoute}
      />

      <TopBar result={stale ? null : result} routes={plan.routes.length} theme={theme} onTheme={() => setTheme(theme === 'day' ? 'night' : 'day')}
        onReset={() => {
          if (confirmReset()) { setPlan(null); setResult(null); setSelection(null); localStorage.removeItem(SAVE_KEY); }
        }} />

      {connectFrom && <div className="banner">點選目的地機場，從{AIRPORT_BY_CODE[connectFrom].name}開航<button onClick={() => setConnectFrom(null)}>取消</button></div>}
      {toast && <div className="toast">{toast}</div>}

      <div className="fab-row">
        <button className="fab secondary" onClick={() => { setShowResults(!showResults); setSelection(null); }} disabled={!result}>報表</button>
        <button className={`fab primary ${stale && plan.routes.length ? 'pulse' : ''}`} onClick={runSim} disabled={!plan.routes.length}>
          模擬一週{stale && result ? ' •' : ''}
        </button>
      </div>

      {selectedRoute && (
        <RouteSheet key={selectedRoute.id} plan={plan} route={selectedRoute} result={!stale && result ? result.routes[selectedRoute.id] : undefined}
          onChange={(r) => update({ ...plan, routes: plan.routes.map((x) => (x.id === r.id ? r : x)) })}
          onDelete={() => { update({ ...plan, routes: plan.routes.filter((x) => x.id !== selectedRoute.id) }); setSelection(null); }}
          onClose={() => setSelection(null)} />
      )}
      {selectedAirport && (
        <AirportSheet plan={plan} code={selectedAirport}
          onConnect={() => { setConnectFrom(selectedAirport); setSelection(null); }}
          onOpen={(to) => addRoute(selectedAirport, to)}
          onClose={() => setSelection(null)} />
      )}
      {showResults && result && (
        <ResultsSheet plan={plan} result={result} stale={stale} onPick={(id) => { setSelection({ kind: 'route', id }); setShowResults(false); }} onClose={() => setShowResults(false)} />
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
        <p>在真實的東亞地圖上規劃你的航線網。旅客會比較票價、時間與班次，在你的航班、其他航空、高鐵新幹線之間選擇。目標：讓收入打平營運成本，越高越好。</p>
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

function TopBar({ result, routes, theme, onTheme, onReset }: { result: NetworkResult | null; routes: number; theme: Theme; onTheme: () => void; onReset: () => void }) {
  const cr = result?.costRecovery ?? 0;
  return (
    <div className="topbar">
      <div className="kpi main">
        <span className="label">成本回收率</span>
        <span className={`value ${result ? (cr >= 1 ? 'good' : 'bad') : ''}`}>{result ? pct(cr) : '—'}</span>
      </div>
      <div className="kpi"><span className="label">週旅客</span><span className="value">{result ? count(result.pax) : '—'}</span></div>
      <div className="kpi"><span className="label">載客率</span><span className="value">{result ? pct(result.loadFactor) : '—'}</span></div>
      <div className="kpi"><span className="label">機隊</span><span className="value">{result ? result.fleet : '—'}</span></div>
      <div className="kpi"><span className="label">航線</span><span className="value">{routes}</span></div>
      <div className="top-actions">
        <button onClick={onTheme} aria-label="切換主題">{theme === 'day' ? '夜' : '日'}</button>
        <button onClick={onReset} aria-label="重新開始">↺</button>
      </div>
    </div>
  );
}

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet" role="dialog" aria-label={title}>
      <div className="sheet-head">
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <button className="close" onClick={onClose} aria-label="關閉">✕</button>
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  );
}

function RouteSheet({ plan, route, result, onChange, onDelete, onClose }: {
  plan: Plan; route: Route; result?: ReturnType<typeof simulateRoute>; onChange: (r: Route) => void; onDelete: () => void; onClose: () => void;
}) {
  const m = marketBetween(route.a, route.b);
  const preview = useMemo(() => simulateRoute(route), [route]);
  const slotRoom = (delta: number) =>
    [route.a, route.b].every((c) => weeklyDepartures(plan, c) + delta <= AIRPORT_BY_CODE[c].slotCap);
  const setFreq = (f: number) => {
    const next = Math.max(1, Math.min(70, f));
    if (next > route.freq && !slotRoom(next - route.freq)) return;
    onChange({ ...route, freq: next });
  };
  const spec = AIRCRAFT[route.aircraft];
  return (
    <Sheet title={routeName(route)} sub={`${route.a}–${route.b} · ${count(preview.distKm)} 公里 · 航程 ${preview.blockH.toFixed(1)} 小時`} onClose={onClose}>
      <div className="field">
        <label>機型</label>
        <div className="seg">
          {CLASS_ORDER.map((c) => {
            const problem = routeProblem(route.a, route.b, c);
            return (
              <button key={c} className={route.aircraft === c ? 'on' : ''} disabled={!!problem} title={problem ?? ''} onClick={() => onChange({ ...route, aircraft: c })}>
                {AIRCRAFT[c].name}<small>{AIRCRAFT[c].seats} 座</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <label>每週班次（單向）</label>
        <div className="stepper">
          <button onClick={() => setFreq(route.freq - 7)}>−7</button>
          <button onClick={() => setFreq(route.freq - 1)}>−1</button>
          <output>{route.freq}</output>
          <button onClick={() => setFreq(route.freq + 1)} disabled={!slotRoom(1)}>+1</button>
          <button onClick={() => setFreq(route.freq + 7)} disabled={!slotRoom(7)}>+7</button>
        </div>
        <div className="hint">每週座位 {count(spec.seats * route.freq)}（單向）· 需要 {preview.aircraftNeeded} 架飛機</div>
      </div>
      <div className="field">
        <label>票價 NT${count(preview.fare)}（參考價 {pct(route.fareMult)}）</label>
        <input type="range" min={70} max={140} step={5} value={Math.round(route.fareMult * 100)} onChange={(e) => onChange({ ...route, fareMult: Number(e.target.value) / 100 })} />
      </div>
      <div className="competition">
        <span>其他航空 {m?.rivalFreq ? `每週 ${m.rivalFreq} 班` : '無直飛'}</span>
        {m?.ground && <span>{m.ground.name} {m.ground.hours} 小時 · NT${count(m.ground.fare)}</span>}
        <span>市場航空旅客 每週 {count(m?.airDemand ?? 0)}</span>
        <span>潛在旅次 每週 {count(m?.potential ?? 0)}</span>
      </div>
      {result ? (
        <div className="stats">
          <Stat label="需求" value={count(result.demandPerDir)} />
          <Stat label="載客" value={count(result.paxPerDir)} />
          <Stat label="溢出" value={count(result.spillPerDir)} tone={result.spillPerDir > 0 ? 'warn' : undefined} />
          <Stat label="載客率" value={pct(result.loadFactor)} tone={result.loadFactor >= 0.8 ? 'good' : result.loadFactor < 0.6 ? 'bad' : 'warn'} />
          <Stat label="市占" value={pct(result.marketShare)} />
          <Stat label="回收率" value={pct(result.revenue / (result.cost || 1))} tone={result.revenue >= result.cost ? 'good' : 'bad'} />
          <Stat label="週收入" value={money(result.revenue)} />
          <Stat label="週成本" value={money(result.cost)} />
          <Stat label="週損益" value={money(result.revenue - result.cost)} tone={result.revenue >= result.cost ? 'good' : 'bad'} />
        </div>
      ) : (
        <div className="hint center">按「模擬一週」查看這條航線的結果（每週、單向）</div>
      )}
      <button className="danger" onClick={onDelete}>刪除航線</button>
    </Sheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function AirportSheet({ plan, code, onConnect, onOpen, onClose }: { plan: Plan; code: string; onConnect: () => void; onOpen: (to: string) => void; onClose: () => void }) {
  const a = AIRPORT_BY_CODE[code];
  const used = weeklyDepartures(plan, code);
  const top = topMarketsFrom(code, plan);
  return (
    <Sheet title={`${a.name} ${a.code}`} sub={`腹地人口 ${count(a.catchment / 1e4)} 萬 · 模擬年旅客 ${(modelledAnnualPax(code) / 1e6).toFixed(1)} 百萬 · 時間帶 ${used}/${a.slotCap} 班/週 · 跑道 ${count(a.runwayM)} 公尺（最大 ${AIRCRAFT[a.maxClass].name}）${code === plan.base ? ' · 你的基地' : ''}`} onClose={onClose}>
      <button className="primary wide" onClick={onConnect}>從這裡開新航線</button>
      <h4>最大市場（每週單向航空旅客）</h4>
      <ul className="markets">
        {top.map((m) => (
          <li key={m.to}>
            <span className="name">{AIRPORT_BY_CODE[m.to].name} <small>{m.to} · {count(m.distKm)} 公里</small></span>
            <span className="num">{count(m.airDemand)}</span>
            {m.served ? <span className="tag">已開航</span> : <button onClick={() => onOpen(m.to)}>開航</button>}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function ResultsSheet({ plan, result, stale, onPick, onClose }: { plan: Plan; result: NetworkResult; stale: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const rows = plan.routes
    .map((r) => ({ r, res: result.routes[r.id] }))
    .filter((x) => x.res)
    .sort((x, y) => (y.res.revenue - y.res.cost) - (x.res.revenue - x.res.cost));
  return (
    <Sheet title="本週報表" sub={`${stale ? '（航線已變更，請重新模擬）· ' : ''}收入 ${money(result.revenue)} · 成本 ${money(result.cost)} · 每週 ${count(result.flights)} 班`} onClose={onClose}>
      <ul className="report">
        {rows.map(({ r, res }) => (
          <li key={r.id} onClick={() => onPick(r.id)}>
            <span className="name">{routeName(r)}<small>{AIRCRAFT[r.aircraft].name} · 每週 {r.freq} 班</small></span>
            <span className={`num ${res.loadFactor >= 0.8 ? 'good' : res.loadFactor < 0.6 ? 'bad' : 'warn'}`}>{pct(res.loadFactor)}</span>
            <span className={`num ${res.revenue >= res.cost ? 'good' : 'bad'}`}>{money(res.revenue - res.cost)}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
