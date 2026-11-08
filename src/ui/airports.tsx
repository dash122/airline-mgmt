import { useEffect, useState, type ReactNode } from 'react';
import { CLASS_NAMES } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { useAirportAnalysis } from './airport-analysis';
import { hubOf, spokes, stations, viaGroup, type Spoke } from '../sim/airports';
import { FromHubView, HubTransitView } from './transit';
import {
  HUB_COST_PER_WEEK, HUB_MCT_CUT, minConnect,
  weeklyDepartures, type NetworkResult, type Plan,
} from '../sim/simulate';
import { count, money, short } from './format';
import { routeColor, Sheet, type Pager } from './sheets';
import { RouteRow } from './route-health';
import { AirportCompetition, AirportDaySchedule, AirportMarkets, AirportTiles, type AirportSection, type Tile } from './airport-views';
import { rivalsAt } from '../sim/competitors';
import { Badge, IN, Icon } from './viz';

const EMPTY_IDEAS: NonNullable<ReturnType<typeof useAirportAnalysis>>['ideas'] = [];

const lfClass = (lf: number | null) => (lf === null ? 'idle' : lf >= 0.8 ? 'good' : lf >= 0.6 ? 'warn' : 'bad');

/** Nudge bearings apart so neighbouring labels do not sit on top of each other. */
export function spreadAngles(bearings: number[], minGap = 26): number[] {
  const n = bearings.length;
  if (n < 2) return [...bearings];
  const gap = Math.min(minGap, 340 / n);
  const order = bearings.map((_, i) => i).sort((x, y) => bearings[x] - bearings[y]);
  const a = order.map((i) => bearings[i]);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let k = 0; k < n; k++) {
      const next = (k + 1) % n;
      const d = next === 0 ? a[0] + 360 - a[k] : a[next] - a[k];
      if (d < gap - 0.01) { const push = (gap - d) / 2; a[k] -= push; a[next] += push; moved = true; }
    }
    if (!moved) break;
  }
  const out = Array<number>(n).fill(0);
  order.forEach((idx, k) => { out[idx] = a[k]; });
  return out;
}

