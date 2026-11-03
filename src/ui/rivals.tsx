import { useState } from 'react';
import { FlightTimes } from './FlightTimes';
// Competitor airlines in the route and airport sheets.
import { AIRCRAFT } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airChoice } from '../sim/choice';
import { airlinesAt, KIND_NAMES, rivalsAt, rivalsBetween, type Airline, type RivalService } from '../sim/competitors';
import { marketBetween } from '../sim/markets';
import { blockMinutes, utcFromLocal, type RouteResult } from '../sim/simulate';
import { count, pct } from './format';

export function AirlineName({ airline }: { airline: Airline }) {
  return (
    <span className="airline">
      <i style={{ background: airline.color }} />
      {airline.name}
      <em>{KIND_NAMES[airline.kind]}</em>
    </span>
  );
}

/** Who else flies this route: flights, fares, departure times and share of fliers. */
export function RouteRivals({ a, b, result }: { a: string; b: string; result?: RouteResult }) {
  const [reverse, setReverse] = useState(false);
  const from = reverse ? b : a;
  const services = rivalsBetween(a, b);
  const m = marketBetween(a, b);
  if (!services.length) return <div className="hint">沒有其他航空直飛這條航線。</div>;
  const ids = [...new Set(services.map((s) => s.airline.id))];
  // Before the player flies here, shares are today's split between the competitors.
  const baseline = airChoice(services.map((s) => ({ freq: s.effFreq, fare: s.fare, quality: s.airline.quality })), m?.distKm ?? 0).shares;
  return (
    <div className="rival-timetable"><div className="rival-directions" role="group" aria-label="班表方向"><button aria-pressed={!reverse} onClick={() => setReverse(false)}>{a} → {b}</button><button aria-pressed={reverse} onClick={() => setReverse(true)}>{b} → {a}</button></div><p className="schedule-note">各機場當地時間 · +1 天為隔日抵達</p><ul className="rivals">
      {ids.map((id) => {
        const mine = services.filter((s) => s.airline.id === id);
        const al = mine[0].airline;
        const freq = mine.reduce((s, x) => s + x.freq, 0);
        const r = result?.rivals.find((x) => x.id === id);
        const share = r && result && result.airTotal > 0 ? r.pax / result.airTotal : mine.reduce((s, x) => s + baseline[services.indexOf(x)], 0);
        const out = mine.find((s) => s.from === from);
        return (
          <li key={id}>
            <details className="competitor-details">
              <summary>
                <span className="name"><AirlineName airline={al} /><small>雙向每週 {freq} 班 · 查看班表</small></span>
                <span className="rival-share">{pct(share)}<small>旅客占比</small></span>
              </summary>
              <p className="schedule-note">基地：{al.bases.map((code) => AIRPORT_BY_CODE[code].name + ' ' + code).join('、')}</p>
              {out ? <ServiceSchedule service={out} /> : <p className="schedule-note">此方向沒有直飛航班。</p>}
            </details>
          </li>
        );
      })}
    </ul></div>
  );
}

function ServiceSchedule({ service: s }: { service: RivalService }) { return <div className="service-schedule"><p className="schedule-note">單向每週 {s.freq} 班 · {AIRCRAFT[s.type].name} · NT$ {count(s.fare)}</p><ul className="service-times">{[...s.times].sort((a,b) => a-b).map((time,index) => { const dep = utcFromLocal(s.from,time); return <li key={index}><FlightTimes from={s.from} to={s.to} dep={dep} arr={dep + blockMinutes(s.from,s.to,s.type)} /></li>; })}</ul>{s.freq < 7 && <p className="schedule-note">每週營運 {s.freq} 天，未指定星期。</p>}</div>; }

/** Competitor airlines at an airport and where they fly. */
export function AirportRivals({ code, served, onOpen }: { code: string; served: (to: string) => boolean; onOpen: (to: string) => void }) {
  const carriers = airlinesAt(code);
  const routes = rivalsAt(code);
  if (!carriers.length) return <div className="hint center">沒有其他航空在這裡飛。</div>;
  return (
    <>
      <h4>在這裡飛的航空公司（每週出發）</h4>
      <p className="schedule-note">點選航空公司查看航點；點選航線查看班表。</p>
      <ul className="competitor-list">
        {carriers.map((c) => (
          <li key={c.airline.id}>
            <details className="competitor-details">
              <summary>
                <span className="name"><AirlineName airline={c.airline} /><small>{c.destinations} 個航點{c.airline.bases[0] === code ? ' · 主要樞紐' : c.airline.bases.includes(code) ? ' · 基地' : ''} · 查看航線</small></span>
                <span className="rival-share">{count(c.flights)}<small>班／週</small></span>
              </summary>
              <p className="schedule-note">基地：{c.airline.bases.map((base) => AIRPORT_BY_CODE[base].name + ' ' + base).join('、')}</p>
              <ul className="competitor-list">
                {routes.filter((r) => r.services.some((s) => s.airline.id === c.airline.id)).map((r) => (
                  <li key={r.to}><AirportRivalRoute code={code} to={r.to} services={r.services.filter((s) => s.airline.id === c.airline.id)} served={served(r.to)} onOpen={() => onOpen(r.to)} /></li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <h4>全部競爭航線 · {routes.length} 條</h4>
      <ul className="competitor-list">
        {routes.map((r) => (
          <li key={r.to}><AirportRivalRoute code={code} to={r.to} services={r.services} served={served(r.to)} onOpen={() => onOpen(r.to)} /></li>
        ))}
      </ul>
      <div className="hint">競爭對手的班表固定，不會因為你開航而加班或降價。</div>
    </>
  );
}

function AirportRivalRoute({ code, to, services, served, onOpen }: {
  code: string; to: string; services: RivalService[]; served: boolean; onOpen: () => void;
}) {
  const flights = services.reduce((total, service) => total + service.freq, 0);
  return (
    <details className="competitor-details">
      <summary>
        <span className="name"><b>{AIRPORT_BY_CODE[to].name} <span className="route-code">{code} → {to}</span></b><small>{services.length} 家航空 · 每週 {flights} 班 · 查看班表</small></span>
      </summary>
      {services.map((service) => (
        <section className="competitor-service" key={service.airline.id} aria-label={service.airline.name + ' 班表'}>
          <AirlineName airline={service.airline} />
          <ServiceSchedule service={service} />
        </section>
      ))}
      <p className="schedule-note">時間為各機場當地時間 · +1 天為隔日抵達</p>
      <div className="competitor-route-action">{served ? <span className="tag">你的航空已開航</span> : <button onClick={onOpen}>開航 {code} ⇄ {to}</button>}</div>
    </details>
  );
}
