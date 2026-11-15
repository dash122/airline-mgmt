import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRCRAFT, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from '../sim/markets';
import {
  gapAt, insertRoundTrip, insertWindow, leaseFor, pickTime, placementOptions, removeUnit, shiftUnit, shiftWindow, slotProblem, typesFor, unitOf,
  type Placement,
} from '../sim/schedule';
import { blockMinutes, DAY, routePairs, routeProblem, topMarketsFrom, utcFromLocal, type Aircraft, type NetworkResult, type Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';
import { count, hkSigned, money, pct } from './format';
import { LoadPill } from './FlightLoads';
import { TimeStepper } from './panels';
import { arrival, at, routeName, Sheet, shortType } from './sheets';
import { Badge, hm, IN, Icon } from './viz';

/**
 * Where the service editor was opened from. It takes its defaults from there:
 * - a flight: that flight's aircraft and time, with switching aircraft and cancelling in the same sheet;
 * - a route: one more round trip on the aircraft with the most room (or a new lease), at the suggested time;
 * - a gap in an aircraft's day: first where to fly, then the same choices as a route.
 */
export type ServiceTarget =
  | { kind: 'flight'; acId: string; leg: number }
  | { kind: 'route'; key: string; prefer?: Prefer }
  | { kind: 'gap'; acId: string; t: number };
type Prefer = { from: string; dep: number; acId?: string; gap?: number };

const withAc = (plan: Plan, ac: Aircraft): Plan => ({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) });
const windowText = (code: string, lo: number, hi: number) =>
  hi - lo >= DAY - 5 ? '全天可飛' : lo === hi ? '沒有空檔可移動' : `可 ${at(code, lo)}–${at(code, hi)} 出發`;

/** The whole network's result for a draft plan (profit and every flight's loads), worked out off the main thread. */
function useDraftResult(draft: Plan | null): NetworkResult | null | 'pending' {
  const [answer, setAnswer] = useState<{ plan: Plan; result: NetworkResult } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!draft || typeof Worker === 'undefined') return;
    const w = worker.current ??= createComputeClient('simulation');
    const id = ++seq.current;
    const onMessage = (e: MessageEvent<{ id: number; result?: NetworkResult }>) => {
      if (e.data.id === id && e.data.result) setAnswer({ plan: draft, result: e.data.result });
    };
    w.addEventListener('message', onMessage);
    // Wait for the stepper to settle, so holding a button doesn't queue a simulation per tap.
    const t = setTimeout(() => w.postMessage({ id, plan: draft }), 250);
    return () => { clearTimeout(t); w.removeEventListener('message', onMessage); };
  }, [draft]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  if (!draft) return null;
  return answer?.plan === draft ? answer.result : 'pending';
}

export function ServiceEditor({ plan, result, target, onApply, onClose }: {
  plan: Plan; result: NetworkResult | null; target: ServiceTarget; onApply: (plan: Plan, msg: string) => void; onClose: () => void;
}) {
  // A gap first asks where to fly; once picked it is a route with a preferred aircraft and slot.
  const [picked, setPicked] = useState<{ key: string; prefer: Prefer } | null>(null);
  if (target.kind === 'gap' && !picked) return <GapStep plan={plan} acId={target.acId} t={target.t} onPick={(key, prefer) => setPicked({ key, prefer })} onClose={onClose} />;
  const t: Exclude<ServiceTarget, { kind: 'gap' }> = picked ? { kind: 'route', ...picked } : (target as Exclude<ServiceTarget, { kind: 'gap' }>);
  return <Editor key={JSON.stringify(t)} plan={plan} result={result} target={t} onApply={onApply} onClose={onClose} onBack={picked ? () => setPicked(null) : undefined} />;
}

