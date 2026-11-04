import { useMemo, useState, type ReactNode } from 'react';
import { AIRCRAFT } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, pairKey } from '../sim/markets';
import { units } from '../sim/schedule';
import { bestFare, clampFare, fareCurve, FARE_MAX, FARE_MIN, FARE_STEP } from '../sim/fares';
import { dayMark, dayShiftBetween } from '../sim/airports';
import {
  blockMinutes, competitionFor, DAY, flightsOn, hhmm, localMinutes, rotationInfo, routeProblem, utcFromLocal,
  type Aircraft, type AircraftResult, type NetworkResult, type Plan, type RouteResult,
} from '../sim/simulate';
import { count, money, pct } from './format';
import { MarketShare, RouteRivals } from './rivals';
import { ExplainCard, explainRoute, type ExplainKey } from './explain';
import { marketSplit } from '../sim/share';
import type { DayRecord } from './clock';

export const routeName = (a: string, b: string) => `${AIRPORT_BY_CODE[a].name} ⇄ ${AIRPORT_BY_CODE[b].name}`;
export const tone = (lf: number) => (lf >= 0.8 ? 'good' : lf < 0.6 ? 'bad' : 'warn');
/** Clock time at an airport, from UTC minutes. */
export const at = (code: string, utc: number) => hhmm(localMinutes(code, utc));
/** Arrival clock time at the destination, with +1 / -1 when it is on another date than the departure. */
export const arrivalAt = (from: string, depUtc: number, to: string, arrUtc: number) => {
  const mark = dayMark(dayShiftBetween(from, to, depUtc, arrUtc));
  return mark ? `${at(to, arrUtc)} ${mark}` : at(to, arrUtc);
};
export const arrival = (ac: Aircraft, i: number) => {
  const l = ac.legs[i];
  return l.dep + blockMinutes(l.from, l.to, ac.type);
};

const ROUTE_COLORS = ['#2f6fb3', '#7a5cc4', '#2e9d6a', '#d9822b', '#3d8fa3', '#c2507a', '#8a7a2a', '#5a6fd6'];
export function routeColor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROUTE_COLORS[h % ROUTE_COLORS.length];
}

export type SheetSize = 'half' | 'full';

