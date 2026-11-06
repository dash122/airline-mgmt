import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CLASS_NAMES } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { modelledAnnualPax } from '../sim/markets';
import { airportTraffic, hubOf, hubOpportunities, hubTransit, hourly, spokes, stations, viaGroup, viewFromHub, type Spoke } from '../sim/airports';
import { FromHubView, HubTransitView } from './transit';
import {
  HUB_COST_PER_WEEK, HUB_MCT_CUT, minConnect,
  weeklyDepartures, type NetworkResult, type Plan,
} from '../sim/simulate';
import { count, money, pct, short } from './format';
import { Sheet, tone } from './sheets';
import { airlinesAt } from '../sim/competitors';
import { AirportCompetition, AirportMarkets, AirportTiles, type AirportSection, type Tile } from './airport-views';
import { Badge, IN, Icon, Meter } from './viz';

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
            {s.flightsPerDay > 1 && <text x={x} y={y + (y > cy ? 25 : -18)} textAnchor="middle" className="sm">×{s.flightsPerDay}</text>}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="8" className="center" />
      <text x={cx} y={cy + 20} textAnchor="middle" className="center-t">{code}</text>
    </svg>
  );
}

function DayStrip({ plan, code }: { plan: Plan; code: string }) {
  const { dep, arr } = hourly(plan, code);
  const peak = Math.max(1, ...dep, ...arr);
  return (
    <div className="daystrip" aria-label="一天中的起降">
      <div className="cols">
        {dep.map((d, h) => (
          <div key={h} className="col">
            <div className="up"><i style={{ height: `${(d / peak) * 100}%` }} /></div>
            <div className="down"><i style={{ height: `${(arr[h] / peak) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="hours">{[0, 6, 12, 18].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}</div>
      <div className="legend"><span className="d" title="出發"><Icon n="up" label="出發" /></span><span className="a" title="抵達"><Icon n="down" label="抵達" /></span></div>
    </div>
  );
}

export function AirportSheet({ plan, result, code, onConnect, onOpen, onOpenPair, onSuggest, onOpenRoute, onToggleHub, onShowSchedule, onPickAirport, onHint, onClose, action }: {
  plan: Plan; result: NetworkResult | null; code: string; onConnect: () => void; onOpen: (to: string) => void; onOpenPair: (a: string, b: string) => void;
  onSuggest: (from: string, to: string, localMin: number) => void; onOpenRoute: (key: string) => void;
  onToggleHub: () => void; onShowSchedule: () => void; onPickAirport: (code: string) => void;
  /** Legs to sketch on the map while transit ideas are on screen (dashed = not flown yet). */
  onHint: (legs: [string, string][] | null) => void; onClose: () => void; action?: ReactNode;
}) {
  const [tab, setTab] = useState<AirportSection>('routes');
  const persp = hubOf(plan);
  const isPersp = code === persp;
  const view = useMemo(() => (isPersp ? null : viewFromHub(plan, result, persp, code)), [plan, result, persp, code, isPersp]);
  const ideas = useMemo(() => (isPersp && tab === 'transfer' ? hubOpportunities(plan, code) : []), [plan, code, isPersp, tab]);
  const hubT = useMemo(() => (isPersp && tab === 'transfer' ? hubTransit(plan, result, code) : null), [plan, result, code, isPersp, tab]);
  useEffect(() => {
    if (isPersp) onHint(tab === 'transfer' ? ideas.slice(0, 5).map((i) => [code, i.to]) : null);
    else if (view) {
      const legs = new Map<string, [string, string]>();
      if (!view.legFlown) legs.set(code, [code, persp]);
      // The fan out of the hub: the biggest destinations in the chosen list (dashed where the leg is not flown yet).
      if (tab === 'transfer') {
        const linked = view.rows.filter((r) => viaGroup(r) === 'flown');
        for (const l of [...linked, ...view.rows.filter((r) => viaGroup(r) === 'hubLeg')].slice(0, Math.max(10, linked.length))) legs.set(l.d, [persp, l.d]);
      }
      onHint(legs.size ? [...legs.values()] : null);
    }
    return () => onHint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ideas, tab, isPersp, code, persp]);
  const a = AIRPORT_BY_CODE[code];
  const used = weeklyDepartures(plan, code);
  const list = spokes(plan, result, code);
  const isHub = plan.hub === code;
  const transfer = result?.transfers[code];
  const served = used > 0;
  const carriers = airlinesAt(code);
  const traffic = useMemo(() => airportTraffic(result, code), [result, code]);
  const ourPax = list.reduce((s, x) => s + x.pax, 0);
  const tiles: Tile[] = [
    { key: 'routes', icon: 'route', label: '航線', value: list.length ? `${list.length}` : '—', sub: list.length ? <IN n="pax" v={short(ourPax)} label="你的旅客/週" /> : undefined },
    { key: 'rivals', icon: 'rival', label: '對手', value: carriers.length ? `${carriers.length}` : '—', sub: carriers.length ? <IN n="plane" v={short(carriers.reduce((s, c) => s + c.flights, 0))} label="對手班次/週" /> : undefined },
    { key: 'market', icon: 'market', label: '市場', value: traffic.ours >= 1 ? pct(traffic.ours / Math.max(1, traffic.total)) : '0%', sub: <IN n="pax" v={short(traffic.total)} label="機場旅客/週" /> },
    isPersp
      ? { key: 'transfer', icon: 'transfer', label: '轉機', value: short(transfer?.pax ?? 0), sub: '/週' }
      : { key: 'transfer', icon: 'transfer', label: `經${persp}`, value: view?.legFlown ? short(view?.now ?? 0) : '—', sub: view?.legFlown ? '/週' : <IN n="lock" v={persp} label={`還沒飛 ${code}⇄${persp}`} /> },
  ];
  return (
    <Sheet title={`${a.name} ${a.code}`} onClose={onClose} action={action}
      sub={<span className="ins">{code === plan.base && <Badge n="base" tone="accent">基地</Badge>}{isHub && <Badge n="hub" tone="accent">轉運站</Badge>}<IN n="pax" v={`${count(a.catchment / 1e4)}萬`} label="腹地人口" /></span>}
      info={<p>腹地人口 {count(a.catchment / 1e4)} 萬 · 模擬年旅客 {(modelledAnnualPax(code) / 1e6).toFixed(1)} 百萬 · 時間帶 {used}/{a.slotCap} 班/週 · 跑道 {count(a.runwayM)} 公尺（最大 {CLASS_NAMES[a.maxClass]}）</p>}>
      <AirportTiles tiles={tiles} on={tab} onPick={setTab} />

      {tab === 'routes' && (
        <>
          {list.length === 0 ? <div className="hint center">還沒有航班</div> : <Radial code={code} list={list} onPick={onOpenRoute} />}
          {list.length > 0 && <DayStrip plan={plan} code={code} />}
          <ul className="markets">
            {list.map((s) => (
              <li key={s.key} onClick={() => onOpenRoute(s.key)} className="tapli">
                <span className="name">{AIRPORT_BY_CODE[s.other].name} <small>{s.other}{s.flightsPerDay > 1 ? ` ×${s.flightsPerDay}` : ''}</small>
                  {s.loadFactor !== null && <span className="lf-line"><Meter value={s.loadFactor} tone={tone(s.loadFactor)} label={`載客率 ${pct(s.loadFactor)}`} /><b className={tone(s.loadFactor)}>{pct(s.loadFactor)}</b></span>}</span>
                {s.profit !== null && <span className={`pill ${s.profit >= 0 ? 'good' : 'bad'}`}>{s.profit >= 0 ? '+' : ''}{money(s.profit)}</span>}
              </li>
            ))}
          </ul>
          {view && (view.rows.length > 0 || !view.legFlown) && (
            <button className="hubteaser" onClick={() => setTab('transfer')}>
              <span className="grow"><b><Icon n="transfer" /> {persp}</b>
                <span className="ins">{view.legFlown
                  ? <><IN n="pax" v={count(view.now)} label="每週轉機旅客" /><IN n="market" v={view.rows.filter((r) => viaGroup(r) === 'flown').length} label="接上的地方" /></>
                  : <><IN n="lock" v={`${code}⇄${persp}`} label="還沒飛" /><IN n="market" v={`+${view.unlockCount}`} label="開航後可接上的地方" /></>}</span></span>
              <span className="chev">›</span>
            </button>
          )}
          <button className="primary wide" onClick={onConnect}>＋ 開新航線</button>
          {served && <button className="secondary" onClick={onShowSchedule}>班表</button>}
          {served && (
            <div className="hubbox">
              <div className="grow">
                <b><Icon n="hub" /> 轉運站{isHub && <> <Badge n="check" tone="good" label="已啟用" /></>}</b>
                <span className="ins"><IN n="fast" v={`−${HUB_MCT_CUT}m`} label="轉機時間縮短" /><IN n="money" v={`${money(HUB_COST_PER_WEEK)}/週`} label="每週費用（只能設一個）" /></span>
              </div>
              <button className={isHub ? 'secondary' : 'primary small'} onClick={onToggleHub}>{isHub ? '取消' : '設定'}</button>
            </div>
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

      {tab === 'rivals' && <AirportCompetition result={result} code={code} onOpenRoute={onOpenRoute} onOpen={onOpen} />}

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
            <li key={r.code} onClick={() => onPick(r.code)}>
              <div className="st-top">
                <span className="name"><span className="st-title">{AIRPORT_BY_CODE[r.code].name} {r.code}{r.code === plan.base && <Icon n="base" label="基地" />}{r.isHub && <Icon n="hub" label="轉運站" />}</span>
                  <span className="ins"><IN n="route" v={r.routes} label="航線" /><IN n="pax" v={count(r.pax)} label="旅客/週" />{r.transferPax > 0 && <IN n="transfer" v={count(r.transferPax)} label="轉機/週" />}</span></span>
                {r.profit !== null && <span className={`pill ${r.profit >= 0 ? 'good' : 'bad'}`}>{r.profit >= 0 ? '+' : ''}{money(r.profit)}</span>}
              </div>
              <div className="util" title={`時間帶 ${r.departures}/${r.slotCap}`}><div className={`util-fill ${use >= 0.9 ? 'bad' : use >= 0.7 ? 'warn' : 'good'}`} style={{ width: `${Math.min(100, use * 100)}%` }} /></div>
              {use >= 0.7 && <small className="slots"><IN n="calendar" v={`${r.departures}/${r.slotCap}`} label="時間帶（每週出發）" tone={use >= 0.9 ? 'bad' : 'warn'} /></small>}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
