import { useEffect, useMemo, useState } from 'react';
import { AIRCRAFT } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, pairKey } from '../sim/markets';
import { rivalsBetween } from '../sim/competitors';
import { slotProblem } from '../sim/schedule';
import {
  applyChoice, BANDS, countryName, departsFrom, destination, destinationsFrom, flightMinutes, inBand, previewChoice, routeChoices, searchAirports,
  TIME_PRESETS, windowOf, type Destination, type DistanceBand, type RouteChoice,
} from '../sim/newroute';
import { blockMinutes, cycleOf, routePairs, utcFromLocal, type NetworkResult, type Plan } from '../sim/simulate';
import { count, money, pct, short } from './format';
import { FlightTimes } from './FlightTimes';
import { at, Sheet, shortType, Stat, tone } from './sheets';
import { TimeStepper } from './panels';
import { Badge, hm, IN, Icon, Ring } from './viz';

export type PickField = 'from' | 'to';
export interface NewRouteState { from: string; to: string | null; pick: PickField | null }

const name = (c: string) => AIRPORT_BY_CODE[c].name;
const hours = hm;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${money(n)}`;

/** Opening a route in two steps: pick the two airports (list, search or map), then see what it would earn and confirm. */
export function NewRouteSheet({ plan, result, state, onState, onHint, onDone, onClose }: {
  plan: Plan; result: NetworkResult | null; state: NewRouteState; onState: (s: NewRouteState) => void;
  onHint: (legs: [string, string][] | null) => void; onDone: (plan: Plan, msg: string, key: string) => void; onClose: () => void;
}) {
  const { from, to, pick } = state;
  const choose = (code: string) => {
    if (pick === 'from') onState({ from: code, to: to === code ? null : to, pick: to && to !== code ? null : 'to' });
    else onState({ from, to: code, pick: null });
  };
  const ends = <Ends from={from} to={to} pick={pick} onPick={(p) => onState({ ...state, pick: p })}
    onSwap={to ? () => onState({ from: to, to: from, pick }) : undefined} />;
  if (pick || !to) {
    return <PickStep key={`pick-${pick}`} plan={plan} from={from} field={pick ?? 'to'} ends={ends} onChoose={choose} onHint={onHint} onClose={onClose}
      onBack={to ? () => onState({ ...state, pick: null }) : undefined} />;
  }
  return <PlanStep key={`plan-${from}-${to}`} plan={plan} result={result} from={from} to={to} ends={ends} onHint={onHint} onDone={onDone} onClose={onClose} />;
}

/** The two ends of the route; tap one to change it. */
function Ends({ from, to, pick, onPick, onSwap }: { from: string; to: string | null; pick: PickField | null; onPick: (p: PickField) => void; onSwap?: () => void }) {
  return (
    <div className="od">
      <button className={`od-end${pick === 'from' ? ' on' : ''}`} onClick={() => onPick('from')}>
        <small>出發</small><span className="od-main"><b>{from}</b><span>{name(from)}</span></span>
      </button>
      <button className="od-swap" onClick={onSwap} disabled={!onSwap} aria-label="對調出發與目的地">⇄</button>
      <button className={`od-end${pick !== 'from' ? ' on' : ''}${to ? '' : ' empty'}`} onClick={() => onPick('to')}>
        <small>目的地</small><span className="od-main"><b>{to ?? '選擇'}</b><span>{to ? name(to) : '清單或地圖'}</span></span>
      </button>
    </div>
  );
}

// ---------- Step 1: where to ----------

function PickStep({ plan, from, field, ends, onChoose, onHint, onBack, onClose }: {
  plan: Plan; from: string; field: PickField; ends: React.ReactNode; onChoose: (code: string) => void;
  onHint: (legs: [string, string][] | null) => void; onBack?: () => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [band, setBand] = useState<DistanceBand>('all');
  const all = useMemo(() => (field === 'to' ? destinationsFrom(plan, from) : []), [plan, from, field]);
  const byCode = useMemo(() => new Map(all.map((d) => [d.code, d])), [all]);
  const rows: Destination[] = useMemo(() => {
    if (field !== 'to') return [];
    if (q.trim()) return searchAirports(q, 40).filter((a) => a.code !== from).map((a) => byCode.get(a.code) ?? destination(plan, from, a.code));
    return all.filter((d) => inBand(d, band)).slice(0, 40);
  }, [field, q, all, band, byCode, plan, from]);
  const origins = useMemo(() => {
    if (field !== 'from') return [];
    if (q.trim()) return searchAirports(q, 40).map((a) => a.code);
    const mine = new Set([plan.base, ...(plan.hub ? [plan.hub] : []), ...routePairs(plan).flatMap((r) => [r.a, r.b])]);
    return [...mine];
  }, [field, q, plan]);

  useEffect(() => {
    onHint(field === 'to' ? rows.filter((d) => !d.problem).slice(0, 8).map((d) => [from, d.code]) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, field, from]);

  return (
    <Sheet size="full" title={field === 'to' ? '飛去哪裡？' : '從哪裡出發？'}
      info={<p>{field === 'to' ? '右邊數字是每日一班直飛，每週約載多少人。' : ''}也可以縮小面板，在地圖上點機場。</p>} onClose={onClose}
      action={onBack && <button className="secondary small" onClick={onBack}>返回</button>}>
      {ends}
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search"
        placeholder="搜尋城市、國家或代碼" aria-label="搜尋機場" />
      {field === 'to' && !q.trim() && (
        <div className="chips scroll" role="tablist" aria-label="篩選">
          {BANDS.map(([k, label]) => <button key={k} role="tab" className={`chip${band === k ? ' strong' : ''}`} onClick={() => setBand(k)}>{label}</button>)}
        </div>
      )}
      {field === 'to' && (
        <>
          {rows.length === 0 && <div className="hint center">{q.trim() ? '找不到' : '沒有可飛的目的地'}</div>}
          <ul className="dests">
            {rows.map((d) => <DestRow key={d.code} from={from} d={d} onPick={() => onChoose(d.code)} />)}
          </ul>
        </>
      )}
      {field === 'from' && (
        <>
          {!q.trim() && <h4>你的機場</h4>}
          <ul className="dests">
            {origins.map((c) => (
              <li key={c}>
                <button onClick={() => onChoose(c)}>
                  <span className="name"><b>{name(c)} <em>{c}</em></b>
                    <small>{countryName(AIRPORT_BY_CODE[c])}{c === plan.base && <> <Icon n="base" label="基地" /></>}{c === plan.hub && <> <Icon n="hub" label="轉運站" /></>}</small></span>
                  <span className="chev">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

function DestRow({ from, d, onPick }: { from: string; d: Destination; onPick: () => void }) {
  const a = AIRPORT_BY_CODE[d.code];
  const seats = d.type ? AIRCRAFT[d.type].seats * 14 : 0;
  return (
    <li className={d.problem ? 'off' : ''}>
      <button onClick={onPick} disabled={!!d.problem}>
        <span className="name">
          <b>{a.name} <em>{d.code}</em>{d.served && <> <Badge n="check" tone="good" label="已開航" /></>}</b>
          <span className="ins"><span>{countryName(a)}</span>{d.type ? <IN n="clock" v={hours(flightMinutes(from, d.code, d.type))} label="飛行時間" w="飛" /> : <IN n="long" v={`${count(d.distKm)}km`} label="距離" />}{!d.problem && (d.rivalFlights ? <IN n="rival" v={count(d.rivalFlights)} label="對手班次/週" w="對手" u="班" /> : <Badge n="hub" tone="good" label="沒人直飛" />)}</span>
        </span>
        {d.problem
          ? <span className="est muted">{d.problem}</span>
          : <span className={`est ${seats && d.est >= seats * 0.8 ? 'good' : d.est >= seats * 0.5 ? 'warn' : 'bad'}`} title="每日一班直飛，每週約載"><b>{short(d.est)}</b><small>人/週</small></span>}
      </button>
    </li>
  );
}

// ---------- Step 2: how to fly it ----------

const startDep = (plan: Plan, c: RouteChoice, from: string, to: string) =>
  c.placement ? c.placement.dep : utcFromLocal(departsFrom(plan, c, from, to), 7 * 60);

function PlanStep({ plan, result, from, to, ends, onHint, onDone, onClose }: {
  plan: Plan; result: NetworkResult | null; from: string; to: string; ends: React.ReactNode;
  onHint: (legs: [string, string][] | null) => void; onDone: (plan: Plan, msg: string, key: string) => void; onClose: () => void;
}) {
  useEffect(() => { onHint([[from, to]]); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = pairKey(from, to);
  const m = marketBetween(from, to);
  const flown = routePairs(plan).some((r) => r.key === key);
  const choices = useMemo(() => routeChoices(plan, from, to), [plan, from, to]);
  // What each choice would earn at its own best-guess time: the whole week is simulated with the route added.
  const previews = useMemo(() => new Map(choices.map((c) => [c.id, previewChoice(plan, result, c, from, to, startDep(plan, c, from, to))])), [choices, plan, result, from, to]);
  const best = choices.reduce<RouteChoice | null>((b, c) => (!b || previews.get(c.id)!.networkDelta > previews.get(b.id)!.networkDelta ? c : b), null);
  const [pickId, setPickId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fine, setFine] = useState(false);
  const chosen = choices.find((c) => c.id === pickId) ?? best;
  const [depSet, setDep] = useState<number | null>(null);
  const depFrom = chosen ? departsFrom(plan, chosen, from, to) : from;
  const other = depFrom === from ? to : from;
  const w = chosen ? windowOf(chosen) : { lo: -Infinity, hi: Infinity };
  const dep = chosen ? Math.max(w.lo, Math.min(w.hi, depSet ?? startDep(plan, chosen, from, to))) : 0;
  const preview = useMemo(() => (chosen ? previewChoice(plan, result, chosen, from, to, dep) : null), [plan, result, chosen, from, to, dep]);
  const applied = useMemo(() => (chosen ? applyChoice(plan, chosen, from, to, dep) : null), [plan, chosen, from, to, dep]);
  const trip = useMemo(() => {
    if (!applied || !chosen) return null;
    const ac = applied.plan.fleet.find((x) => x.id === applied.aircraftId)!;
    const i = ac.legs.findIndex((l) => l.from === depFrom && l.to === other && l.dep === dep);
    if (i < 0 || !ac.legs[i + 1]) return null;
    const bm = blockMinutes(depFrom, other, ac.type);
    return { out: ac.legs[i], back: ac.legs[i + 1], bm, cycle: cycleOf(ac) };
  }, [applied, chosen, depFrom, other, dep]);
  const slot = slotProblem(plan, from, to);
  const rivals = useMemo(() => {
    const by = new Map<string, { name: string; color: string; freq: number }>();
    for (const s of rivalsBetween(from, to)) {
      const e = by.get(s.airline.id) ?? { name: s.airline.name, color: s.airline.color, freq: 0 };
      e.freq += s.freq;
      by.set(s.airline.id, e);
    }
    return [...by.values()].sort((x, y) => y.freq - x.freq);
  }, [from, to]);

  const fleetChoices = choices.filter((c) => c.kind === 'fleet');
  const leaseChoices = choices.filter((c) => c.kind === 'lease').sort((x, y) => previews.get(y.id)!.networkDelta - previews.get(x.id)!.networkDelta);
  const visibleLease = showAll ? leaseChoices : leaseChoices.filter((c, i) => i < 2 || c.id === chosen?.id);

  const confirm = () => {
    if (!applied || !chosen) return;
    const reg = applied.plan.fleet.find((x) => x.id === applied.aircraftId)!.reg;
    const what = `${at(depFrom, dep)} ${depFrom}→${other} 與回程`;
    onDone(applied.plan, chosen.kind === 'lease' ? `${flown ? '加開' : '開航'}！租了 ${reg}（${AIRCRAFT[chosen.type].name}），${what}` : `${flown ? '加開' : '開航'}！由 ${reg} 飛 ${what}`, key);
  };

  const optRow = (c: RouteChoice) => {
    const p = previews.get(c.id)!;
    const s = AIRCRAFT[c.type];
    const ac = c.acId ? plan.fleet.find((x) => x.id === c.acId) : undefined;
    return (
      <button key={c.id} className={`opt row-opt${chosen?.id === c.id ? ' pick' : ''}`} onClick={() => { setPickId(c.id); setDep(null); }}>
        <span className="grow">
          <b>{ac ? `${ac.reg} · ${shortType(c.type)}` : `租 ${shortType(c.type)}`}{best?.id === c.id && <> <Badge n="hub" tone="good" label="建議" /></>}</b>
          <span className="ins">{ac
            ? <IN n="util" v={`${pct(c.utilBefore ?? 0)}→${pct(c.utilAfter ?? 0)}`} label="利用率" w="利用率" />
            : <><IN n="seat" v={s.seats} label="座位" u="座" /><IN n="lease" v={`${money(s.ownershipPerWeek)}/週`} label="租金" w="租金" /></>}
            <span className={`in ${tone(p.loadFactor)}`}>載客率 <Ring value={p.loadFactor} tone={tone(p.loadFactor)} size={12} stroke={3} />{pct(p.loadFactor)}</span></span>
        </span>
        <span className={`delta ${p.networkDelta >= 0 ? 'good' : 'bad'}`} title="每週">{signed(p.networkDelta)}<small>/週</small></span>
      </button>
    );
  };

  return (
    <Sheet size="full" title={flown ? '這條航線再加一班' : '開新航線'} onClose={onClose}
      sub={<span className="ins"><IN n="long" v={`${count(m?.distKm ?? 0)}km`} label="距離" />{chosen && <IN n="clock" v={hours(blockMinutes(from, to, chosen.type))} label="單程" w="單程" />}</span>}
      info={<>
        <p>全網週損益＝開航後整個航空公司每週多賺多少，已含{preview?.lease ? '新飛機租金、' : ''}轉機旅客與對其他航線的影響。</p>
        <p>早上 7–10 點與傍晚 4–8 點的航班最好賣。{chosen?.kind === 'fleet' ? '現有飛機只能排在它的空檔裡。' : ''}開航後可在航線頁調整票價、加減班次。</p>
      </>}
      footer={<button className="primary grow" onClick={confirm} disabled={!!slot || !chosen}>
        {slot ?? (!chosen ? '沒有機型能飛這條航線' : `${flown ? '加開' : '開航'} · 每${trip && trip.cycle > 1 ? ` ${trip.cycle} 天` : '日'} ${at(depFrom, dep)} 出發`)}
      </button>}>
      {ends}

      {preview && (
        <div className="stats">
          <Stat label="旅客/週" icon="pax" value={count(preview.pax)} />
          <Stat label="載客率" icon="seat" value={pct(preview.loadFactor)} tone={tone(preview.loadFactor)}
            viz={<Ring value={preview.loadFactor} tone={tone(preview.loadFactor)} size={22} stroke={4} />} />
          <Stat label="損益/週" icon="money" value={signed(preview.networkDelta)} tone={preview.networkDelta >= 0 ? 'good' : 'bad'} />
        </div>
      )}
      {preview && preview.loadFactor >= 0.97 && <div className="hint warn"><Icon n="spill" /> 幾乎客滿：換大飛機或之後加班</div>}

      <h4>飛機</h4>
      {choices.length === 0 && <div className="hint center">航程或跑道不夠，沒有機型能飛</div>}
      <div className="options">
        {fleetChoices.map(optRow)}
        {visibleLease.map(optRow)}
      </div>
      {leaseChoices.length > visibleLease.length && <button className="ghost" onClick={() => setShowAll(true)}>全部 {leaseChoices.length} 種機型</button>}

      {chosen && (
        <>
          <h4>{depFrom} 出發（當地時間）</h4>
          <div className="chips">
            {TIME_PRESETS.map(([local, label]) => {
              const t = utcFromLocal(depFrom, local);
              const ok = t >= w.lo && t <= w.hi;
              return <button key={local} className={`chip${Math.abs(dep - t) < 1 ? ' strong' : ''}`} disabled={!ok} onClick={() => setDep(t)}>{label} {at(depFrom, t)}</button>;
            })}
          </div>
          {fine ? <TimeStepper code={depFrom} dep={dep} lo={w.lo} hi={w.hi} onChange={setDep} />
            : <button className="ghost" onClick={() => setFine(true)}>微調時間</button>}
          {trip && (
            <div className="trip">
              <FlightTimes from={trip.out.from} to={trip.out.to} dep={trip.out.dep} arr={trip.out.dep + trip.bm} />
              <FlightTimes from={trip.back.from} to={trip.back.to} dep={trip.back.dep} arr={trip.back.dep + trip.bm} />
            </div>
          )}
          {trip && trip.cycle > 1 && <div className="hint">來回超過一天：每 {trip.cycle} 天飛一趟</div>}
        </>
      )}
      <h4><Icon n="rival" /> 對手</h4>
      <div className="market-line ins lg">
        <IN n="pax" v={short((m?.airDemand ?? 0) * 2)} label="旅客/週" u="人/週" />
        {rivals.length > 0
          ? <><IN n="rival" v={rivals.length} label="家" u="家" /><IN n="plane" v={count(rivals.reduce((s, r) => s + r.freq, 0))} label="班/週" /></>
          : <Badge n="hub" tone="good" label="沒人直飛，你會是唯一一家" />}
      </div>
      {rivals.length > 0 && (
        <div className="competition">
          {rivals.slice(0, 5).map((r) => <span key={r.name}><i className="dot" style={{ background: r.color }} />{r.name} {r.freq} 班</span>)}
          {rivals.length > 5 && <span>另 {rivals.length - 5} 家</span>}
        </div>
      )}
      {m?.ground && <div className="hint">🚆 {m.ground.name} {m.ground.hours}h · NT${count(m.ground.fare)}</div>}
    </Sheet>
  );
}
