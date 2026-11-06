import { useMemo, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { AIRCRAFT, type AircraftModel } from '../data/aircraft';
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
import { FlightLoads, LoadPill } from './FlightLoads';
import { Badge, IN, Icon, ProfitBar, Ring, Stack, type IconName } from './viz';
import type { FarePoint } from '../sim/fares';

/** "A320neo" rather than "Airbus A320neo". */
export const shortType = (t: AircraftModel) => AIRCRAFT[t].name.replace(/^(Airbus|Boeing|Embraer|ATR|De Havilland|Bombardier) /, '');
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

export function Sheet({ title, sub, info, onClose, children, size = 'half', over, action, footer }: {
  title: string; sub?: ReactNode; info?: ReactNode; onClose: () => void; children: ReactNode; size?: SheetSize; over?: boolean; action?: ReactNode; footer?: ReactNode;
}) {
  const [s, setS] = useState<SheetSize>(size);
  const [showInfo, setShowInfo] = useState(false);
  return (
    <>
      {over && <div className="scrim" onClick={onClose} />}
      <div className={`sheet ${s}${over ? ' over' : ''}`} role="dialog" aria-label={title}>
        <button className="grab" onClick={() => setS(s === 'half' ? 'full' : 'half')} aria-label={s === 'half' ? '展開' : '縮小'}><span /></button>
        <div className="sheet-head">
          <div className="grow">
            <h3>{title}{info && <InfoDot open={showInfo} onClick={() => setShowInfo(!showInfo)} />}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
          <button className="close" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        <div className="sheet-body">
          {info && showInfo && <div className="info-note" onClick={() => setShowInfo(false)}>{info}</div>}
          {children}
        </div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

/** A small ⓘ that opens a note. Explanations stay out of the way until someone asks for them. */
export function InfoDot({ open, onClick }: { open: boolean; onClick: () => void }) {
  return <button className={`info-dot${open ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onClick(); }} aria-expanded={open} aria-label={open ? '收起說明' : '說明'}>i</button>;
}

/** A section heading with an optional ⓘ note and something on the right (a toggle, a count). */
export function Head({ children, info, right }: { children: ReactNode; info?: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="sec-head">
        <h4>{children}{info && <InfoDot open={open} onClick={() => setOpen(!open)} />}</h4>
        {right}
      </div>
      {info && open && <div className="info-note" onClick={() => setOpen(false)}>{info}</div>}
    </>
  );
}

/** A number tile. `viz` puts a small picture (a ring, a bar) beside the number. */
export function Stat({ label, value, tone, onTap, active, viz, icon }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; onTap?: () => void; active?: boolean; viz?: ReactNode; icon?: IconName }) {
  const v = viz ? <span className="value-row"><span className="value">{value}</span>{viz}</span> : <span className="value">{value}</span>;
  if (onTap) return (
    <button className={`stat tappable ${tone ?? ''}${active ? ' on' : ''}`} onClick={onTap} aria-expanded={!!active} aria-label={`${label} ${value}，點選看原因`}>
      <span className="label">{icon && <Icon n={icon} />}{label} <i className="why-dot">?</i></span>
      {v}
    </button>
  );
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="label">{icon && <Icon n={icon} />}{label}</span>
      {v}
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

export function RouteSheet({ plan, routeKey, result, onFare, onAdd, onRemoveOne, onClose, onEditFlight, onCloseRoute, action, net }: {
  plan: Plan; routeKey: string; result?: RouteResult; net?: NetworkResult | null; onFare: (mult: number) => void; onAdd: () => void; onRemoveOne: () => void;
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
    return pairs.length
      ? <Badge n="rival" tone="muted">對手改飛 {pairs.join('、')}</Badge>
      : <Badge n="hub" tone="good">你是唯一直飛</Badge>;
  }, [a, b]);
  const types = [...new Set(flights.map((f) => shortType(f.ac.type)))].join('、');
  const [why, setWhy] = useState<ExplainKey | null>(null);
  const [showTimes, setShowTimes] = useState(false);
  const split = useMemo(() => marketSplit(a, b, result, net), [a, b, result, net]);
  const explained = result && why ? explainRoute(why, result, split) : null;
  const tap = (k: ExplainKey) => () => setWhy(why === k ? null : k);
  return (
    <Sheet title={routeName(a, b)} sub={<span className="ins"><b>{a}–{b}</b><IN n="long" v={count(m?.distKm ?? 0)} label="距離" u="公里" />{types && <IN n="plane" v={types} label="機型" />}</span>} onClose={onClose} action={action}
      info={<>
        <p>點有 ? 的數字看原因。損益是每週航段損益，不含飛機租金。</p>
        {result && result.pax - result.localPax > 1 && <p>轉機旅客付直飛票價的 85%，再按兩段的票價設定分攤，所以這裡改票價也會影響他們。</p>}
      </>}>
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
          <Stat label="載客率" icon="seat" value={pct(result.loadFactor)} tone={tone(result.loadFactor)} onTap={tap('lf')} active={why === 'lf'}
            viz={<Ring value={result.loadFactor} tone={tone(result.loadFactor)} size={24} stroke={4} />} />
          <Stat label="損益/週" icon="money" value={money(result.revenue - result.flyingCost)} tone={result.revenue >= result.flyingCost ? 'good' : 'bad'} onTap={tap('profit')} active={why === 'profit'}
            viz={<span className="arrow">{result.revenue >= result.flyingCost ? '▲' : '▼'}</span>} />
          <Stat label="市占" icon="share" value={pct(result.marketShare)} onTap={tap('share')} active={why === 'share'}
            viz={<Ring value={result.marketShare} size={24} stroke={4} />} />
        </div>
      )}
      {explained && <ExplainCard e={explained} onClose={() => setWhy(null)} />}
      {result && <DemandBar seats={result.seats} pax={result.pax} local={result.localPax} spill={result.spill} onSpill={tap('spill')} />}
      {full && <div className="hint warn"><Icon n="spill" /> 客滿：加班、換大飛機或漲價</div>}
      {result && result.loadFactor < 0.5 && daily > 1 && <div className="hint"><Icon n="seat" /> 空位多：減一班或降價</div>}
      <div className="fare">
        <div className="grow">
          <div className="label">單程票價</div>
          <div className="price">NT${count((m?.refFare ?? 0) * fareMult)} <small>{pct(fareMult)}</small></div>
        </div>
        <div className="pm small">
          <button onClick={() => setFare(fareMult - FARE_STEP)} disabled={fareMult <= FARE_MIN} aria-label="降價 5%">−5%</button>
          <button onClick={() => setFare(fareMult + FARE_STEP)} disabled={fareMult >= FARE_MAX} aria-label="漲價 5%">+5%</button>
        </div>
      </div>
      {curve.length > 2 && now && best && <FareCurve curve={curve} now={now} best={best} refFare={m?.refFare ?? 0} onPick={setFare} />}
      {best && now && best !== now && (<button className="fare-tip" onClick={() => setFare(best.mult)} aria-label={`改用最賺票價 NT$${count((m?.refFare ?? 0) * best.mult)}，每週多賺 ${money(best.profit - now.profit)}`}>
            ★ 最賺票價 NT${count((m?.refFare ?? 0) * best.mult)} <b className="good">每週多賺 {money(best.profit - now.profit)}</b>
          </button>)}
      {result && <FlightLoads a={a} b={b} flights={result.flights} plan={plan} onEdit={onEditFlight} />}
      <MarketShare a={a} b={b} result={result} net={net} split={split} />
      {(elsewhere || m?.ground) && <div className="ins">{elsewhere}{m?.ground && <span className="in" title="地面交通">🚆 {m.ground.name} {m.ground.hours}h · NT${count(m.ground.fare)}</span>}</div>}
      <Head right={<button className="chip" aria-expanded={showTimes} onClick={() => setShowTimes(!showTimes)}>{showTimes ? '收起' : '和對手比時刻'}</button>}>航線班表</Head>
      {showTimes && <RouteRivals key={routeKey} a={a} b={b} result={result} plan={plan} onEdit={onEditFlight} />}
      <Confirm label="停飛" confirm={`取消全部 ${flights.length} 個航班？`} onYes={onCloseRoute} />
    </Sheet>
  );
}

/**
 * Weekly profit at every fare step, as a hill: the dot is today's fare, the flag the most profitable one.
 * Tap or drag along it to set the fare.
 */
function FareCurve({ curve, now, best, refFare, onPick }: { curve: FarePoint[]; now: FarePoint; best: FarePoint; refFare: number; onPick: (mult: number) => void }) {
  const W = 320, H = 72, PAD = 6;
  const lo = Math.min(...curve.map((p) => p.profit));
  const hi = Math.max(...curve.map((p) => p.profit));
  const span = hi - lo || 1;
  const x = (i: number) => PAD + ((W - 2 * PAD) * i) / (curve.length - 1);
  const y = (v: number) => PAD + 4 + (H - 2 * PAD - 8) * (1 - (v - lo) / span);
  const pts = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.profit).toFixed(1)}`);
  const iNow = curve.indexOf(now);
  const iBest = curve.indexOf(best);
  const pick = (e: RPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((fx - PAD) / (W - 2 * PAD)) * (curve.length - 1));
    const p = curve[Math.max(0, Math.min(curve.length - 1, i))];
    if (p !== now) onPick(p.mult);
  };
  return (
    <div className="fare-curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="slider" aria-label="票價與每週損益"
        aria-valuemin={curve[0].mult * 100} aria-valuemax={curve[curve.length - 1].mult * 100} aria-valuenow={now.mult * 100}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
        onPointerMove={(e) => { if (e.buttons) pick(e); }}>
        {lo < 0 && hi > 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="zero" />}
        <polygon points={`${x(0)},${H} ${pts.join(' ')} ${x(curve.length - 1)},${H}`} className="area" />
        <polyline points={pts.join(' ')} className="line" />
        <line x1={x(iBest)} x2={x(iBest)} y1={y(best.profit)} y2={H} className="best-line" />
        <circle cx={x(iBest)} cy={y(best.profit)} r={4} className="best" />
        <line x1={x(iNow)} x2={x(iNow)} y1={0} y2={H} className="now-line" />
        <circle cx={x(iNow)} cy={y(now.profit)} r={5.5} className="now" />
      </svg>
      <div className="fare-axis">
        <span>NT${count(refFare * curve[0].mult)}</span>
        <span className="best-label" style={{ left: `${Math.min(80, Math.max(20, (100 * x(iBest)) / W))}%` }}>★ NT${count(refFare * best.mult)}</span>
        <span>NT${count(refFare * curve[curve.length - 1].mult)}</span>
      </div>
    </div>
  );
}

/** Seats against the travellers who want them: local and connecting travellers, then the part past the seats (spill). */
function DemandBar({ seats, pax, local, spill, onSpill }: { seats: number; pax: number; local: number; spill: number; onSpill?: () => void }) {
  const want = pax + spill;
  const scale = Math.max(seats, want, 1);
  const via = Math.max(0, pax - local);
  return (
    <div className="demand-bar" aria-label={`每週座位 ${count(seats)}，想搭 ${count(want)}，載客 ${count(pax)}（轉機 ${count(via)}），溢出 ${count(spill)}`}>
      <div className="track">
        <div className="seats" style={{ width: `${(100 * seats) / scale}%` }} />
        <div className="pax" style={{ width: `${(100 * pax) / scale}%` }} />
        {via >= 1 && <div className="via" style={{ left: `${(100 * local) / scale}%`, width: `${(100 * via) / scale}%` }} />}
        {spill > 1 && <div className="spill" style={{ left: `${(100 * pax) / scale}%`, width: `${(100 * spill) / scale}%` }} />}
      </div>
      <div className="legend">
        <span><i className="pax" />本地 {count(local)}</span>
        {via >= 1 && <span><i className="via" />轉機 {count(via)}</span>}
        <span><i className="seats" />座位 {count(seats)}</span>
        {spill > 1 && (onSpill
          ? <button className="spill-btn" onClick={onSpill}><i className="spill" />溢出 {count(spill)} ?</button>
          : <span><i className="spill" />溢出 {count(spill)}</span>)}
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
    <Sheet title={`${ac.reg} · ${shortType(ac.type)}`} sub={<span className="ins"><IN n="seat" v={spec.seats} label="座位" u="座" /><IN n="lease" v={`${money(spec.ownershipPerWeek)}/週`} label="租金" w="租金" /></span>} onClose={onClose}
      info={<p>{spec.name}：每飛行小時 {money(spec.costPerBlockHour)}。上方色條是一天的排班（{AIRPORT_BY_CODE[plan.base].name}時間），點色塊可調整。</p>}>
      <div className="util-row">
        <div className="label util-label">
          <Ring value={info.utilisation} tone={info.utilisation >= 0.45 ? 'good' : info.utilisation >= 0.3 ? 'warn' : 'bad'} size={20} stroke={3.5} />
          <b>{pct(info.utilisation)}</b> <IN n="clock" v={`${(info.blockMin / 60).toFixed(1)}h/日`} label="每日飛行時數" w="飛" />{info.cycleDays > 1 && <IN n="calendar" v={`${info.cycleDays}天`} label="幾天一輪" w="每" />}
        </div>
        <DayBar ac={ac} base={plan.base} onLeg={onEditFlight} />
      </div>
      {!info.closed && (
        <div className="warn-box">
          <span><Icon n="warn" /> 停在 {here}，沒回到 {start}</span>
          {canReturn && <button onClick={addReturn}>加回程至 {start}</button>}
        </div>
      )}
      {!info.fits && <div className="warn-box"><span><Icon n="warn" /> 超過 {info.cycleDays * 24} 小時，請取消一班</span></div>}
      {result && (
        <div className="stats">
          <Stat label="旅客/週" icon="pax" value={count(result.pax)} />
          <Stat label="載客率" icon="seat" value={pct(result.seats ? result.pax / result.seats : 0)} tone={tone(result.seats ? result.pax / result.seats : 0)}
            viz={<Ring value={result.seats ? result.pax / result.seats : 0} tone={tone(result.seats ? result.pax / result.seats : 0)} size={22} stroke={4} />} />
          <Stat label="損益/週" icon="money" value={money(profit)} tone={profit >= 0 ? 'good' : 'bad'} />
        </div>
      )}
      <Head info="時間為當地時間。週損益含租金。">每日航班</Head>
      {ac.legs.length === 0 && <div className="hint center">還沒有航班</div>}
      <ul className="timetable">
        {units(ac).map((u) => {
          const l = ac.legs[u.start];
          const last = u.start + u.count - 1;
          return (
            <li key={u.start} className="tap" onClick={() => onEditFlight(u.start)}>
              <span className="t">{at(l.from, l.dep)}</span>
              <span className="name">
                {u.count === 2 ? `${l.from} ⇄ ${l.to}` : `${l.from} → ${l.to}`}
                <small>{AIRPORT_BY_CODE[l.to].name} · <span>{u.count === 2 ? '回到' : '抵達'} {u.count === 2 ? arrivalAt(ac.legs[last].from, ac.legs[last].dep, l.from, arrival(ac, last)) : arrivalAt(l.from, l.dep, l.to, arrival(ac, last))}</span></small>
              </span>
              {result && <span className="loads" aria-label="載客率">{Array.from({ length: u.count }, (_, k) => result.flights[u.start + k]).filter(Boolean).map((f) => <LoadPill key={f.key} f={f} />)}</span>}
              <span className="chev">›</span>
            </li>
          );
        })}
      </ul>
      <button className="primary" onClick={() => onAddHere(ac.legs.length)}>＋ 從{here}加一班來回</button>
      <Confirm label="退租" confirm={`退租 ${ac.reg}，取消 ${ac.legs.length} 個航班？`} onYes={onRemove} />
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
  const maxProfit = Math.max(1, ...rows.map((r) => Math.abs(r.revenue - r.flyingCost)));
  const anyLoss = rows.some((r) => r.revenue < r.flyingCost);
  return (
    <Sheet size="full" title="報表" sub={<span className="ins"><IN n="money" v={money(balance)} label="累計損益" w="累計" tone={balance >= 0 ? 'good' : 'bad'} /><IN n="plane" v={count(result.flights)} label="每週班次" u="班/週" /><IN n="transfer" v={count(result.connectingPax)} label="轉機旅客/週" w="轉機" /></span>} onClose={onClose}
      info={<p>每週數字是用目前的班表推估。航線損益＝票價收入減飛行與旅客成本，不含飛機租金。</p>}>
      {recent.length > 0 && (
        <>
          <h4>每日損益</h4>
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
      <h4>每週收支</h4>
      <MoneyFlow result={result} />
      <div className="stats">
        <Stat label="利用率" icon="util" value={pct(result.avgUtilisation)} viz={<Ring value={result.avgUtilisation} tone={result.avgUtilisation >= 0.45 ? 'good' : result.avgUtilisation >= 0.3 ? 'warn' : 'bad'} size={24} stroke={4} />} />
        <Stat label="載客率" icon="seat" value={pct(result.loadFactor)} tone={tone(result.loadFactor)} viz={<Ring value={result.loadFactor} tone={tone(result.loadFactor)} size={24} stroke={4} />} />
        <Stat label="轉機" icon="transfer" value={count(result.connectingPax)} viz={result.pax > 0 ? <Ring value={result.connectingPax / result.pax} tone="muted" size={24} stroke={4} /> : undefined} />
      </div>
      <h4>航線</h4>
      <ul className="report">
        {rows.map((r) => {
          const p = r.revenue - r.flyingCost;
          return (
            <li key={r.key} onClick={() => onPick(r.key)}>
              <Ring value={r.loadFactor} tone={tone(r.loadFactor)} size={30} stroke={4} label={`載客率 ${pct(r.loadFactor)}`}><small>{Math.round(r.loadFactor * 100)}</small></Ring>
              <span className="name">{routeName(r.a, r.b)}<span className="ins"><IN n="plane" v={r.flightsPerWeek} label="班/週" u="班/週" /><IN n="pax" v={count(r.pax)} label="旅客/週" u="人/週" /></span></span>
              <span className="profit-col">
                <span className={`num ${p >= 0 ? 'good' : 'bad'}`}>{p >= 0 ? '+' : ''}{money(p)}</span>
                <ProfitBar value={p} max={maxProfit} split={anyLoss} />
              </span>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/** Where each week's ticket money goes: flying costs, aircraft lease, and what is left. */
function MoneyFlow({ result }: { result: NetworkResult }) {
  const profit = result.revenue - result.cost;
  const parts = [
    { key: 'fly', value: result.flyingCost, color: 'var(--cost-fly)', label: '飛行成本' },
    { key: 'lease', value: result.ownershipCost, color: 'var(--cost-lease)', label: '租金' },
    { key: 'profit', value: Math.max(0, profit), color: 'var(--good)', label: '賺' },
  ];
  // A loss: costs are larger than revenue, so the bar is costs and a red notch shows the gap.
  const scale = Math.max(result.revenue, result.cost, 1);
  return (
    <div className="money-flow">
      <div className="mf-row">
        <span className="mf-label">收入</span>
        <div className="mf-track"><div className="mf-rev" style={{ width: `${(100 * result.revenue) / scale}%` }} /></div>
        <b className="mf-num">{money(result.revenue)}</b>
      </div>
      <div className="mf-row">
        <span className="mf-label">去向</span>
        <div className="mf-track">
          <div style={{ width: `${(100 * (result.cost + Math.max(0, profit))) / scale}%` }}>
            <Stack parts={parts} label={parts.map((p) => `${p.label} ${money(p.value)}`).join('，')} />
          </div>
        </div>
        <b className={`mf-num ${profit >= 0 ? 'good' : 'bad'}`}>{profit >= 0 ? '+' : ''}{money(profit)}</b>
      </div>
      <div className="legend">
        {parts.map((p) => p.value > 0 && <span key={p.key}><i style={{ background: p.color }} />{p.label} {money(p.value)}</span>)}
        {profit < 0 && <span className="bad-text">虧 {money(-profit)}</span>}
      </div>
    </div>
  );
}

export { pairKey };
