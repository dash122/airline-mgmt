import { useContext, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { AIRCRAFT, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, pairKey } from '../sim/markets';
import { rivalsBetween } from '../sim/competitors';

import { removeOneRoundTrip, units } from '../sim/schedule';
import { bestFare, clampFare, fareCurve, FARE_STEP } from '../sim/fares';
import { dayMark, dayShiftBetween } from '../sim/airports';
import {
  addRoundTrip, blockMinutes, competitionFor, DAY, flightsOn, hhmm, localMinutes, rotationInfo, routeProblem, utcFromLocal,
  simulate, type Aircraft, type AircraftResult, type NetworkResult, type Plan, type RouteResult,
} from '../sim/simulate';
import { count, money, pct, short } from './format';
import { frequencyLabel, routeHealth } from './route-health';
import { MarketShare, RouteRivals } from './rivals';
import { AirlineLink } from './airlines';
import { FedByNote } from './codeshare';
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

/** Route swatches: eight hues at matched lightness that sit with the petrol brand and stay clear of the status colours. */
const ROUTE_COLORS = ['#1f7a8c', '#4f5fc9', '#8b52b5', '#cf6a3e', '#2f8f86', '#c0517d', '#5d6e80', '#4d78a8'];
export function routeColor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROUTE_COLORS[h % ROUTE_COLORS.length];
}

export type SheetSize = 'compact' | 'half' | 'full';

/** Step through a list of things (your routes, your airports) without going back to the list. */
export type Pager = { label: string; prev?: () => void; next?: () => void };

