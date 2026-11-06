import { Fragment, useMemo, useState } from 'react';
import { CompactTimetable } from './CompactTimetable';
// Competitor airlines in the route and airport sheets.
import { KIND_NAMES, rivalsBetween, type Airline } from '../sim/competitors';
import { type NetworkResult, type Plan, type RouteResult } from '../sim/simulate';
import { marketSplit, type MarketSplit, type ShareRow } from '../sim/share';
import { count, pct } from './format';
import { useAirlineLink } from './airlines';
import { Head } from './sheets';
import { IN, Icon } from './viz';

/** An airline's name; taps open its profile wherever the app provides one. */
export function AirlineName({ airline }: { airline: Airline }) {
  const open = useAirlineLink();
  const body = <><i style={{ background: airline.color }} />{airline.name}<em>{KIND_NAMES[airline.kind]}</em></>;
  if (!open || airline.id === 'other') return <span className="airline">{body}</span>;
  return <button className="airline link" onClick={(e) => { e.stopPropagation(); open(airline.id); }} aria-label={`看${airline.name}的航線網`}>{body}<span className="chev">›</span></button>;
}

const OWN_COLOR = 'var(--accent)';
const OWN_VIA_COLOR = 'color-mix(in srgb, var(--accent) 55%, var(--panel, #fff))';
const CONNECTING_COLOR = 'var(--muted)';
const rowColor = (r: ShareRow) => (r.kind === 'own' ? OWN_COLOR : r.kind === 'ownVia' ? OWN_VIA_COLOR : r.kind === 'connecting' ? CONNECTING_COLOR : r.airline?.color ?? CONNECTING_COLOR);
const rowName = (r: ShareRow) => (r.kind === 'own' ? '你的航空（直飛）' : r.kind === 'ownVia' ? `你的航空（經${r.via}轉機）`
  : r.kind === 'connecting' ? '其他航空轉機' : r.kind === 'rivalVia' ? `${r.airline?.name ?? r.id}（經${r.via}轉機）` : r.airline?.name ?? r.id);
const isTransit = (r: ShareRow) => r.kind === 'ownVia' || r.kind === 'rivalVia' || r.kind === 'connecting';

/** One or two sentences on who carries the route's travellers. Never calls the player the biggest when it carries nobody. */
export function marketSummary({ rows, ownTurnedAway }: MarketSplit): string {
  const own = rows.find((r) => r.kind === 'own');
  const rivals = rows.filter((r) => r.kind === 'rival');
  const via = rows.filter((r) => r.kind === 'ownVia');
  const viaText = via.length ? `你經${via.map((r) => r.via).join('、')}轉機載了 ${pct(via.reduce((s, r) => s + r.share, 0))}。` : '';
  // Competitors' connections: their share and the hub that carries the most.
  const rivalVia = rows.filter((r) => r.kind === 'rivalVia');
  const topVia = rivalVia[0];
  const rivalViaText = topVia ? `對手轉機載 ${pct(rivalVia.reduce((s, r) => s + r.share, 0))}，最多經${topVia.via}。` : '';
  if (!own) return (rivals.length ? `你沒有直飛，${rivals.length} 家航空直飛分食這些旅客。` : '目前沒有航空直飛，旅客只能轉機。') + viaText + rivalViaText;
  const parts: string[] = [];
  const top = rivals.reduce<ShareRow | undefined>((x, r) => (!x || r.pax > x.pax ? r : x), undefined);
  if (own.pax < 1) parts.push('你的航班沒有載到這個市場的旅客。');
  else if (!top) parts.push(`你是唯一直飛的航空，載了 ${pct(own.share)} 的旅客。`);
  else if (own.pax >= top.pax) parts.push(`你是這條航線最大的航空，占 ${pct(own.share)}；第二是${rowName(top)}，占 ${pct(top.share)}。`);
  else parts.push(`${rowName(top)}領先，占 ${pct(top.share)}；你占 ${pct(own.share)}。`);
  if (viaText) parts.push(viaText);
  if (rivalViaText) parts.push(rivalViaText);
  if (ownTurnedAway >= 1) parts.push(`另有 ${count(ownTurnedAway)} 人想搭你但客滿。`);
  return parts.join('');
}

/** Two blocks over the whole market: travellers flying nonstop and travellers changing planes. */
function DirectVsTransit({ rows, total }: { rows: ShareRow[]; total: number }) {
  const transit = rows.filter(isTransit).reduce((s, r) => s + r.pax, 0);
  const direct = rows.filter((r) => !isTransit(r)).reduce((s, r) => s + r.pax, 0);
  if (transit < 1 || direct < 1) return null;
  return (
    <div className="dvt">
      <div style={{ flex: Math.max(direct, total * 0.2) }}><b>直飛</b> {count(direct)}<small>{pct(direct / total)}</small></div>
      <div style={{ flex: Math.max(transit, total * 0.2) }} className="t"><b>轉機</b> {count(transit)}<small>{pct(transit / total)}</small></div>
    </div>
  );
}