function Editor({ plan, result, target, onApply, onClose, onBack }: {
  plan: Plan; result: NetworkResult | null; target: Exclude<ServiceTarget, { kind: 'gap' }>; onApply: (plan: Plan, msg: string) => void; onClose: () => void; onBack?: () => void;
}) {
  // The flight being edited, if any.
  const src = target.kind === 'flight' ? plan.fleet.find((x) => x.id === target.acId) : undefined;
  const unit = src && target.kind === 'flight' && src.legs[target.leg] ? unitOf(src, target.leg) : null;
  const srcLeg = src && unit ? src.legs[unit.start] : undefined;
  const isTrip = !unit || unit.count === 2;
  const key = srcLeg ? pairKey(srcLeg.from, srcLeg.to) : target.kind === 'route' ? target.key : '';
  const [a, b] = key.split('-');
  const prefer = target.kind === 'route' ? target.prefer : undefined;

  const opts = useMemo(() => {
    if (!a || (src && !isTrip)) return [];
    const pool = src ? { ...plan, fleet: plan.fleet.filter((x) => x.id !== src.id) } : plan;
    const choices = placementOptions(pool, a, b, srcLeg?.dep ?? prefer?.dep);
    if (prefer?.acId && prefer.gap !== undefined) {
      const option = choices.find((o) => o.ac.id === prefer.acId);
      const to = prefer.from === a ? b : a;
      const w = option && insertWindow(option.ac, prefer.gap, prefer.from, to);
      if (option && w) option.placement = { acId: option.ac.id, k: prefer.gap, from: prefer.from, to, dep: pickTime(w, prefer.dep), ...w };
    }
    return choices;
  }, [plan, a, b, src, isTrip, srcLeg?.dep, prefer]);
  const types = a ? typesFor(plan, a, b) : [];
  const firstOk = opts.findIndex((o) => o.placement);
  const preferred = opts.findIndex((o) => o.ac.id === prefer?.acId && o.placement);
  const [choice, setChoice] = useState<'keep' | number | 'lease'>(src ? 'keep' : preferred >= 0 ? preferred : firstOk >= 0 ? firstOk : 'lease');
  const [leaseType, setLeaseType] = useState<AircraftModel | undefined>(types[0]);
  const [dep, setDep] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showOthers, setShowOthers] = useState(false);

  const chosen: Placement | null = typeof choice === 'number' ? opts[choice]?.placement ?? null : null;
  const leaseFrom = b === plan.base ? b : a;
  const leaseDep = (() => {
    if (srcLeg) return srcLeg.dep;
    if (!prefer) return utcFromLocal(leaseFrom, 7 * 60);
    if (leaseFrom === prefer.from || !leaseType) return prefer.dep;
    return Math.floor((prefer.dep - blockMinutes(a, b, leaseType) - AIRCRAFT[leaseType].turnMin) / 5) * 5;
  })();
  const keepWin = src && unit ? shiftWindow(src, unit) : null;
  const lo = choice === 'keep' && keepWin && srcLeg ? srcLeg.dep + keepWin.min : chosen ? chosen.lo : -Infinity;
  const hi = choice === 'keep' && keepWin && srcLeg ? srcLeg.dep + keepWin.max : chosen ? chosen.hi : Infinity;
  const base = choice === 'keep' && srcLeg ? srcLeg.dep : chosen ? chosen.dep : leaseDep;
  const cur = Math.max(lo, Math.min(hi, dep ?? base));
  const from = choice === 'keep' && srcLeg ? srcLeg.from : chosen ? chosen.from : srcLeg?.from ?? leaseFrom;
  const to = from === a ? b : a;
  const slot = src ? null : a ? slotProblem(plan, a, b) : null;

  // The draft: what the plan would be if the player confirmed now.
  // `trip` says where the round trip's two legs sit in the draft plan, so their loads can be read from its result.
  const draft = useMemo((): { plan: Plan; msg: string; trip: { acId: string; k: number } } | null => {
    if (!a) return null;
    if (choice === 'keep') {
      if (!src || !unit || !srcLeg || cur === srcLeg.dep) return null;
      return { plan: withAc(plan, shiftUnit(src, unit, cur - srcLeg.dep)), msg: `${src.reg} 改成 ${at(from, cur)} 出發`, trip: { acId: src.id, k: unit.start } };
    }
    if (slot) return null;
    const start = src && unit ? withAc(plan, removeUnit(src, unit)) : plan;
    if (chosen) {
      const ac = start.fleet.find((x) => x.id === chosen.acId)!;
      return { plan: withAc(start, insertRoundTrip(ac, chosen.k, chosen.from, chosen.to, cur)), msg: `${src ? '已換到' : '已排入'} ${ac.reg}：${at(chosen.from, cur)} ${chosen.from}→${chosen.to} 與回程`, trip: { acId: ac.id, k: chosen.k } };
    }
    if (choice === 'lease' && leaseType) {
      const r = leaseFor(start, a, b, leaseType, cur);
      const reg = r.plan.fleet.find((x) => x.id === r.aircraftId)!.reg;
      return { plan: r.plan, msg: `租了新飛機 ${reg}（${AIRCRAFT[leaseType].name}），${at(from, cur)} 出發`, trip: { acId: r.aircraftId, k: 0 } };
    }
    return null;
  }, [plan, a, b, choice, chosen, leaseType, cur, src, unit, srcLeg, slot, from]);
  const draftResult = useDraftResult(draft?.plan ?? null);
  const draftProfit = draftResult && draftResult !== 'pending' ? draftResult.revenue - draftResult.cost : draftResult;
  const nowProfit = result ? result.revenue - result.cost : null;
  const gain = typeof draftProfit === 'number' && nowProfit !== null ? draftProfit - nowProfit : null;

  if (!a || (target.kind === 'flight' && (!src || !unit || !srcLeg))) return null;
  const delta = srcLeg ? cur - srcLeg.dep : 0;
  const cancel = () => {
    if (!src || !unit || !srcLeg) return;
    onApply(withAc(plan, removeUnit(src, unit)), `已取消 ${at(srcLeg.from, srcLeg.dep)} ${srcLeg.from}→${srcLeg.to}${isTrip ? ' 與回程' : ''}`);
  };
  // Aircraft choices: the recommended one shows; the rest sit behind one tap.
  const pickedLabel = choice === 'keep' && src ? `${src.reg} · ${shortType(src.type)}`
    : chosen ? `${opts[choice as number].ac.reg} · ${shortType(opts[choice as number].ac.type)}`
    : leaseType ? `租新 ${shortType(leaseType)}` : '沒有機型能飛';
  const pickedSub = choice === 'keep' ? '目前的飛機'
    : chosen ? `利用率 ${pct(opts[choice as number].utilBefore)}→${pct(opts[choice as number].utilAfter)}`
    : leaseType ? `租金 ${money(AIRCRAFT[leaseType].ownershipPerWeek)}/週` : '';
  const pick = (c: 'keep' | number | 'lease') => { setChoice(c); setDep(null); setShowOthers(false); };
  const label = slot ?? (!draft ? (src ? '沒有變更' : '無法加開')
    : choice === 'keep' ? `改成 ${at(from, cur)} 出發`
    : `${src ? '換到' : '加開'} ${at(from, cur)} ${from}→${to}${isTrip ? ' 與回程' : ''}`);
  const legs = src && unit ? Array.from({ length: unit.count }, (_, k) => unit.start + k) : [];
  // Loads follow the pending change: while a draft is still being simulated, no pill rather than the old time's load.
  const loadOf = (i: number) => {
    if (!src || !unit) return undefined;
    if (draft) return draftResult && draftResult !== 'pending' ? draftResult.byFlight[`${draft.trip.acId}#${draft.trip.k + i - unit.start}`] : undefined;
    return result?.byFlight[`${src.id}#${i}`];
  };

  return (
    <Sheet over size="half" title={src ? (isTrip ? `${srcLeg!.from} ⇄ ${srcLeg!.to}` : `${srcLeg!.from} → ${srcLeg!.to}`) : '加一班來回'}
      sub={<span className="ins"><span>{routeName(a, b)}</span><IN n="clock" v={hm(blockMinutes(a, b, src?.type ?? leaseType ?? 'A20N'))} label="單程" w="單程" /></span>}
      onClose={onClose} info={<p>先試，再套用：改動只會在按下按鈕後生效。早上 7–10 點與傍晚 4–8 點的航班最好賣。</p>}
      footer={<div className="svc-foot">
        <div className="svc-gain" role="status">{!draft ? '' : draftProfit === 'pending' ? <span className="hint">正在試算…</span>
          : gain !== null ? <>全網每週 <b className={gain >= 0 ? 'good' : 'bad'}>{hkSigned(gain)}</b></> : ''}</div>
        <button className="primary grow" disabled={!draft} onClick={() => draft && onApply(draft.plan, draft.msg)}>{label}</button>
      </div>}>
      {onBack && <button className="link-back" onClick={onBack}><span className="chev back" aria-hidden="true" />換目的地</button>}
      {legs.length > 0 && <ul className="timetable">
        {legs.map((i) => {
          const f = loadOf(i);
          return (
            <li key={i}>
              <span className="t">{at(src!.legs[i].from, src!.legs[i].dep + (choice === 'keep' ? delta : 0))}</span>
              <span className="name">{AIRPORT_BY_CODE[src!.legs[i].from].name} → {AIRPORT_BY_CODE[src!.legs[i].to].name}
                <small><IN n="down" v={at(src!.legs[i].to, arrival(src!, i) + (choice === 'keep' ? delta : 0))} label="抵達" w="抵達" /></small></span>
              {f && <LoadPill f={f} />}
            </li>
          );
        })}
      </ul>}

      <div>
        <div className="label">{from} 出發（當地時間）{isTrip ? ' · 回程跟著移' : ''}</div>
        <TimeStepper code={from} dep={cur} lo={lo} hi={hi} onChange={setDep} />
        <div className="hint">{Number.isFinite(lo) ? windowText(from, lo, hi) : '全天可飛'}{prefer && !prefer.acId ? ` · 建議 ${at(prefer.from, prefer.dep)} 出發，接得上轉機` : ''}</div>
      </div>

      {isTrip && (
        <div className="svc-ac">
          <button className="opt pick" onClick={() => setShowOthers(!showOthers)} aria-expanded={showOthers}>
            <span className="grow"><b><Icon n={choice === 'lease' ? 'lease' : 'plane'} /> {pickedLabel}</b><small>{pickedSub}</small></span>
            <small className="svc-change">{showOthers ? '收起' : '換飛機'}</small>
          </button>
          {showOthers && <div className="options">
            {src && choice !== 'keep' && <button className="opt" onClick={() => pick('keep')}><b>{src.reg} · {shortType(src.type)}</b><small>目前的飛機</small></button>}
            {opts.map((o, i) => i === choice || !o.placement ? null : (
              <button key={o.ac.id} className="opt" onClick={() => pick(i)}>
                <b>{o.ac.reg} · {shortType(o.ac.type)}</b>
                <small>利用率 {pct(o.utilBefore)}→{pct(o.utilAfter)}</small>
              </button>
            ))}
            {types.map((ty) => choice === 'lease' && leaseType === ty ? null : (
              <button key={ty} className="opt" onClick={() => { setLeaseType(ty); pick('lease'); }}>
                <b><Icon n="lease" /> 租新 {shortType(ty)}</b><small>{AIRCRAFT[ty].seats} 座 · {money(AIRCRAFT[ty].ownershipPerWeek)}/週</small>
              </button>
            ))}
          </div>}
        </div>
      )}

      {src && !confirmCancel && <button className="danger-text svc-cancel" onClick={() => setConfirmCancel(true)}>{isTrip ? '取消這組來回' : '取消這班'}</button>}
      {src && confirmCancel && <div className="confirm"><span>確定取消{isTrip ? '這組來回航班' : '這班航班'}？</span><button className="secondary" onClick={() => setConfirmCancel(false)}>返回</button><button className="danger solid" onClick={cancel}>確定取消</button></div>}
      {src && unit && !isTrip && unit.start + unit.count - 1 < src.legs.length - 1 && <div className="hint warn"><Icon n="warn" /> 飛機可能停在別的機場</div>}
    </Sheet>
  );
}

