import { useEffect, useState } from 'react';
import { type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, BASES } from '../data/airports';
import { addRoundTrip, emptyPlan, newAircraft, routePairs, simulate, type NetworkResult, type Plan } from '../sim/simulate';
import MapCanvas, { type Selection, type Theme } from './MapCanvas';
import { AircraftSheet, AirportSheet, FleetSheet, ResultsSheet, RouteSheet } from './sheets';
import { count, pct } from './format';

const SAVE_KEY = 'waypoint.plan.v2';
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
  const [result, setResult] = useState<NetworkResult | null>(null);
  const [stale, setStale] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { if (plan) save(SAVE_KEY, plan); }, [plan]);
  useEffect(() => { save(THEME_KEY, theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!plan) return <StartScreen onPick={(base) => { setPlan(emptyPlan(base)); setToast('從機場拖曳到另一個機場，即可開每日來回航班'); }} />;

  const update = (next: Plan) => { setPlan(next); setStale(true); };
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

  const runSim = () => { setResult(simulate(plan)); setStale(false); };

  const routeKey = selection?.kind === 'route' ? selection.id : undefined;
  const routeExists = routeKey && routePairs(plan).some((r) => r.key === routeKey);
  const aircraft = selection?.kind === 'aircraft' ? plan.fleet.find((a) => a.id === selection.id) : undefined;
  const airport = selection?.kind === 'airport' ? selection.id : undefined;

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
          if (connectFrom && connectFrom !== code) addTrip(connectFrom, code);
          else select({ kind: 'airport', id: code });
        }}
        onTapRoute={(key) => select({ kind: 'route', id: key })}
        onTapEmpty={() => select(null)}
        onDragRoute={(a, b) => addTrip(a, b)}
      />

      <TopBar result={stale ? null : result} fleet={plan.fleet.length} theme={theme} onTheme={() => setTheme(theme === 'day' ? 'night' : 'day')}
        onReset={() => {
          if (confirmReset()) { setPlan(null); setResult(null); select(null); try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
        }} />

      {connectFrom && <div className="banner">點選目的地機場，從{AIRPORT_BY_CODE[connectFrom].name}開航<button onClick={() => setConnectFrom(null)}>取消</button></div>}
      {toast && <div className="toast">{toast}</div>}

      <div className="fab-row">
        <button className="fab secondary" onClick={() => { setSelection(null); setPanel(panel === 'fleet' ? null : 'fleet'); }}>機隊</button>
        <button className="fab secondary" onClick={() => { setSelection(null); setPanel(panel === 'report' ? null : 'report'); }} disabled={!result}>報表</button>
        <button className={`fab primary ${stale && plan.fleet.length ? 'pulse' : ''}`} onClick={runSim} disabled={!plan.fleet.length}>
          模擬一週{stale && result ? ' •' : ''}
        </button>
      </div>

      {routeKey && routeExists && (
        <RouteSheet key={routeKey} plan={plan} routeKey={routeKey} result={!stale && result ? result.routes[routeKey] : undefined}
          onFare={(mult) => update({ ...plan, fares: { ...plan.fares, [routeKey]: mult } })}
          onAddTrip={(type) => { const [a, b] = routeKey.split('-'); addTrip(a, b, type); }}
          onPickAircraft={(id) => select({ kind: 'aircraft', id })}
          onClose={() => select(null)} />
      )}
      {aircraft && (
        <AircraftSheet key={aircraft.id} plan={plan} ac={aircraft} result={!stale && result ? result.aircraft[aircraft.id] : undefined}
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
        <FleetSheet plan={plan} result={result} stale={stale}
          onPick={(id) => select({ kind: 'aircraft', id })}
          onLease={(type) => { const ac = newAircraft(plan, type); update({ ...plan, fleet: [...plan.fleet, ac] }); select({ kind: 'aircraft', id: ac.id }); }}
          onClose={() => setPanel(null)} />
      )}
      {panel === 'report' && result && (
        <ResultsSheet result={result} stale={stale} onPick={(key) => select({ kind: 'route', id: key })} onClose={() => setPanel(null)} />
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
        <p>在真實的東亞地圖上規劃你的航線網。旅客會比較票價、時間與班次，在你的航班、其他航空、高鐵新幹線之間選擇。租飛機、排每日班表，讓每架飛機多飛、每班多載。目標：讓收入打平成本，越高越好。</p>
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

function TopBar({ result, fleet, theme, onTheme, onReset }: { result: NetworkResult | null; fleet: number; theme: Theme; onTheme: () => void; onReset: () => void }) {
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
      <div className="kpi"><span className="label">機隊</span><span className="value">{fleet}</span></div>
      <div className="top-actions">
        <button onClick={onTheme} aria-label="切換主題">{theme === 'day' ? '夜' : '日'}</button>
        <button onClick={onReset} aria-label="重新開始">↺</button>
      </div>
    </div>
  );
}