/** The airport at the centre, one spoke per direct route: direction is the real bearing, length grows with distance. */
function Radial({ code, list, onPick }: { code: string; list: Spoke[]; onPick: (key: string) => void }) {
  const W = 320, H = 210, cx = W / 2, cy = H / 2;
  const maxD = Math.max(...list.map((s) => s.distKm), 1);
  const maxP = Math.max(...list.map((s) => s.pax), 1);
  const angle = spreadAngles(list.map((s) => s.bearing));
  return (
    <svg className="radial" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${code} 的直飛航線`}>
      {[0.5, 1].map((k) => <ellipse key={k} cx={cx} cy={cy} rx={118 * k} ry={78 * k} className="ring" />)}
      {list.map((s, i) => {
        const r = 0.28 + 0.72 * Math.sqrt(s.distKm / maxD);
        const x = cx + Math.sin((angle[i] * Math.PI) / 180) * 118 * r, y = cy - Math.cos((angle[i] * Math.PI) / 180) * 78 * r;
        const w = 2 + 6 * Math.sqrt(s.pax / maxP);
        return (
          <g key={s.key} className={`spoke ${lfClass(s.loadFactor)}`} onClick={() => onPick(s.key)} role="button" aria-label={`${s.other}，每日 ${s.flightsPerDay} 班`}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="hit" />
            <line x1={cx} y1={cy} x2={x} y2={y} className="line" strokeWidth={s.loadFactor === null ? 2 : w} />
            <circle cx={x} cy={y} r="4.5" className="node" />
            <text x={x} y={y + (y > cy ? 15 : -8)} textAnchor="middle">{s.other}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="8" className="center" />
      <text x={cx} y={cy + 20} textAnchor="middle" className="center-t">{code}</text>
    </svg>
  );
}

export function AirportSheet({ pager, plan, result, code, onConnect, onOpen, onOpenPair, onSuggest, onOpenRoute, onToggleHub, onShowSchedule, onPickAirport, onHint, onClose, action, onPickAirline, onAddFlight, onRemoveFlight }: {
  pager?: Pager; plan: Plan; result: NetworkResult | null; code: string; onConnect: () => void; onOpen: (to: string) => void; onOpenPair: (a: string, b: string) => void;
  onSuggest: (from: string, to: string, localMin: number) => void; onOpenRoute: (key: string) => void;
  onToggleHub: () => void; onShowSchedule: () => void; onPickAirport: (code: string) => void;
  /** Legs to sketch on the map while transit ideas are on screen (dashed = not flown yet). */
  onHint: (legs: [string, string][] | null) => void; onClose: () => void; action?: ReactNode; onPickAirline?: (id: string) => void;
  onAddFlight?: (key: string) => void; onRemoveFlight?: (key: string) => void;
}) {
  // Open on what the player can act on: their routes here, or where to fly if they don't fly here yet.
  const [tab, setTab] = useState<AirportSection>(() => (weeklyDepartures(plan, code) > 0 ? 'routes' : 'market'));
  const persp = hubOf(plan);
  const isPersp = code === persp;
  const analysis = useAirportAnalysis(plan, result, code, tab === 'transfer');
  const view = analysis?.view ?? null;
  const ideas = analysis?.ideas ?? EMPTY_IDEAS;
  const hubT = analysis?.hubT ?? null;
  useEffect(() => {
    if (tab !== 'transfer') onHint(null);
    else if (isPersp) onHint(ideas.slice(0, 5).map((i) => [code, i.to]));
    else if (view) {
      const legs = new Map<string, [string, string]>();
      // The fan out of the hub: the biggest destinations in the chosen list (dashed where the leg is not flown yet).
      const linked = view.rows.filter((r) => viaGroup(r) === 'flown');
      for (const l of [...linked, ...view.rows.filter((r) => viaGroup(r) === 'hubLeg')].slice(0, Math.max(10, linked.length))) legs.set(l.d, [persp, l.d]);
      onHint(legs.size ? [...legs.values()] : null);
    }
    return () => onHint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ideas, tab, isPersp, code, persp]);
  const a = AIRPORT_BY_CODE[code];
  const used = weeklyDepartures(plan, code);
  const list = spokes(plan, result, code);
  // Destinations reachable nonstop on any scheduled service (ours or competitors'),
  // deduplicated at airport level before counting destination countries.
  const directDestinations = new Set([
    ...list.map((s) => s.other),
    ...rivalsAt(code).map((r) => r.to),
  ]);
  const directCountries = new Set([...directDestinations].map((to) => AIRPORT_BY_CODE[to].country));
  const isHub = plan.hub === code;
  const transfer = result?.transfers[code];
  const served = used > 0;
  const carriers = analysis?.carriers ?? [];
  const ourPax = list.reduce((s, x) => s + x.pax, 0);
  const tiles: Tile[] = [
    { key: 'routes', icon: 'route', label: '航線', value: list.length ? `${list.length}` : '—' },
    { key: 'market', icon: 'market', label: '市場', value: '—' },
    isPersp
      ? { key: 'transfer', icon: 'transfer', label: '轉機', value: '—' }
      : { key: 'transfer', icon: 'transfer', label: `經${persp}轉機`, value: '—' },
    { key: 'rivals', icon: 'rival', label: '對手', value: carriers.length ? `${carriers.length}` : '—' },
    { key: 'schedule', icon: 'calendar', label: '時刻表', value: '—' },
  ];
  return (
    <Sheet size="half" pager={pager} className="airport-sheet" title={a.name} onClose={onClose} action={action}
      sub={<span className="ins">{code === plan.base && <Badge n="base" tone="accent">基地</Badge>}{isHub && <Badge n="hub" tone="accent">轉運站</Badge>}</span>}
      info={<p>直飛 {directDestinations.size} 個航點、{directCountries.size} 個國家／地區（含對手航班）· 腹地人口 {count(a.catchment / 1e4)} 萬 · 模擬年旅客 {analysis ? (analysis.annualPax / 1e6).toFixed(1) : '?'} 百萬 · 時間帶 {used}/{a.slotCap} 班/週 · 跑道 {count(a.runwayM)} 公尺（最大 {CLASS_NAMES[a.maxClass]}）</p>}>
      <div className="airport-glance">
        <div><b>{list.length}</b><small>你的航線</small></div>
        <div><b>{used}</b><small>每週出發</small></div>
        <div><b>{short(ourPax)}</b><small>你的旅客/週</small></div>
        <div><b>{directDestinations.size}</b><small>直飛航點</small></div>
      </div>
      <button className="primary airport-cta" onClick={onConnect}><Icon n="plus" /> 從{a.name}開新航線</button>
      <AirportTiles tiles={tiles} on={tab} onPick={setTab} />
      {!analysis && <div className="hint" role="status">正在載入機場分析…</div>}

      {tab === 'routes' && (
        <>
          {!served && <div className="airport-empty"><span aria-hidden="true">✈</span><div><b>準備好開拓新航點？</b><p>這裡還沒有你的航班。先探索市場，或直接規劃一條航線。</p><button onClick={() => setTab('market')}>探索目的地<span className="chev inline" aria-hidden="true" /></button></div></div>}
          <ul className="route-rows">
            {list.map((s) => {
              const res = result?.routes[s.key];
              return <RouteRow key={s.key} name={AIRPORT_BY_CODE[s.other].name} sub={s.other} swatch={routeColor(s.key)} daily={s.flightsPerDay}
                figures={res ? { loadFactor: res.loadFactor, spill: res.spill, profit: res.revenue - res.flyingCost } : null}
                onOpen={() => onOpenRoute(s.key)} onAdd={onAddFlight && (() => onAddFlight(s.key))} onRemove={onRemoveFlight && (() => onRemoveFlight(s.key))} />;
            })}
          </ul>
          {served && <button className="link-btn airport-schedule-link" onClick={onShowSchedule}><Icon n="calendar" /> 在班表看這裡的航班<span className="chev inline" aria-hidden="true" /></button>}
          {list.length > 0 && <details className="route-adjust"><summary>查看航線分布</summary><Radial code={code} list={list} onPick={onOpenRoute} /></details>}
          {view && (view.rows.length > 0 || !view.legFlown) && (
            <button className="hubteaser" onClick={() => setTab('transfer')}>
              <span className="grow"><b><Icon n="transfer" /> 經{persp}轉機</b>
                <span className="ins">{view.legFlown
                  ? <><IN n="pax" v={count(view.now)} label="每週轉機旅客" u="人/週" /><IN n="market" v={view.rows.filter((r) => viaGroup(r) === 'flown').length} label="接上的地方" /></>
                  : <><IN n="lock" v={`${code}⇄${persp}`} label="還沒飛" w="未飛" /><IN n="market" v={`+${view.unlockCount}`} label="開航後可接上的地方" w="可接" u="地" /></>}</span></span>
              <span className="chev" aria-hidden="true" />
            </button>
          )}
          {served && (
            <details className="route-adjust">
            <summary>轉運站設定</summary>
            <div className="hubbox">
              <div className="grow">
                <b><Icon n="hub" /> 轉運站{isHub && <> <Badge n="check" tone="good" label="已啟用" /></>}</b>
                <span className="ins"><IN n="fast" v={`−${HUB_MCT_CUT}m`} label="轉機時間縮短" w="轉機" /><IN n="money" v={`${money(HUB_COST_PER_WEEK)}/週`} label="每週費用（只能設一個）" w="費用" /></span>
              </div>
              <button className={isHub ? 'secondary' : 'primary small'} onClick={onToggleHub}>{isHub ? '取消' : '設為轉運站'}</button>
            </div>
            </details>
          )}
        </>
      )}

      {tab === 'transfer' && view && (
        <FromHubView plan={plan} net={result} view={view} onOpenPair={onOpenPair} onSuggest={onSuggest} onPickHub={() => onPickAirport(persp)} />
      )}

      {tab === 'transfer' && isPersp && (
        <>
          {!served && <div className="hint center">開兩條以上航線，旅客就能在這裡轉機</div>}
          {hubT && served && <HubTransitView hub={code} net={result} transit={hubT} ideas={ideas} transfer={{ pax: transfer?.pax ?? 0, long: transfer?.long ?? 0, stopover: transfer?.stopover ?? 0, mct: minConnectLabel(plan, code) }} onOpenPair={onOpenPair} onSuggest={onSuggest} />}
        </>
      )}

      {tab === 'schedule' && <AirportDaySchedule plan={plan} code={code} />}

      {tab === 'rivals' && <AirportCompetition plan={plan} result={result} code={code} onOpenRoute={onOpenRoute} onOpen={onOpen} onPickAirline={onPickAirline} />}

      {tab === 'market' && <AirportMarkets plan={plan} result={result} code={code} onOpen={onOpen} onOpenRoute={onOpenRoute} />}
    </Sheet>
  );
}

/** The international minimum connection at this airport, as the player sees it. */
const minConnectLabel = (plan: Plan, code: string) => {
  const other = Object.keys(AIRPORT_BY_CODE).find((c) => AIRPORT_BY_CODE[c].country !== AIRPORT_BY_CODE[code].country) ?? code;
  return minConnect(code, other, other, plan.hub);
};

// ---------- Airports tab ----------

export function AirportsPanel({ plan, result, onPick, onClose }: { plan: Plan; result: NetworkResult | null; onPick: (code: string) => void; onClose: () => void }) {
  const [order, setOrder] = useState<'busy' | 'profit' | 'transfer'>('busy');
  const rows = stations(plan, result).sort((x, y) =>
    order === 'profit' ? (y.profit ?? 0) - (x.profit ?? 0) : order === 'transfer' ? y.transferPax - x.transferPax : 0);
  return (
    <Sheet size="full" title={`機場 · ${rows.length}`} onClose={onClose}
      info={<>
        <p>損益：每條航線兩端各算一半，不含租金。色條是時間帶用量。</p>
        {plan.hub && <p>轉運站 {plan.hub}：每週 {money(HUB_COST_PER_WEEK)}，轉機最短時間縮短 {HUB_MCT_CUT} 分鐘。</p>}
      </>}>
      {rows.length === 0 && <div className="hint center">還沒有機場</div>}
      <div className="seg three">
        {([['busy', '班次'], ['profit', '損益'], ['transfer', '轉機']] as const).map(([k, label]) => (
          <button key={k} className={order === k ? 'on' : ''} onClick={() => setOrder(k)}>{label}</button>
        ))}
      </div>
      <ul className="stations">
        {rows.map((r) => {
          const use = r.departures / r.slotCap;
          return (
            <li key={r.code} role="button" tabIndex={0} onClick={() => onPick(r.code)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.code); } }}>
              <div className="st-top">
                <span className="name"><span className="st-title">{AIRPORT_BY_CODE[r.code].name} {r.code}{r.code === plan.base && <span className="chip">基地</span>}{r.isHub && <span className="chip">轉運站</span>}</span>
                  <span className="ins"><IN n="route" v={r.routes} label="航線" u="條航線" /><IN n="plane" v={r.departures} label="出發班次/週" u="班/週" /><IN n="pax" v={count(r.pax)} label="旅客/週" u="人/週" />{r.transferPax > 0 && <IN n="transfer" v={count(r.transferPax)} label="轉機/週" w="轉機" />}</span></span>
                {r.profit !== null && <span className={`pill ${r.profit >= 0 ? 'good' : 'bad'}`} title="分攤到這個機場的航線週損益，不含租金">{r.profit >= 0 ? '+' : ''}{money(r.profit)}<small>／週</small></span>}
              </div>
              {use >= 0.7 && <div className="util" title={`時間帶 ${r.departures}/${r.slotCap}`}><div className={`util-fill ${use >= 0.9 ? 'bad' : 'warn'}`} style={{ width: `${Math.min(100, use * 100)}%` }} /></div>}
              {use >= 0.7 && <small className="slots"><IN n="calendar" v={`${r.departures}/${r.slotCap}`} label="時間帶（每週出發）" w="時間帶" tone={use >= 0.9 ? 'bad' : 'warn'} /></small>}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
