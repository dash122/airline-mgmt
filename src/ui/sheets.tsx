import { useState } from 'react';
import { AIRCRAFT, CLASS_NAMES, MODEL_ORDER, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, modelledAnnualPax, pairKey } from '../sim/markets';
import {
  blockMinutes, DAY, earliestDeparture, flightsOn, hhmm, localMinutes, rotationInfo, routeProblem, topMarketsFrom, weeklyDepartures,
  type Aircraft, type AircraftResult, type NetworkResult, type Plan, type RouteResult,
} from '../sim/simulate';
import { count, money, pct } from './format';
import type { DayRecord } from './clock';

export const routeName = (a: string, b: string) => `${AIRPORT_BY_CODE[a].name} ⇄ ${AIRPORT_BY_CODE[b].name}`;
const tone = (lf: number) => (lf >= 0.8 ? 'good' : lf < 0.6 ? 'bad' : 'warn');

export function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
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

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function UtilBar({ value }: { value: number }) {
  return (
    <div className="util" title={`利用率 ${pct(value)}`}>
      <div className={`util-fill ${value >= 0.45 ? 'good' : value >= 0.3 ? 'warn' : 'bad'}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

// ---------- Route ----------

export function RouteSheet({ plan, routeKey, result, onFare, onAddTrip, onPickAircraft, onClose }: {
  plan: Plan; routeKey: string; result?: RouteResult; onFare: (mult: number) => void; onAddTrip: (type: AircraftModel) => void; onPickAircraft: (id: string) => void; onClose: () => void;
}) {
  const [a, b] = routeKey.split('-');
  const m = marketBetween(a, b);
  const flights = flightsOn(plan, routeKey);
  const types = [...new Set(flights.map((f) => f.ac.type))];
  const [type, setType] = useState<AircraftModel>(types[0] ?? 'A20N');
  const fareMult = plan.fares[routeKey] ?? 1;
  return (
    <Sheet title={routeName(a, b)} sub={`${a}–${b} · ${count(m?.distKm ?? 0)} 公里 · 每日 ${flights.length} 班（雙向）`} onClose={onClose}>
      <div className="field">
        <label>票價 NT${count((m?.refFare ?? 0) * fareMult)}（參考價 {pct(fareMult)}）</label>
        <input type="range" min={70} max={140} step={5} value={Math.round(fareMult * 100)} onChange={(e) => onFare(Number(e.target.value) / 100)} />
      </div>
      <div className="competition">
        <span>其他航空 {m?.rivalFreq ? `每週 ${m.rivalFreq} 班` : '無直飛'}</span>
        {m?.ground && <span>{m.ground.name} {m.ground.hours} 小時 · NT${count(m.ground.fare)}</span>}
        <span>市場航空旅客 每週 {count(m?.airDemand ?? 0)}</span>
      </div>
      {result ? (
        <div className="stats">
          <Stat label="載客（含轉機）" value={count(result.pax)} />
          <Stat label="本地旅客" value={count(result.localPax)} />
          <Stat label="溢出" value={count(result.spill)} tone={result.spill > 1 ? 'warn' : undefined} />
          <Stat label="載客率" value={pct(result.loadFactor)} tone={tone(result.loadFactor)} />
          <Stat label="市占" value={pct(result.marketShare)} />
          <Stat label="航段收入/飛行成本" value={pct(result.revenue / (result.flyingCost || 1))} tone={result.revenue >= result.flyingCost ? 'good' : 'bad'} />
        </div>
      ) : (
        <div className="hint center">計算中…</div>
      )}
      <h4>時刻表（當地時間）</h4>
      <ul className="timetable">
        {flights.map(({ ac, index, leg }) => (
          <li key={`${ac.id}-${index}`} onClick={() => onPickAircraft(ac.id)}>
            <span className="t">{hhmm(localMinutes(leg.from, leg.dep))}</span>
            <span className="name">{leg.from} → {leg.to}<small>抵達 {hhmm(localMinutes(leg.to, leg.dep + blockMinutes(leg.from, leg.to, ac.type)))}</small></span>
            <span className="tag">{ac.reg} · {AIRCRAFT[ac.type].name}</span>
          </li>
        ))}
      </ul>
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value as AircraftModel)} aria-label="機型">
          {MODEL_ORDER.map((c) => <option key={c} value={c} disabled={!!routeProblem(a, b, c)}>{AIRCRAFT[c].name}</option>)}
        </select>
        <button className="primary grow" onClick={() => onAddTrip(type)}>每日加一班來回</button>
      </div>
    </Sheet>
  );
}

// ---------- Aircraft ----------

/** A 24-hour bar of the aircraft's day, in the base's local time. */
function DayBar({ ac, base }: { ac: Aircraft; base: string }) {
  const startUtc = -((AIRPORT_BY_CODE[base].country === 'JP' ? 9 : 8) * 60);
  return (
    <div className="daybar" aria-label="每日排班">
      {ac.legs.map((l, i) => {
        const bm = blockMinutes(l.from, l.to, ac.type);
        const start = (((l.dep - startUtc) % DAY) + DAY) % DAY;
        const parts = start + bm > DAY ? [[start, DAY - start], [0, start + bm - DAY]] : [[start, bm]];
        return parts.map(([s, w], k) => (
          <div key={`${i}-${k}`} className="seg" style={{ left: `${(s / DAY) * 100}%`, width: `${(w / DAY) * 100}%` }} title={`${l.from}→${l.to}`}>
            {w > 70 && k === 0 ? l.to : ''}
          </div>
        ));
      })}
      {[6, 12, 18].map((h) => <div key={h} className="tick" style={{ left: `${(h / 24) * 100}%` }}><span>{h}</span></div>)}
    </div>
  );
}

export function AircraftSheet({ plan, ac, result, onChange, onRemove, onClose }: {
  plan: Plan; ac: Aircraft; result?: AircraftResult; onChange: (ac: Aircraft) => void; onRemove: () => void; onClose: () => void;
}) {
  const info = rotationInfo(ac);
  const spec = AIRCRAFT[ac.type];
  const here = ac.legs.length ? ac.legs[ac.legs.length - 1].to : plan.base;
  const start = ac.legs[0]?.from;
  const shift = (i: number, delta: number) => {
    const min = earliestDeparture(ac, i);
    const next = ac.legs[i].dep + delta;
    if (min !== null && next < min) return;
    // Moving a flight moves every later flight of the day with it.
    onChange({ ...ac, legs: ac.legs.map((l, k) => (k >= i ? { ...l, dep: l.dep + delta } : l)) });
  };
  const options = topMarketsFrom(here, plan, 30).filter((m) => !routeProblem(here, m.to, ac.type)).slice(0, 8);
  const addLeg = (to: string) => {
    const last = ac.legs[ac.legs.length - 1];
    const dep = last ? Math.ceil((last.dep + blockMinutes(last.from, last.to, ac.type) + spec.turnMin) / 5) * 5 : (earliestMorning(here));
    onChange({ ...ac, legs: [...ac.legs, { from: here, to, dep }] });
  };
  return (
    <Sheet title={`${ac.reg} · ${spec.name}`} sub={`${spec.seats} 座 · 租金 ${money(spec.ownershipPerWeek)}/週 · 飛行成本 ${money(spec.costPerBlockHour)}/小時`} onClose={onClose}>
      <div className="util-row">
        <div className="grow">
          <div className="label">利用率 {pct(info.utilisation)} · 每日飛行 {(info.blockMin / 60).toFixed(1)} 小時 · 地面閒置 {((DAY - info.blockMin) / 60).toFixed(1)} 小時</div>
          <UtilBar value={info.utilisation} />
        </div>
      </div>
      <DayBar ac={ac} base={plan.base} />
      {!info.closed && <div className="warn-box">尚未回到起點 {start}：飛機明天無法重複這個排班。</div>}
      {!info.fits && <div className="warn-box">排班超過 24 小時，請縮短或移除航段。</div>}
      {result && (
        <div className="stats">
          <Stat label="週載客" value={count(result.pax)} />
          <Stat label="載客率" value={pct(result.seats ? result.pax / result.seats : 0)} tone={tone(result.seats ? result.pax / result.seats : 0)} />
          <Stat label="週損益" value={money(result.revenue - result.flyingCost - result.ownershipCost)} tone={result.revenue >= result.flyingCost + result.ownershipCost ? 'good' : 'bad'} />
        </div>
      )}
      <h4>每日航段（當地時間）</h4>
      <ul className="timetable">
        {ac.legs.map((l, i) => (
          <li key={i}>
            <span className="t">{hhmm(localMinutes(l.from, l.dep))}</span>
            <span className="name">{AIRPORT_BY_CODE[l.from].name} → {AIRPORT_BY_CODE[l.to].name}<small>抵達 {hhmm(localMinutes(l.to, l.dep + blockMinutes(l.from, l.to, ac.type)))} · {l.from}–{l.to}</small></span>
            <span className="mini">
              <button onClick={() => shift(i, -15)} aria-label="提早15分">−15</button>
              <button onClick={() => shift(i, 15)} aria-label="延後15分">+15</button>
            </span>
          </li>
        ))}
      </ul>
      {ac.legs.length > 0 && <button className="ghost" onClick={() => onChange({ ...ac, legs: ac.legs.slice(0, -1) })}>移除最後一個航段</button>}
      <h4>從{AIRPORT_BY_CODE[here].name}加航段</h4>
      <div className="chips">
        {start && here !== start && !routeProblem(here, start, ac.type) && <button className="chip strong" onClick={() => addLeg(start)}>返回 {AIRPORT_BY_CODE[start].name}</button>}
        {options.map((m) => <button key={m.to} className="chip" onClick={() => addLeg(m.to)}>{AIRPORT_BY_CODE[m.to].name}</button>)}
      </div>
      <button className="danger" onClick={onRemove}>退租這架飛機</button>
    </Sheet>
  );
}

function earliestMorning(code: string) {
  return 7 * 60 - (AIRPORT_BY_CODE[code].country === 'JP' ? 9 : 8) * 60;
}

// ---------- Fleet ----------

export function FleetSheet({ plan, result, onPick, onLease, onClose }: {
  plan: Plan; result: NetworkResult | null; onPick: (id: string) => void; onLease: (type: AircraftModel) => void; onClose: () => void;
}) {
  const avg = plan.fleet.length ? plan.fleet.reduce((s, a) => s + rotationInfo(a).utilisation, 0) / plan.fleet.length : 0;
  return (
    <Sheet title={`機隊 · ${plan.fleet.length} 架`} sub={`平均利用率 ${pct(avg)} · 每週租金 ${money(plan.fleet.reduce((s, a) => s + AIRCRAFT[a.type].ownershipPerWeek, 0))}`} onClose={onClose}>
      <ul className="fleet">
        {plan.fleet.map((ac) => {
          const info = rotationInfo(ac);
          const r = result?.aircraft[ac.id];
          return (
            <li key={ac.id} onClick={() => onPick(ac.id)}>
              <span className="name">{ac.reg}<small>{AIRCRAFT[ac.type].name} · {ac.legs.length} 航段 · {(info.blockMin / 60).toFixed(1)} 小時/日{!info.closed || !info.fits ? ' · ⚠' : ''}</small></span>
              <span className="util-col"><UtilBar value={info.utilisation} /><small>{pct(info.utilisation)}</small></span>
              {r && <span className={`num ${r.revenue >= r.flyingCost + r.ownershipCost ? 'good' : 'bad'}`}>{money(r.revenue - r.flyingCost - r.ownershipCost)}</span>}
            </li>
          );
        })}
      </ul>
      <h4>租賃新飛機（停在基地 {AIRPORT_BY_CODE[plan.base].name}）</h4>
      <div className="chips">
        {MODEL_ORDER.map((c) => <button key={c} className="chip" onClick={() => onLease(c)}>{AIRCRAFT[c].name} · {money(AIRCRAFT[c].ownershipPerWeek)}/週</button>)}
      </div>
    </Sheet>
  );
}

// ---------- Airport ----------

export function AirportSheet({ plan, code, onConnect, onOpen, onClose }: { plan: Plan; code: string; onConnect: () => void; onOpen: (to: string) => void; onClose: () => void }) {
  const a = AIRPORT_BY_CODE[code];
  const used = weeklyDepartures(plan, code);
  const top = topMarketsFrom(code, plan);
  return (
    <Sheet title={`${a.name} ${a.code}`} sub={`腹地人口 ${count(a.catchment / 1e4)} 萬 · 模擬年旅客 ${(modelledAnnualPax(code) / 1e6).toFixed(1)} 百萬 · 時間帶 ${used}/${a.slotCap} 班/週 · 跑道 ${count(a.runwayM)} 公尺（最大 ${CLASS_NAMES[a.maxClass]}）${code === plan.base ? ' · 你的基地' : ''}`} onClose={onClose}>
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

// ---------- Report ----------

export function ResultsSheet({ result, history, balance, onPick, onClose }: {
  result: NetworkResult; history: DayRecord[]; balance: number; onPick: (key: string) => void; onClose: () => void;
}) {
  const rows = Object.values(result.routes).sort((x, y) => (y.revenue - y.flyingCost) - (x.revenue - x.flyingCost));
  const recent = history.slice(-14);
  const peak = Math.max(1, ...recent.map((d) => Math.abs(d.revenue - d.cost)));
  return (
    <Sheet title="營運報表" sub={`累計損益 ${money(balance)} · 每週 ${count(result.flights)} 班 · 轉機旅客 ${count(result.connectingPax)}/週`} onClose={onClose}>
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