export function Sheet({ title, sub, onClose, children, size = 'half', over, action, footer }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; size?: SheetSize; over?: boolean; action?: ReactNode; footer?: ReactNode;
}) {
  const [s, setS] = useState<SheetSize>(size);
  return (
    <>
      {over && <div className="scrim" onClick={onClose} />}
      <div className={`sheet ${s}${over ? ' over' : ''}`} role="dialog" aria-label={title}>
        <button className="grab" onClick={() => setS(s === 'half' ? 'full' : 'half')} aria-label={s === 'half' ? '展開' : '縮小'}><span /></button>
        <div className="sheet-head">
          <div className="grow">
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
          <button className="close" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Stat({ label, value, tone, onTap, active }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; onTap?: () => void; active?: boolean }) {
  if (onTap) return (
    <button className={`stat tappable ${tone ?? ''}${active ? ' on' : ''}`} onClick={onTap} aria-expanded={!!active} aria-label={`${label} ${value}，點選看原因`}>
      <span className="label">{label} <i className="why-dot">?</i></span>
      <span className="value">{value}</span>
    </button>
  );
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

export function UtilBar({ value }: { value: number }) {
  return (
    <div className="util" title={`利用率 ${pct(value)}`}>
      <div className={`util-fill ${value >= 0.45 ? 'good' : value >= 0.3 ? 'warn' : 'bad'}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

/** Start of the base's local day, in UTC minutes (mod DAY). */
export const dayStart = (base: string) => utcFromLocal(base, 0);
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Pieces of each leg on a 0–24 h bar in the base's local time. A leg past midnight wraps to the start. */
export function legSegments(ac: Aircraft, base: string) {
  const start0 = dayStart(base);
  const out: { i: number; left: number; width: number; label: string; color: string }[] = [];
  ac.legs.forEach((l, i) => {
    const bm = blockMinutes(l.from, l.to, ac.type);
    const s = mod(l.dep - start0, DAY);
    const parts = s + bm > DAY ? [[s, DAY - s], [0, s + bm - DAY]] : [[s, bm]];
    parts.forEach(([p, w], k) => out.push({ i, left: (p / DAY) * 100, width: (w / DAY) * 100, label: k === 0 ? l.to : '', color: routeColor(pairKey(l.from, l.to)) }));
  });
  return out;
}

/** A 24-hour bar of the aircraft's day, in the base's local time. */
export function DayBar({ ac, base, compact, selected, onLeg }: { ac: Aircraft; base: string; compact?: boolean; selected?: number[]; onLeg?: (i: number) => void }) {
  return (
    <div className={`daybar${compact ? ' compact' : ''}`} aria-label="每日排班">
      {legSegments(ac, base).map((s, k) => (
        <div key={k} className={`dseg${selected?.includes(s.i) ? ' sel' : ''}`} style={{ left: `${s.left}%`, width: `${s.width}%`, background: s.color }}
          onClick={onLeg ? (e) => { e.stopPropagation(); onLeg(s.i); } : undefined}>
          {!compact && s.width > 5 ? s.label : ''}
        </div>
      ))}
      {!compact && [6, 12, 18].map((h) => <div key={h} className="tick" style={{ left: `${(h / 24) * 100}%` }}><span>{h}</span></div>)}
    </div>
  );
}

function Confirm({ label, confirm, onYes, className }: { label: string; confirm: string; onYes: () => void; className?: string }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <div className="confirm">
      <span>{confirm}</span>
      <button className="danger solid" onClick={onYes}>確定</button>
      <button onClick={() => setAsk(false)}>取消</button>
    </div>
  ) : (
    <button className={className ?? 'danger'} onClick={() => setAsk(true)}>{label}</button>
  );
}

// ---------- Route ----------

export function RouteSheet({ plan, routeKey, result, onFare, onAdd, onRemoveOne, onClose, onEditFlight, onCloseRoute, action }: {
  plan: Plan; routeKey: string; result?: RouteResult; onFare: (mult: number) => void; onAdd: () => void; onRemoveOne: () => void;
  onClose: () => void; onEditFlight: (acId: string, leg: number) => void; onCloseRoute: () => void; action?: ReactNode;
}) {
  const [a, b] = routeKey.split('-');
  const m = marketBetween(a, b);
  const flights = flightsOn(plan, routeKey);
  const daily = flights.length / 2;
  const fareMult = plan.fares[routeKey] ?? 1;
  const setFare = (x: number) => onFare(clampFare(x));
  // Try every fare step on this route. Uses the whole network's profit, since connecting travellers pay part of it too.
  const curve = useMemo(() => (flights.length ? fareCurve(plan, routeKey) : []), [plan, routeKey, flights.length]);
  const best = bestFare(curve);
  const now = curve.find((p) => Math.abs(p.mult - fareMult) < 0.01);
  const full = !!result && result.spill > 1 && result.loadFactor >= 0.97;
  // Nobody flies these two airports: say where travellers fly today instead.
  const elsewhere = useMemo(() => {
    const comp = [competitionFor(a, b), competitionFor(b, a)];
    if (comp.some((c) => c.services.length && !c.otherAirports)) return null;
    const pairs = [...new Set(comp.flatMap((c) => c.services.map((s) => pairKey(s.from, s.to))))].map((k) => k.replace('-', '–'));
    return pairs.length ? `沒有其他航空直飛這兩個機場。旅客現在改從同城市的其他機場出發（${pairs.join('、')}），你和這些航班競爭。` : '目前沒有航空飛這兩個城市，旅客只能轉機：你是唯一的直飛。';
  }, [a, b]);
  const types = [...new Set(flights.map((f) => AIRCRAFT[f.ac.type].name))].join('、');
  const [why, setWhy] = useState<ExplainKey | null>(null);
  const split = useMemo(() => marketSplit(a, b, result), [a, b, result]);
  const explained = result && why ? explainRoute(why, result, split) : null;
  const tap = (k: ExplainKey) => () => setWhy(why === k ? null : k);
  return (
    <Sheet title={routeName(a, b)} sub={`${a}–${b} · ${count(m?.distKm ?? 0)} 公里${types ? ` · ${types}` : ''}`} onClose={onClose} action={action}>
      <div className="big-step">
        <div>
          <div className="label">每日來回</div>
          <div className="n">{Number.isInteger(daily) ? daily : daily.toFixed(1)} 班</div>
        </div>
        <div className="pm">
          <button onClick={onRemoveOne} disabled={daily < 1} aria-label="減一班來回">−</button>
          <button onClick={onAdd} aria-label="加一班來回">＋</button>
        </div>
      </div>
      {result && (
        <div className="stats">
          <Stat label="載客率" value={pct(result.loadFactor)} tone={tone(result.loadFactor)} onTap={tap('lf')} active={why === 'lf'} />
          <Stat label="週航段損益" value={money(result.revenue - result.flyingCost)} tone={result.revenue >= result.flyingCost ? 'good' : 'bad'} onTap={tap('profit')} active={why === 'profit'} />
          <Stat label="市占" value={pct(result.marketShare)} onTap={tap('share')} active={why === 'share'} />
          <Stat label="週需求" value={count(result.demand)} />
          <Stat label="轉機旅客" value={count(result.pax - result.localPax)} />
          <Stat label="溢出" value={count(result.spill)} tone={result.spill > 1 ? 'warn' : undefined} onTap={tap('spill')} active={why === 'spill'} />
        </div>
      )}
      {explained && <ExplainCard e={explained} onClose={() => setWhy(null)} />}
      {result && !why && <div className="hint">點有 ? 的數字，看它為什麼是這個數。</div>}
      {result && <DemandBar seats={result.seats} pax={result.pax} spill={result.spill} />}
      {result && result.pax - result.localPax > 1 && <div className="hint">轉機旅客付直飛票價的 85%，再按兩段航線的票價設定（依距離加權）調整，所以這裡改票價也會影響他們。要接得上：看「機場」的轉機分頁。</div>}
      {full && <div className="hint warn">客滿：每週 {count(result!.spill)} 人買不到位子（溢出），不付錢。這時降價只會少賺；漲價先減少溢出，載客率不變。或加班次、換大飛機。</div>}
      {result && result.spill > 1 && !full && <div className="hint warn">部分航班客滿（溢出 {count(result.spill)} 人），其他航班還有空位：先調整熱門時段的班次或機型，降價幫不上忙。</div>}
      {result && result.loadFactor < 0.5 && daily > 1 && <div className="hint">載客率偏低：減一班或降低票價。</div>}
      <div className="fare">
        <div className="grow">
          <div className="label">單程票價</div>
          <div className="price">NT${count((m?.refFare ?? 0) * fareMult)} <small>參考價的 {pct(fareMult)}</small></div>
        </div>
        <div className="pm small">
          <button onClick={() => setFare(fareMult - FARE_STEP)} disabled={fareMult <= FARE_MIN} aria-label="降價 5%">−5%</button>
          <button onClick={() => setFare(fareMult + FARE_STEP)} disabled={fareMult >= FARE_MAX} aria-label="漲價 5%">+5%</button>
        </div>
      </div>
      {best && now && (best === now
        ? <div className="hint">這已經是最賺的票價。</div>
        : <button className="fare-tip" onClick={() => setFare(best.mult)}>
            最賺票價：參考價的 {pct(best.mult)}（NT${count((m?.refFare ?? 0) * best.mult)}），載客率 {pct(best.loadFactor)} · 全網週利潤 +{money(best.profit - now.profit)}
          </button>)}
      <MarketShare a={a} b={b} result={result} split={split} />
      {elsewhere && <div className="hint">{elsewhere}</div>}
      {m?.ground && <div className="competition"><span>{m.ground.name} {m.ground.hours} 小時 · NT${count(m.ground.fare)}</span></div>}
      <h4>航線班表</h4>
      <RouteRivals key={routeKey} a={a} b={b} result={result} plan={plan} onEdit={onEditFlight} />
      <Confirm label="停飛此航線" confirm={`取消全部 ${flights.length} 個航班？`} onYes={onCloseRoute} />
    </Sheet>
  );
}

/** Seats against the travellers who want them: the part past the seats is spill. */
function DemandBar({ seats, pax, spill }: { seats: number; pax: number; spill: number }) {
  const want = pax + spill;
  const scale = Math.max(seats, want, 1);
  return (
    <div className="demand-bar" aria-label={`每週座位 ${count(seats)}，想搭 ${count(want)}，載客 ${count(pax)}，溢出 ${count(spill)}`}>
      <div className="track">
        <div className="seats" style={{ width: `${(100 * seats) / scale}%` }} />
        <div className="pax" style={{ width: `${(100 * pax) / scale}%` }} />
        {spill > 1 && <div className="spill" style={{ left: `${(100 * pax) / scale}%`, width: `${(100 * spill) / scale}%` }} />}
      </div>
      <div className="legend">
        <span><i className="pax" />載客 {count(pax)}</span>
        <span><i className="seats" />座位 {count(seats)}</span>
        {spill > 1 && <span><i className="spill" />溢出 {count(spill)}</span>}
      </div>
    </div>
  );
}

// ---------- Aircraft ----------

export function AircraftSheet({ plan, ac, result, onChange, onRemove, onClose, onEditFlight, onAddHere }: {
  plan: Plan; ac: Aircraft; result?: AircraftResult; onChange: (ac: Aircraft) => void; onRemove: () => void; onClose: () => void;
  onEditFlight: (leg: number) => void; onAddHere: (k: number) => void;
}) {
  const info = rotationInfo(ac);
  const spec = AIRCRAFT[ac.type];
  const here = ac.legs.length ? ac.legs[ac.legs.length - 1].to : plan.base;
  const start = ac.legs[0]?.from;
  const addReturn = () => {
    const last = ac.legs[ac.legs.length - 1];
    const dep = Math.ceil((last.dep + blockMinutes(last.from, last.to, ac.type) + spec.turnMin) / 5) * 5;
    onChange({ ...ac, legs: [...ac.legs, { from: here, to: start!, dep }] });
  };
  const canReturn = start && here !== start && !routeProblem(here, start, ac.type);
  const profit = result ? result.revenue - result.flyingCost - result.ownershipCost : 0;
  return (
    <Sheet title={`${ac.reg} · ${spec.name}`} sub={`${spec.seats} 座 · 租金 ${money(spec.ownershipPerWeek)}/週 · 飛行 ${money(spec.costPerBlockHour)}/小時`} onClose={onClose}>
      <div className="util-row">
        <div className="label">利用率 {pct(info.utilisation)} · {info.cycleDays > 1 ? `每 ${info.cycleDays} 天一輪（長程）· ` : ''}平均每日飛 {(info.blockMin / 60).toFixed(1)} 小時 · 地面 {((DAY - info.blockMin) / 60).toFixed(1)} 小時（{AIRPORT_BY_CODE[plan.base].name}時間）</div>
        <DayBar ac={ac} base={plan.base} onLeg={onEditFlight} />
      </div>
      {!info.closed && (
        <div className="warn-box">
          <span>最後停在 {AIRPORT_BY_CODE[here].name}，沒回到 {AIRPORT_BY_CODE[start!].name}：明天無法重複這個排班。</span>
          {canReturn && <button onClick={addReturn}>加回程至 {start}</button>}
        </div>
      )}
      {!info.fits && <div className="warn-box"><span>排班超過 {info.cycleDays * 24} 小時，請取消一班。</span></div>}
      {result && (
        <div className="stats">
          <Stat label="週載客" value={count(result.pax)} />
          <Stat label="載客率" value={pct(result.seats ? result.pax / result.seats : 0)} tone={tone(result.seats ? result.pax / result.seats : 0)} />
          <Stat label="週損益（含租金）" value={money(profit)} tone={profit >= 0 ? 'good' : 'bad'} />
        </div>
      )}
      <h4>每日航班（當地時間）</h4>
      {ac.legs.length === 0 && <div className="hint center">這架飛機還沒有航班。</div>}
      <ul className="timetable">
        {units(ac).map((u) => {
          const l = ac.legs[u.start];
          const last = u.start + u.count - 1;
          return (
            <li key={u.start} className="tap" onClick={() => onEditFlight(u.start)}>
              <span className="t">{at(l.from, l.dep)}</span>
              <span className="name">
                {u.count === 2 ? `${l.from} ⇄ ${l.to}` : `${l.from} → ${l.to}`}
                <small>{u.count === 2 ? `回到 ${l.from} ${arrivalAt(ac.legs[last].from, ac.legs[last].dep, l.from, arrival(ac, last))}` : `抵達 ${arrivalAt(l.from, l.dep, l.to, arrival(ac, last))}`} · {AIRPORT_BY_CODE[l.to].name}</small>
              </span>
              <span className="chev">調整 ›</span>
            </li>
          );
        })}
      </ul>
      <button className="primary" onClick={() => onAddHere(ac.legs.length)}>從{AIRPORT_BY_CODE[here].name}加一班來回</button>
      <Confirm label="退租這架飛機" confirm={`退租 ${ac.reg}，取消它的 ${ac.legs.length} 個航班？`} onYes={onRemove} />
    </Sheet>
  );
}

// ---------- Report ----------

export function ResultsSheet({ result, history, balance, onPick, onClose }: {
  result: NetworkResult; history: DayRecord[]; balance: number; onPick: (key: string) => void; onClose: () => void;
}) {
  const rows = Object.values(result.routes).sort((x, y) => (y.revenue - y.flyingCost) - (x.revenue - x.flyingCost));
  const recent = history.slice(-14);
  const peak = Math.max(1, ...recent.map((d) => Math.abs(d.revenue - d.cost)));
  return (
    <Sheet size="full" title="營運報表" sub={`累計損益 ${money(balance)} · 每週 ${count(result.flights)} 班 · 轉機旅客 ${count(result.connectingPax)}/週`} onClose={onClose}>
      {recent.length > 0 && (
        <>
          <h4>每日損益（近 {recent.length} 天）</h4>
          <div className="days">
            {recent.map((d) => {
              const p = d.revenue - d.cost;
              return (
                <div key={d.day} className="day" title={`第 ${d.day} 天 ${money(p)}`}>
                  <div className="half">{p >= 0 && <div className="bar good" style={{ height: `${(p / peak) * 100}%` }} />}</div>
                  <div className="half neg">{p < 0 && <div className="bar bad" style={{ height: `${(-p / peak) * 100}%` }} />}</div>
                  <small>{d.day}</small>
                </div>
              );
            })}
          </div>
        </>
      )}
      <h4>目前航班表每週預估</h4>
      <div className="stats">
        <Stat label="收入" value={money(result.revenue)} />
        <Stat label="飛行與旅客成本" value={money(result.flyingCost)} />
        <Stat label="飛機租金" value={money(result.ownershipCost)} />
        <Stat label="損益" value={money(result.revenue - result.cost)} tone={result.revenue >= result.cost ? 'good' : 'bad'} />
        <Stat label="平均利用率" value={pct(result.avgUtilisation)} />
        <Stat label="載客率" value={pct(result.loadFactor)} tone={tone(result.loadFactor)} />
      </div>
      <h4>航線（航段收入減飛行與旅客成本，不含租金）</h4>
      <ul className="report">
        {rows.map((r) => (
          <li key={r.key} onClick={() => onPick(r.key)}>
            <span className="name">{routeName(r.a, r.b)}<small>每週 {r.flightsPerWeek} 班 · {count(r.pax)} 人</small></span>
            <span className={`num ${tone(r.loadFactor)}`}>{pct(r.loadFactor)}</span>
            <span className={`num ${r.revenue >= r.flyingCost ? 'good' : 'bad'}`}>{money(r.revenue - r.flyingCost)}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export { pairKey };
