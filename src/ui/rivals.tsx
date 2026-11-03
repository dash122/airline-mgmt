import { useState } from 'react';
import { CompactTimetable } from './CompactTimetable';
// Competitor airlines in the route and airport sheets.
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlinesAt, KIND_NAMES, rivalsAt, rivalsBetween, type Airline, type RivalService } from '../sim/competitors';
import { type Plan, type RouteResult } from '../sim/simulate';
import { count } from './format';

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
export function RouteRivals({ a, b, plan, onEdit }: { a: string; b: string; result?: RouteResult; plan?: Plan; onEdit?: (ac: string, leg: number) => void }) {
  const [reverse, setReverse] = useState(false);
  const from = reverse ? b : a;
  const to = reverse ? a : b;
  const services = rivalsBetween(a, b).filter((s) => s.from === from);
  return <div>
    <div className="rival-directions" role="group" aria-label="班表方向">
      <button aria-pressed={!reverse} onClick={() => setReverse(false)}>{a} → {b}</button>
      <button aria-pressed={reverse} onClick={() => setReverse(true)}>{b} → {a}</button>
    </div>
    <CompactTimetable from={from} to={to} services={services} plan={plan} onEdit={onEdit} />
  </div>;
}

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
      <CompactTimetable from={code} to={to} services={services} />
      <div className="competitor-route-action">{served ? <span className="tag">你的航空已開航</span> : <button onClick={onOpen}>開航 {code} ⇄ {to}</button>}</div>
    </details>
  );
}
