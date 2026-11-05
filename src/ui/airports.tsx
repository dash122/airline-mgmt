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
            <text x={x} y={y + (y > cy ? 25 : -18)} textAnchor="middle" className="sm">{s.flightsPerDay}班/日</text>
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
      <div className="legend"><span className="d">■ 出發</span><span className="a">■ 抵達</span><span>當地時間</span></div>
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
    { key: 'routes', label: '你的航線', value: list.length ? `${list.length} 條` : '—', sub: list.length ? `${short(ourPax)} 人/週` : '還沒飛' },
    { key: 'rivals', label: '對手', value: carriers.length ? `${carriers.length} 家` : '—', sub: carriers.length ? `${short(carriers.reduce((s, c) => s + c.flights, 0))} 班/週` : '沒有對手' },
    { key: 'market', label: '市場', value: traffic.ours >= 1 ? pct(traffic.ours / Math.max(1, traffic.total)) : '0%', sub: `共 ${short(traffic.total)} 人/週` },
    isPersp
      ? { key: 'transfer', label: '轉機', value: short(transfer?.pax ?? 0), sub: '人/週在這裡轉' }
      : { key: 'transfer', label: `經${persp}轉機`, value: short(view?.now ?? 0), sub: view?.legFlown ? '人/週' : `還沒飛 ${code}⇄${persp}` },
  ];
  return (
    <Sheet title={`${a.name} ${a.code}`} onClose={onClose} action={action}
      sub={`腹地人口 ${count(a.catchment / 1e4)} 萬 · 模擬年旅客 ${(modelledAnnualPax(code) / 1e6).toFixed(1)} 百萬 · 時間帶 ${used}/${a.slotCap} 班/週 · 跑道 ${count(a.runwayM)} 公尺（最大 ${CLASS_NAMES[a.maxClass]}）${code === plan.base ? ' · 你的基地' : ''}${isHub ? ' · 轉運站' : ''}`}>
      <AirportTiles tiles={tiles} on={tab} onPick={setTab} />

      {tab === 'routes' && (
        <>
          {list.length === 0 ? <div className="hint center">你還沒有從這裡起降的航班。</div> : <Radial code={code} list={list} onPick={onOpenRoute} />}
          {list.length > 0 && <div className="hint">線的粗細是旅客數，顏色是載客率（綠 80% 以上、黃 60% 以上、紅偏低），方向大致對應實際方位。點線可開啟航線。</div>}
          {list.length > 0 && <DayStrip plan={plan} code={code} />}
          <ul className="markets">
            {list.map((s) => (
              <li key={s.key} onClick={() => onOpenRoute(s.key)} className="tapli">
                <span className="name">{AIRPORT_BY_CODE[s.other].name} <small>{s.other} · {count(s.distKm)} 公里 · 每日 {s.flightsPerDay} 班</small></span>
                {s.loadFactor !== null && <span className={`num ${tone(s.loadFactor)}`}>{pct(s.loadFactor)}</span>}
                {s.profit !== null && <span className={`pill ${s.profit >= 0 ? 'good' : 'bad'}`}>{s.profit >= 0 ? '+' : ''}{money(s.profit)}</span>}
              </li>
            ))}
          </ul>
          {view && (view.rows.length > 0 || !view.legFlown) && (
            <button className="hubteaser" onClick={() => setTab('transfer')}>
              <span className="grow"><b>經{persp}轉機的市場</b>
                <small>{view.legFlown
                  ? `現在每週 ${count(view.now)} 人經${persp}轉機 · 接上 ${view.rows.filter((r) => viaGroup(r) === 'flown').length} 個地方`
                  : `還沒飛 ${code}⇄${persp} · 開了本地約 ${count(view.local)} 人/週，再接上 ${view.unlockCount} 個地方`}</small></span>
              <span className="chev">›</span>
            </button>
          )}
          <button className="primary wide" onClick={onConnect}>從這裡開新航線</button>
          {served && <button className="secondary" onClick={onShowSchedule}>看這個機場的班表</button>}
          {served && (
            <div className="hubbox">
              <div className="grow">
                <b>轉運站</b>
                <small>{isHub ? `已啟用：這裡的轉機最短時間縮短 ${HUB_MCT_CUT} 分鐘，每週 ${money(HUB_COST_PER_WEEK)}` : `轉機最短時間縮短 ${HUB_MCT_CUT} 分鐘，每週 ${money(HUB_COST_PER_WEEK)}。同一時間只能有一個。`}</small>
              </div>
              <button className={isHub ? 'secondary' : 'primary small'} onClick={onToggleHub}>{isHub ? '取消' : '設為轉運站'}</button>
            </div>
          )}
        </>
      )}

      {tab === 'transfer' && view && (
        <FromHubView plan={plan} net={result} view={view} onOpenPair={onOpenPair} onSuggest={onSuggest} onPickHub={() => onPickAirport(persp)} />
      )}

      {tab === 'transfer' && isPersp && (
        <>
          {!served && <div className="hint center">還沒有從{code}起降的航班。先開幾條航線，旅客就能在這裡轉機。</div>}
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
    <Sheet size="full" title={`機場 · ${rows.length} 個`} onClose={onClose} sub="時間帶用量、轉機旅客、損益（兩端各算一半，不含租金）">
      {rows.length === 0 && <div className="hint center">在地圖上開航後，這裡會列出你服務的機場。</div>}
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
                <span className="name"><span className="st-title">{AIRPORT_BY_CODE[r.code].name} {r.code}{r.code === plan.base && <span className="chip">基地</span>}{r.isHub && <span className="chip">轉運站</span>}</span>
                  <small>{r.routes} 條航線 · 週旅客 {count(r.pax)}{r.transferPax > 0 ? ` · 轉機 ${count(r.transferPax)}` : ''}</small></span>
                {r.profit !== null && <span className={`pill ${r.profit >= 0 ? 'good' : 'bad'}`}>{r.profit >= 0 ? '+' : ''}{money(r.profit)}</span>}
              </div>
              <div className="util" title={`時間帶 ${r.departures}/${r.slotCap}`}><div className={`util-fill ${use >= 0.9 ? 'bad' : use >= 0.7 ? 'warn' : 'good'}`} style={{ width: `${Math.min(100, use * 100)}%` }} /></div>
              <small className="slots">{r.departures}/{r.slotCap} 班/週{use >= 0.9 ? ' · 時間帶快滿了' : ''}</small>
            </li>
          );
        })}
      </ul>
      {plan.hub && <div className="hint">轉運站 {plan.hub}：每週 {money(HUB_COST_PER_WEEK)}，轉機最短時間縮短 {HUB_MCT_CUT} 分鐘。</div>}
    </Sheet>
  );
}