export function Sheet({ title, sub, info, onClose, children, size = 'half', over, action, footer, summary, className, pager }: {
  title: string; sub?: ReactNode; info?: ReactNode; onClose: () => void; children: ReactNode; size?: SheetSize; over?: boolean; action?: ReactNode; footer?: ReactNode; summary?: ReactNode; className?: string;
  /** Swipe the top of the sheet sideways (or use the arrows) to move to the previous or next item. */
  pager?: Pager;
}) {
  const [s, setS] = useState<SheetSize>(size);
  const [showInfo, setShowInfo] = useState(false);
  // Drag the top of a sheet: up to expand, down to shrink, down from the smallest size to close.
  const drag = useRef<{ x: number; y: number; moved: boolean; axis: 'x' | 'y' | null } | null>(null);
  const [pull, setPull] = useState(0);
  const [slide, setSlide] = useState(0);
  const onDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button:not(.grab), a, input, select, summary')) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, axis: null };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const dy = e.clientY - d.y, dx = e.clientX - d.x;
    if (!d.axis && Math.hypot(dx, dy) > 6) { d.moved = true; d.axis = pager && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'; }
    if (d.axis === 'x') setSlide((dx < 0 && pager?.next) || (dx > 0 && pager?.prev) ? dx : dx / 4);
    else if (d.axis === 'y') setPull(Math.max(0, dy));
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current; drag.current = null; setPull(0); setSlide(0);
    if (!d || !d.moved) return;
    if (d.axis === 'x') {
      const dx = e.clientX - d.x;
      if (dx < -60) pager?.next?.();
      else if (dx > 60) pager?.prev?.();
      return;
    }
    const dy = e.clientY - d.y;
    if (Math.abs(dy) < 36) return;
    if (dy < 0) setS(s === 'compact' ? 'half' : 'full');
    else if (s === 'full') setS('half');
    else if (s === 'half' && summary) setS('compact');
    else if (!over) onClose();
  };
  const cycle = () => { if (drag.current?.moved) return; setS(s === 'compact' ? 'half' : s === 'half' ? 'full' : summary ? 'compact' : 'half'); };
  return (
    <>
      {over && <div className="scrim" onClick={onClose} />}
      <div className={`sheet ${s}${over ? ' over' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-label={title}
        style={pull ? { transform: `translateY(${pull}px)`, transition: 'none' } : undefined}>
        <div className="sheet-top" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setPull(0); setSlide(0); }}
          style={slide ? { transform: `translateX(${slide}px)`, opacity: 1 - Math.min(0.5, Math.abs(slide) / 300), transition: 'none' } : undefined}>
        <button className="grab" onClick={cycle} aria-label={s === 'full' ? '縮小' : '展開'}><span /></button>
        <div className="sheet-head">
          <div className="grow">
            <h3>{title}{info && <InfoDot open={showInfo} onClick={() => setShowInfo(!showInfo)} />}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
          {pager && (pager.prev || pager.next) && <span className="pager" role="group" aria-label="上一個或下一個">
            <button onClick={pager.prev} disabled={!pager.prev} aria-label="上一個">‹</button>
            <small>{pager.label}</small>
            <button onClick={pager.next} disabled={!pager.next} aria-label="下一個">›</button>
          </span>}
          <button className="close" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        </div>
        {s === 'compact' ? <div className={`sheet-body compact-body${className ? ` ${className}-compact` : ''}`}>{summary}<button className="secondary" onClick={() => setS('half')}>查看詳情</button></div> : <div className="sheet-body">
          {info && showInfo && <div className="info-note" onClick={() => setShowInfo(false)}>{info}</div>}
          {children}
        </div>}
        {footer && s !== 'compact' && <div className="sheet-foot">{footer}</div>}
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

type RouteTab = 'fare' | 'flights' | 'market' | 'times';

export function RouteSheet({ plan, routeKey, result, onFare, onAdd, onRemoveOne, onClose, onEditFlight, onCloseRoute, action, net, size = 'compact', pager }: {
  plan: Plan; routeKey: string; result?: RouteResult; net?: NetworkResult | null; onFare: (mult: number) => void; onAdd: () => void; onRemoveOne: () => void;
  onClose: () => void; onEditFlight: (acId: string, leg: number) => void; onCloseRoute: () => void; action?: ReactNode; size?: SheetSize; pager?: Pager;
}) {
  const [a, b] = routeKey.split('-');
  const airlineLink = useContext(AirlineLink);
  const m = marketBetween(a, b);
  const flights = flightsOn(plan, routeKey);
  const daily = flights.length / 2;
  const fareMult = plan.fares[routeKey] ?? 1;
  const setFare = (x: number) => onFare(clampFare(x));
  // Try every fare step on this route. Uses the whole network's profit, since connecting travellers pay part of it too.
  const curve = useMemo(() => (flights.length ? fareCurve(plan, routeKey) : []), [plan, routeKey, flights.length]);
  const best = bestFare(curve);
  const now = curve.find((p) => Math.abs(p.mult - fareMult) < 0.01);
  const betterFare = best && now && best !== now && best.profit - now.profit > 1 ? best : null;
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
  const [tab, setTab] = useState<RouteTab>('fare');
  const split = useMemo(() => marketSplit(a, b, result, net), [a, b, result, net]);
  const routeCompetitors = useMemo(() => [...new Map(rivalsBetween(a, b).map((service) => [service.airline.id, service.airline])).values()], [a, b]);
  const explained = result && why ? explainRoute(why, result, split) : null;
  const tap = (k: ExplainKey) => () => setWhy(why === k ? null : k);
  const profit = result ? result.revenue - result.flyingCost : 0;
  const health = routeHealth(result ? { loadFactor: result.loadFactor, spill: result.spill, profit } : null, daily);
  const fareNow = (m?.refFare ?? 0) * fareMult;
  // One line on what is going on, and the one or two things that help.
  const advice: { text: string; acts: { label: string; icon: IconName; run: () => void }[] } | null = !result ? null
    : health.key === 'full' ? { text: '想搭的人比座位多', acts: [{ label: '加一班', icon: 'plus', run: onAdd }, { label: '漲價 5%', icon: 'up', run: () => setFare(fareMult + FARE_STEP) }] }
    : health.key === 'loss' ? { text: '收入付不起飛行成本', acts: [...(betterFare ? [{ label: `改最賺票價 NT$${count((m?.refFare ?? 0) * betterFare.mult)}`, icon: 'fare' as IconName, run: () => setFare(betterFare.mult) }] : []), ...(daily > 1 ? [{ label: '減一班', icon: 'seat' as IconName, run: onRemoveOne }] : [])] }
    : health.key === 'empty' ? { text: '座位比旅客多很多', acts: [...(daily > 1 ? [{ label: '減一班', icon: 'seat' as IconName, run: onRemoveOne }] : []), { label: '降價 5%', icon: 'down', run: () => setFare(fareMult - FARE_STEP) }] }
    : betterFare ? { text: '還有更賺的票價', acts: [{ label: `改成 NT$${count((m?.refFare ?? 0) * betterFare.mult)}`, icon: 'fare', run: () => setFare(betterFare.mult) }] }
    : { text: '載客和損益都不錯', acts: [] };
  // What one more or one fewer daily round trip would do to the whole network's weekly profit (lease included).
  const freqWhatIf = useMemo(() => {
    if (!net) return null;
    const base = net.revenue - net.cost;
    const more = addRoundTrip(plan, a, b);
    const fewer = removeOneRoundTrip(plan, routeKey, localMinutes);
    const delta = (p: Plan) => { const r = simulate(p); return r.revenue - r.cost - base; };
    return { add: 'error' in more ? null : delta(more.plan), remove: fewer ? delta(fewer) : null };
  }, [plan, net, a, b, routeKey]);
  const tabs: [RouteTab, string][] = [['fare', '票價'], ['flights', `航班 ${flights.length}`], ['market', '市場'], ['times', '時刻']];
  return (
    <Sheet size={size} pager={pager} className="route-sheet" summary={<div className="route-preview-summary">
      <div className="route-preview-load"><span>載客率</span><strong className={result ? tone(result.loadFactor) : ''}>{result ? pct(result.loadFactor) : '—'}</strong>{result && <Ring value={result.loadFactor} tone={tone(result.loadFactor)} size={28} stroke={4} />}</div>
      <div className="route-preview-meta"><b>{frequencyLabel(daily)}</b><span>{result ? `${Math.round(result.pax).toLocaleString()} / ${Math.round(result.seats).toLocaleString()} 人／週` : '正在更新旅客數'}</span></div>
      <div className="route-preview-profit"><span>每週航段損益</span><b className={result && profit < 0 ? 'bad' : 'good'}>{result ? money(profit) : '—'}</b></div>
    </div>} title={routeName(a, b)} sub={<span className="ins"><b>{a}–{b}</b><IN n="long" v={count(m?.distKm ?? 0)} label="距離" u="公里" />{types && <IN n="plane" v={types} label="機型" />}</span>} onClose={onClose} action={action}
      info={<>
        <p>點數字看原因。損益是每週航段損益，不含飛機租金。</p>
        {result && result.pax - result.localPax > 1 && <p>轉機旅客付直飛票價的 85%，再按兩段的票價設定分攤，所以這裡改票價也會影響他們。</p>}
      </>}
      footer={<div className="route-freq">
        <span><small>班次</small><b>{frequencyLabel(daily)}</b></span>
        <span className="pm freq-pm">
          <button onClick={onRemoveOne} disabled={daily < 1} aria-label={`減一班來回${freqWhatIf?.remove != null ? `，週損益 ${signed(freqWhatIf.remove)}` : ''}`}>−{freqWhatIf?.remove != null && <small className={freqWhatIf.remove >= 0 ? 'good' : 'bad'}>{signed(freqWhatIf.remove)}</small>}</button>
          <button onClick={onAdd} aria-label={`加一班來回${freqWhatIf?.add != null ? `，週損益 ${signed(freqWhatIf.add)}` : ''}`}>＋{freqWhatIf?.add != null && <small className={freqWhatIf.add >= 0 ? 'good' : 'bad'}>{signed(freqWhatIf.add)}</small>}</button>
        </span>
      </div>}>
      {advice && (
        <div className={`route-advice ${health.key}`}>
          <div className="route-advice-head"><Badge n={health.icon} tone={health.tone}>{health.label}</Badge><span>{advice.text}</span></div>
          {advice.acts.length > 0 && <div className="route-advice-acts">{advice.acts.map((x) => <button key={x.label} onClick={x.run}><Icon n={x.icon} /> {x.label}</button>)}</div>}
        </div>
      )}
      {result && <div className="route-kpis">
        <button className={why === 'lf' ? 'on' : ''} onClick={tap('lf')} aria-expanded={why === 'lf'}>
          <small>載客率</small>
          <span className="route-kpi-v"><Ring value={result.loadFactor} tone={tone(result.loadFactor)} size={22} stroke={4} /><b className={tone(result.loadFactor)}>{pct(result.loadFactor)}</b></span>
          <small>{short(result.pax)}/{short(result.seats)} 人</small>
        </button>
        <button className={why === 'profit' ? 'on' : ''} onClick={tap('profit')} aria-expanded={why === 'profit'}>
          <small>週損益</small><b className={profit >= 0 ? 'good' : 'bad'}>{profit >= 0 ? '+' : ''}{money(profit)}</b><small>不含租金</small>
        </button>
        <button className={why === 'share' ? 'on' : ''} onClick={tap('share')} aria-expanded={why === 'share'}>
          <small>市占</small><b>{pct(result.marketShare)}</b><small>{result.spill > 1 ? `溢出 ${short(result.spill)}` : '這條航線'}</small>
        </button>
      </div>}
      {explained && <ExplainCard e={explained} onClose={() => setWhy(null)} />}
      {result && <FedByNote net={net} routeKey={routeKey} routePax={result.pax} />}
      <div className="seg route-tabs" role="tablist" aria-label="航線內容">
        {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'fare' && <>
        {curve.length > 2 && now && best
          ? <FareControl curve={curve} now={now} best={best} refFare={m?.refFare ?? 0} onPick={setFare}
              info={<p>每個票價下整個航網的每週損益。沿曲線拖動試算，放手才套用。★ 是最賺的票價，左右方向鍵也能調整。</p>} />
          : <div className="fare route-fare"><div className="grow"><div className="label">單程票價</div><div className="price">NT${count(fareNow)} <small>市場價 {pct(fareMult)}</small></div></div></div>}
      </>}
      {tab === 'flights' && <>
        {result && <DemandBar seats={result.seats} pax={result.pax} local={result.localPax} spill={result.spill} onSpill={tap('spill')} />}
        {result && <FlightLoads a={a} b={b} flights={result.flights} plan={plan} onEdit={onEditFlight} />}
        <Confirm label="停飛這條航線" confirm={`取消全部 ${flights.length} 個航班？`} onYes={onCloseRoute} />
      </>}
      {tab === 'market' && <>
        <MarketShare a={a} b={b} result={result} net={net} split={split} />
        {(elsewhere || m?.ground) && <div className="ins">{elsewhere}{m?.ground && <span className="in" title="地面交通">🚆 {m.ground.name} {m.ground.hours}h · NT${count(m.ground.fare)}</span>}</div>}
      </>}
      {tab === 'times' && <>
        <RouteRivals key={routeKey} a={a} b={b} result={result} plan={plan} onEdit={onEditFlight} />
        {routeCompetitors.length > 0 && airlineLink && <div className="route-competitors-entry">
          <span>{routeCompetitors.length} 家航空公司經營這條航線</span>
          <div className="route-competitor-chips">{routeCompetitors.slice(0, 4).map((airline) => <button key={airline.id} className="chip" onClick={() => airlineLink(airline.id)}><i style={{ background: airline.color }} />{airline.name} <span aria-hidden="true">›</span></button>)}
            {routeCompetitors.length > 4 && <span className="hint">及其他航空公司</span>}</div>
        </div>}
      </>}
    </Sheet>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${money(n)}`;

/**
 * The fare as something you drag. The readout and the change in profit, load and spill follow your finger;
 * nothing is applied until you let go. Arrow keys step 5%.
 */
function FareControl({ curve, now, best, refFare, onPick, info }: { curve: FarePoint[]; now: FarePoint; best: FarePoint; refFare: number; onPick: (mult: number) => void; info?: ReactNode }) {
  const [scrub, setScrub] = useState<FarePoint | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const W = 320, H = 112, PAD = 10;
  const lo = Math.min(...curve.map((p) => p.profit));
  const hi = Math.max(...curve.map((p) => p.profit));
  const span = hi - lo || 1;
  const x = (i: number) => PAD + ((W - 2 * PAD) * i) / (curve.length - 1);
  const y = (v: number) => PAD + 6 + (H - 2 * PAD - 12) * (1 - (v - lo) / span);
  const pts = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.profit).toFixed(1)}`);
  const iNow = curve.indexOf(now);
  const iBest = curve.indexOf(best);
  const shown = scrub ?? now;
  const iShown = curve.indexOf(shown);
  const pointAt = (e: RPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((fx - PAD) / (W - 2 * PAD)) * (curve.length - 1));
    return curve[Math.max(0, Math.min(curve.length - 1, i))];
  };
  const commit = (p: FarePoint | null) => { setScrub(null); if (p && p !== now) onPick(p.mult); };
  const step = (d: number) => { const p = curve[Math.max(0, Math.min(curve.length - 1, iNow + d))]; if (p !== now) onPick(p.mult); };
  const dProfit = shown.profit - now.profit;
  const changed = shown !== now;
  return (
    <div className={`fare-control${scrub ? ' scrubbing' : ''}`}>
      <div className="fare-read">
        <div className="fare-price">
          <small>單程票價{info && <InfoDot open={showInfo} onClick={() => setShowInfo(!showInfo)} />}</small>
          <b>NT${count(refFare * shown.mult)}</b>
          <small>市場價 {pct(shown.mult)}{shown === best && <span className="good"> · ★ 最賺</span>}</small>
        </div>
        <div className="fare-deltas" aria-live="polite">
          <span><small>{changed ? '週損益變化' : '網路週損益'}</small><b className={!changed ? '' : dProfit >= 0 ? 'good' : 'bad'}>{changed ? signed(dProfit) : money(now.profit)}</b></span>
          <span><small>載客率</small><b className={tone(shown.loadFactor)}>{changed ? `${pct(now.loadFactor)}→${pct(shown.loadFactor)}` : pct(shown.loadFactor)}</b></span>
          <span><small>溢出</small><b>{short(shown.spill)}</b></span>
        </div>
      </div>
      {info && showInfo && <div className="info-note" onClick={() => setShowInfo(false)}>{info}</div>}
      <div className="fare-curve">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="slider" tabIndex={0} aria-label="票價，拖動試算每週損益"
          aria-valuemin={curve[0].mult * 100} aria-valuemax={curve[curve.length - 1].mult * 100} aria-valuenow={Math.round(shown.mult * 100)}
          aria-valuetext={`NT$${count(refFare * shown.mult)}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(1); }
          }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrub(pointAt(e)); }}
          onPointerMove={(e) => { if (scrub) setScrub(pointAt(e)); }}
          onPointerUp={(e) => { if (scrub) commit(pointAt(e)); }}
          onPointerCancel={() => setScrub(null)}>
          {lo < 0 && hi > 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="zero" />}
          <polygon points={`${x(0)},${H} ${pts.join(' ')} ${x(curve.length - 1)},${H}`} className="area" />
          <polyline points={pts.join(' ')} className="line" />
          <line x1={x(iBest)} x2={x(iBest)} y1={y(best.profit)} y2={H} className="best-line" />
          <circle cx={x(iBest)} cy={y(best.profit)} r={4} className="best" />
          {changed && <circle cx={x(iNow)} cy={y(now.profit)} r={4.5} className="was" />}
          <line x1={x(iShown)} x2={x(iShown)} y1={0} y2={H} className="now-line" />
          <circle cx={x(iShown)} cy={y(shown.profit)} r={scrub ? 9 : 7} className="now" />
        </svg>
        <div className="fare-axis">
          <span style={{ visibility: iBest / (curve.length - 1) < 0.3 ? 'hidden' : undefined }}>NT${count(refFare * curve[0].mult)}</span>
          <span className="best-label" style={{ left: `${Math.min(86, Math.max(14, (100 * x(iBest)) / W))}%` }}>★ NT${count(refFare * best.mult)}</span>
          <span style={{ visibility: iBest / (curve.length - 1) > 0.7 ? 'hidden' : undefined }}>NT${count(refFare * curve[curve.length - 1].mult)}</span>
        </div>
      </div>
      {best !== now && !scrub && <button className="secondary fare-best" onClick={() => onPick(best.mult)}>★ 改成最賺票價 NT${count(refFare * best.mult)} <b className="good">{signed(best.profit - now.profit)}</b></button>}
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
    <Sheet size="compact" summary={<span>利用率 {pct(info.utilisation)}{result ? ` · 每週損益 ${money(profit)}` : ' · 尚未排班'}</span>} title={`${ac.reg} · ${shortType(ac.type)}`} sub={<span className="ins"><IN n="seat" v={spec.seats} label="座位" u="座" /><IN n="lease" v={`${money(spec.ownershipPerWeek)}/週`} label="租金" w="租金" /></span>} onClose={onClose}
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
    <Sheet size="full" title="報表" sub={<span className="ins"><IN n="money" v={money(balance)} label="累計損益" w="累計" tone={balance >= 0 ? 'good' : 'bad'} /></span>} onClose={onClose}
      info={<p>每週數字是用目前的班表推估。航線損益＝票價收入減飛行與旅客成本，不含飛機租金。</p>}>
      <div className="plan-summary">
        <span>預計全網損益／週（含租金）</span>
        <strong className={result.revenue - result.cost >= 0 ? 'good' : 'bad'}>{result.revenue - result.cost >= 0 ? '+' : ''}{money(result.revenue - result.cost)}</strong>
        <span>依目前班表推估</span>
      </div>
      <details className="route-adjust">
      <summary>查看收支與營運詳情</summary>
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
      </details>
      <h4>航線 <small>每週航段損益，不含租金</small></h4>
      <ul className="report">
        {rows.map((r) => {
          const p = r.revenue - r.flyingCost;
          return (
            <li key={r.key} role="button" tabIndex={0} onClick={() => onPick(r.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.key); } }}>
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
    { key: 'fees', value: result.hubCost + result.codeshareCost, color: 'var(--warn)', label: result.codeshareCost ? '轉運站・共享費' : '轉運站費' },
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
