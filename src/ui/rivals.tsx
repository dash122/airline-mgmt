import { useMemo, useState } from 'react';
import { CompactTimetable } from './CompactTimetable';
// Competitor airlines in the route and airport sheets.
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlinesAt, KIND_NAMES, rivalsAt, rivalsBetween, type Airline, type RivalService } from '../sim/competitors';
import { type Plan, type RouteResult } from '../sim/simulate';
import { marketSplit, type MarketSplit, type ShareRow } from '../sim/share';
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

const OWN_COLOR = 'var(--accent)';
const CONNECTING_COLOR = 'var(--muted)';
const rowColor = (r: ShareRow) => (r.kind === 'own' ? OWN_COLOR : r.kind === 'connecting' ? CONNECTING_COLOR : r.airline?.color ?? CONNECTING_COLOR);
const rowName = (r: ShareRow) => (r.kind === 'own' ? '你的航空' : r.kind === 'connecting' ? '轉機（其他航空）' : r.airline?.name ?? r.id);

/** One or two sentences on who carries the route's travellers. Never calls the player the biggest when it carries nobody. */
export function marketSummary({ total, rows, ownTurnedAway, ownFreqShare }: MarketSplit): string {
  const own = rows.find((r) => r.kind === 'own');
  const rivals = rows.filter((r) => r.kind === 'rival');
  if (!own) return rivals.length ? `你還沒飛這條航線，${rivals.length} 家航空分食這些旅客。` : '目前沒有航空直飛，旅客只能轉機。';
  const parts: string[] = [];
  const top = rivals.reduce<ShareRow | undefined>((x, r) => (!x || r.pax > x.pax ? r : x), undefined);
  if (own.pax < 1) parts.push('你的航班沒有載到這個市場的旅客。');
  else if (!top) parts.push(`你是唯一直飛的航空，載了 ${pct(own.share)} 的旅客。`);
  else if (own.pax >= top.pax) parts.push(`你是這條航線最大的航空，占 ${pct(own.share)}；第二是${rowName(top)}，占 ${pct(top.share)}。`);
  else parts.push(`${rowName(top)}領先，占 ${pct(top.share)}；你占 ${pct(own.share)}。`);
  if (rivals.length && ownFreqShare > 0) parts.push(`你的班次占全部直飛的 ${pct(ownFreqShare)}。`);
  if (ownTurnedAway >= 1) parts.push(`另有 ${pct(ownTurnedAway / total)}（${count(ownTurnedAway)} 人）想搭你但客滿。`);
  return parts.join('');
}

/** The route's travellers by airline: the player against each competitor, as a bar and a ranked list. */
export function MarketShare({ a, b, result }: { a: string; b: string; result?: RouteResult }) {
  const split = useMemo(() => marketSplit(a, b, result), [a, b, result]);
  const { total, rows, ownTurnedAway } = split;
  if (total < 1) return null;
  const summary = marketSummary(split);
  const segments = rows.flatMap((r) => {
    const el = <div key={r.id} style={{ width: `${100 * r.share}%`, background: rowColor(r) }} />;
    return r.kind === 'own' && ownTurnedAway >= 1
      ? [el, <div key="lost" className="lost" style={{ width: `${(100 * ownTurnedAway) / total}%` }} />]
      : [el];
  });
  return (
    <div className="market-share">
      <h4>市場占有率 <small>每週 {count(total)} 人（雙向）</small></h4>
      <p className="schedule-note">{summary}</p>
      <div className="share-track" role="img" aria-label={rows.map((r) => `${rowName(r)} ${pct(r.share)}`).join('，')}>{segments}</div>
      <ul className="share-list">
        {rows.map((r) => {
          const lost = result && r.kind === 'rival' ? r.before - r.pax : 0;
          return (
            <li key={r.id} className={r.kind === 'own' ? 'own' : undefined}>
              <i style={{ background: rowColor(r) }} />
              <span className="name">
                <b>{rowName(r)}{r.airline && <em>{KIND_NAMES[r.airline.kind]}</em>}</b>
                <small>
                  {r.kind === 'connecting' ? '沒有直飛，旅客轉機' : `每週 ${count(r.freq)} 班`}
                  {r.fare ? ` · NT$${count(r.fare)}` : ''}
                  {r.airports.length ? <> · 飛 {r.airports.map((k, i) => <span key={k} className="nowrap">{i ? '、' : ''}{k.replace('-', '–')}</span>)}</> : ''}
                </small>
              </span>
              <span className="rival-share">
                {pct(r.share)}
                <small>{count(r.pax)} 人{lost >= 1 ? ` · 被你搶走 ${count(lost)}` : ''}</small>
              </span>
            </li>
          );
        })}
        {ownTurnedAway >= 1 && (
          <li className="lost-row">
            <i />
            <span className="name"><b>想搭你但客滿</b><small>溢出的本地旅客，沒有改搭別家</small></span>
            <span className="rival-share">{pct(ownTurnedAway / total)}<small>{count(ownTurnedAway)} 人</small></span>
          </li>
        )}
      </ul>
      {result && result.pax - result.localPax >= 1 && (
        <div className="hint">另有每週 {count(result.pax - result.localPax)} 名轉機旅客搭你的航班，他們屬於別的市場，不算在這裡的市占。客滿時，本地和轉機旅客按比例分到座位。</div>
      )}
      <div className="hint">市占看班次多寡、起飛時段、票價和服務品質。對手的班表和票價固定，不會因為你而改變。</div>
    </div>
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