/**
 * Who carries the travellers between two airports: your nonstops, your connections, each competitor and other
 * airlines' connections, as a bar and a list grouped into nonstop and connecting.
 */
export function MarketShare({ a, b, result, net, split: given, title = '市場占有率' }: {
  a: string; b: string; result?: RouteResult; net?: NetworkResult | null; split?: MarketSplit; title?: string;
}) {
  const split = useMemo(() => given ?? marketSplit(a, b, result, net), [a, b, result, net, given]);
  const { total, rows, ownTurnedAway } = split;
  if (total < 1) return null;
  const summary = marketSummary(split);
  const segments = rows.map((r) => <div key={r.id} className={isTransit(r) ? 'tr-seg' : undefined} style={{ width: `${100 * r.share}%`, background: rowColor(r) }} />);
  if (ownTurnedAway >= 1) segments.push(<div key="lost" className="lost" style={{ width: `${(100 * ownTurnedAway) / total}%` }} />);
  const firstTransit = rows.findIndex(isTransit);
  return (
    <div className="market-share">
      <Head info={<>
        <p>{summary}</p>
        <p>{a} ⇄ {b} 每週共 {count(total)} 人（雙向）。{split.ownFreqShare > 0 && rows.some((r) => r.kind === 'rival') ? `你的班次占全部直飛的 ${pct(split.ownFreqShare)}。` : ''}</p>
        <p>市占看班次、起飛時段、票價和服務；轉機等越久，分到越少。對手的班表和票價固定。</p>
        {result && result.pax - result.localPax >= 1 && <p>另有每週 {count(result.pax - result.localPax)} 人只在這條航線轉機去別處，算在別的市場。客滿時本地和轉機旅客按比例分座位。</p>}
      </>} right={<small className="muted"><IN n="pax" v={`${count(total)}/週`} label="旅客/週" /></small>}>{title}</Head>
      <DirectVsTransit rows={rows} total={total} />
      <div className="share-track" role="img" aria-label={rows.map((r) => `${rowName(r)} ${pct(r.share)}`).join('，')}>{segments}</div>
      <ul className="share-list">
        {rows.map((r, i) => {
          const lost = result && r.kind === 'rival' ? r.before - r.pax : 0;
          return (
            <Fragment key={r.id}>
              {i === 0 && firstTransit !== 0 && <li className="group">直飛</li>}
              {i === firstTransit && <li className="group">轉機</li>}
              <li className={r.kind === 'own' || r.kind === 'ownVia' ? 'own' : undefined}>
                <i className={isTransit(r) ? 'tr-seg' : undefined} style={{ background: rowColor(r) }} />
                <span className="name">
                  {r.airline ? <b><AirlineName airline={r.airline} /></b> : <b>{rowName(r)}</b>}
                  <span className="ins">
                    {r.kind === 'connecting' ? <IN n="transfer" v="…" label="在其他城市換機" />
                      : r.kind === 'ownVia' || r.kind === 'rivalVia' ? <IN n="transfer" v={r.via} label={`${a} → ${r.via} → ${b}`} /> : null}
                    {r.kind !== 'connecting' && r.kind !== 'ownVia' && <IN n="plane" v={count(r.freq)} label="班/週" />}
                    {r.fare ? <IN n="fare" v={`$${count(r.fare)}`} label="票價 NT$" /> : null}
                    {r.airports.length ? <span className="code-chips" title="飛的機場">{r.airports.map((k) => <span key={k}>{k.replace('-', '–')}</span>)}</span> : null}
                  </span>
                </span>
                <span className="rival-share">
                  {pct(r.share)}
                  <small>{count(r.pax)}{lost >= 1 && <span className="lost-n" title={`被你搶走 ${count(lost)} 人`}> ▼{count(lost)}</span>}</small>
                </span>
              </li>
            </Fragment>
          );
        })}
        {ownTurnedAway >= 1 && (
          <li className="lost-row">
            <i />
            <span className="name"><b><Icon n="spill" /> 客滿</b></span>
            <span className="rival-share">{pct(ownTurnedAway / total)}<small>{count(ownTurnedAway)} 人</small></span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Who else flies this route: flights, fares, departure times and share of fliers. */
export function RouteRivals({ a, b, plan, result, onEdit }: { a: string; b: string; result?: RouteResult; plan?: Plan; onEdit?: (ac: string, leg: number) => void }) {
  const [reverse, setReverse] = useState(false);
  const from = reverse ? b : a;
  const to = reverse ? a : b;
  const services = rivalsBetween(a, b).filter((s) => s.from === from);
  return <div>
    <div className="rival-directions" role="group" aria-label="班表方向">
      <button aria-pressed={!reverse} onClick={() => setReverse(false)}>{a} → {b}</button>
      <button aria-pressed={reverse} onClick={() => setReverse(true)}>{b} → {a}</button>
    </div>
    <CompactTimetable from={from} to={to} services={services} plan={plan} loads={result?.flights} onEdit={onEdit} />
  </div>;
}