/** A gap in one aircraft's day: where it could fly a round trip from where it sits. */
function GapStep({ plan, acId, t, onPick, onClose }: {
  plan: Plan; acId: string; t: number; onPick: (key: string, prefer: Prefer) => void; onClose: () => void;
}) {
  const ac = plan.fleet.find((x) => x.id === acId);
  if (!ac) return null;
  const k = gapAt(ac, t);
  const station = ac.legs.length ? (k > 0 ? ac.legs[k - 1].to : ac.legs[0].from) : plan.base;
  const served = new Set(routePairs(plan).map((r) => r.key));
  const options = topMarketsFrom(station, plan, 60)
    .filter((m) => !routeProblem(station, m.to, ac.type))
    .map((m) => {
      const w = insertWindow(ac, k, station, m.to);
      return { ...m, w, dep: w ? pickTime(w, t) : 0, slot: slotProblem(plan, station, m.to) };
    })
    .filter((m) => m.w && !m.slot)
    .sort((x, y) => Number(served.has(pairKey(station, y.to))) - Number(served.has(pairKey(station, x.to))) || y.airDemand - x.airDemand)
    .slice(0, 10);
  return (
    <Sheet over size="half" title={`${ac.reg} 飛去哪裡？`} sub={<IN n="up" v={`${station} ~${at(station, pickTime({ lo: -Infinity, hi: Infinity }, t))}`} label="出發" w="出發" />} onClose={onClose}>
      {options.length === 0 && <div className="hint center">這個空檔放不下來回航班</div>}
      <ul className="markets">
        {options.map((m) => (
          <li key={m.to} className="tap" onClick={() => onPick(pairKey(station, m.to), { from: station, dep: m.dep, acId, gap: k })}>
            <span className="name">{AIRPORT_BY_CODE[m.to].name}<span className="ins"><IN n="clock" v={`${at(station, m.dep)}–${at(station, m.dep + blockMinutes(station, m.to, ac.type) * 2 + AIRCRAFT[ac.type].turnMin)}`} label="出發–回到" /><IN n="pax" v={count(m.airDemand)} label="旅客/週" u="人/週" />{served.has(pairKey(station, m.to)) && <Badge n="check" tone="good" label="已開航" />}</span></span>
            <span className="chev" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
