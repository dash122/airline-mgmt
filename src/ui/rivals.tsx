import { Fragment, useMemo, useState } from 'react';
import { CompactTimetable } from './CompactTimetable';
// Competitor airlines in the route and airport sheets.
import { KIND_NAMES, rivalsBetween, type Airline } from '../sim/competitors';
import { type NetworkResult, type Plan, type RouteResult } from '../sim/simulate';
import { marketSplit, type MarketSplit, type ShareRow } from '../sim/share';
import { count, pct, price } from './format';
import { useAirlineLink } from './airlines';
import { Head } from './sheets';
import { IN, Ring } from './viz';

/** An airline's name; taps open its profile wherever the app provides one. */
export function AirlineName({ airline }: { airline: Airline }) {
  const open = useAirlineLink();
  const body = <><i style={{ background: airline.color }} />{airline.name}<em>{KIND_NAMES[airline.kind]}</em></>;
  if (!open || airline.id === 'other') return <span className="airline">{body}</span>;
  return <button className="airline link" onClick={(e) => { e.stopPropagation(); open(airline.id); }} aria-label={`看${airline.name}的航線網`}>{body}<span className="chev" aria-hidden="true" /></button>;
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

/** One share as a bar: supply (flights) or demand (passengers). */
function CompareBar({ label, sub, share }: { label: string; sub: string; share: number }) {
  return (
    <div className="ms-cmp">
      <span className="ms-cmp-label"><b>{label}</b><small>{sub}</small></span>
      <span className="ms-bar" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, share) * 100)}%`, background: OWN_COLOR }} /></span>
      <b className="ms-cmp-val">{pct(share)}</b>
    </div>
  );
}

/** Nonstop against connecting travellers, as one split bar with a two-item legend. */
function Modes({ rows, total }: { rows: ShareRow[]; total: number }) {
  const transit = rows.filter(isTransit).reduce((s, r) => s + r.pax, 0);
  const direct = rows.filter((r) => !isTransit(r)).reduce((s, r) => s + r.pax, 0);
  return (
    <div className="ms-card">
      <div className="ms-label">旅客怎麼走</div>
      <div className="ms-split" role="img" aria-label={`直飛 ${pct(direct / total)}，轉機 ${pct(transit / total)}`}>
        <i className="direct" style={{ flexGrow: direct }} /><i className="transit" style={{ flexGrow: transit }} />
      </div>
      <div className="ms-legend">
        <span><i className="direct" />直飛 <b>{pct(direct / total)}</b><small>{count(direct)} 人</small></span>
        <span><i className="transit" />轉機 <b>{pct(transit / total)}</b><small>{count(transit)} 人</small></span>
      </div>
    </div>
  );
}

/**
 * Who carries the travellers between two airports. Reads top to bottom: how big the market is (and your part in it),
 * how people travel (nonstop or connecting), then each carrier with its own bar.
 */
export function MarketShare({ a, b, result, net, split: given, title = '市場占有率' }: {
  a: string; b: string; result?: RouteResult; net?: NetworkResult | null; split?: MarketSplit; title?: string;
}) {
  const split = useMemo(() => given ?? marketSplit(a, b, result, net), [a, b, result, net, given]);
  const { total, rows, ownTurnedAway } = split;
  // The biggest few carriers first; the long tail waits behind one tap.
  const [all, setAll] = useState(false);
  if (total < 1) return null;
  const SHOWN = 3;
  const summary = marketSummary(split);
  const ownPax = rows.filter((r) => r.kind === 'own' || r.kind === 'ownVia').reduce((sum, r) => sum + r.pax, 0);
  const flying = rows.some((r) => r.kind === 'own' || r.kind === 'ownVia');
  const rivals = rows.filter((r) => r.kind === 'rival');
  const rivalFreq = rivals.reduce((sum, r) => sum + r.freq, 0);
  const groups = [{ label: '直飛', rows: rows.filter((r) => !isTransit(r)) }, { label: '轉機', rows: rows.filter(isTransit) }];
  const hidden = groups.reduce((sum, group) => sum + Math.max(0, group.rows.length - SHOWN), 0);
  const top = Math.max(...rows.map((r) => r.share), 0.01);
  return (
    <div className="ms">
      <Head info={<>
        <p>{summary}</p>
        <p>{a} ⇄ {b} 每週共 {count(total)} 人（雙向）。{split.ownFreqShare > 0 && rivals.length ? `你的班次占全部直飛的 ${pct(split.ownFreqShare)}。` : ''}</p>
        <p>市占看班次、起飛時段、票價和服務；轉機票價較低，也會搶直飛旅客，但等越久分到越少。對手的班表和票價固定。</p>
        {result && result.pax - result.localPax >= 1 && <p>另有每週 {count(result.pax - result.localPax)} 人只在這條航線轉機去別處，算在別的市場。客滿時本地和轉機旅客按比例分座位。</p>}
      </>}>{title}</Head>

      <div className="ms-hero">
        <div className="ms-size">
          <small>每週旅客（雙向）</small>
          <b>{count(total)}</b>
          <span>{rivals.length ? `${rivals.length} 家直飛 · ${count(rivalFreq)} 班/週` : '沒有對手直飛'}</span>
        </div>
        {flying && <div className="ms-own">
          <Ring value={ownPax / total} tone="good" size={64} stroke={7}><b>{pct(ownPax / total)}</b></Ring>
          <small>你的市占</small>
        </div>}
      </div>
      {flying
        ? <div className="ms-card" role="img" aria-label={`班次 你占 ${pct(split.ownFreqShare)}，旅客 你占 ${pct(ownPax / total)}`}>
          <CompareBar label="班次" sub="供給" share={split.ownFreqShare} />
          <CompareBar label="旅客" sub="需求" share={ownPax / total} />
          {Math.abs(split.ownFreqShare - ownPax / total) > 0.05 && (
            <p className="ms-note">{split.ownFreqShare > ownPax / total ? '班次比旅客多，可減班或換小飛機。' : '旅客比班次多，加班可以多拿。'}</p>
          )}
        </div>
        : <p className="ms-note lead">{summary}</p>}

      <Modes rows={rows} total={total} />

      <div className="ms-label">航空公司</div>
      {groups.map((group) => group.rows.length > 0 && <Fragment key={group.label}>
        <div className="ms-group">{group.label}</div>
        <ul className="ms-list">
          {(all ? group.rows : group.rows.slice(0, SHOWN)).map((r) => {
            const lost = result && r.kind === 'rival' ? r.before - r.pax : 0;
            const mine = r.kind === 'own' || r.kind === 'ownVia';
            return (
              <li key={r.id} className={`ms-row${mine ? ' own' : ''}`}>
                <div className="ms-row-top">
                  <span className="ms-name">
                    {r.airline ? <AirlineName airline={r.airline} /> : <span className="airline"><i className={isTransit(r) ? 'tr-seg' : undefined} style={{ background: rowColor(r) }} />{rowName(r)}</span>}
                  </span>
                  <b className="ms-pct">{pct(r.share)}</b>
                </div>
                <span className="ms-bar thin" aria-hidden="true"><i className={isTransit(r) ? 'tr-seg' : undefined} style={{ width: `${Math.max(2, 100 * r.share / top)}%`, background: rowColor(r) }} /></span>
                <div className="ms-meta">
                  <span className="ins">
                    {r.kind === 'connecting' ? <IN n="transfer" v="其他城市" label="在其他城市換機" w="經" />
                      : r.kind === 'ownVia' || r.kind === 'rivalVia' ? <IN n="transfer" v={r.via} label={`${a} → ${r.via} → ${b}`} w="經" /> : null}
                    {r.kind !== 'connecting' && r.kind !== 'ownVia' && <IN n="plane" v={count(r.freq)} label="班/週" u="班/週" />}
                    {r.fare ? <IN n="fare" v={price(r.fare)} label="票價" w="票價" /> : null}
                    {r.airports.length ? <span className="code-chips" title="飛的機場">{r.airports.map((k) => <span key={k}>{k.replace('-', '–')}</span>)}</span> : null}
                  </span>
                  <small>{count(r.pax)} 人{lost >= 1 && <span className="lost-n"> · 被你搶走 {count(lost)}</span>}</small>
                </div>
              </li>
            );
          })}
        </ul>
      </Fragment>)}
      {ownTurnedAway >= 1 && (
        <div className="ms-turned"><b>想搭你但客滿</b><span>{count(ownTurnedAway)} 人／週 · 未包含在上方市占</span></div>
      )}
      {hidden > 0 && <button className="secondary share-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? '收起' : `顯示另外 ${hidden} 項`}</button>}
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
