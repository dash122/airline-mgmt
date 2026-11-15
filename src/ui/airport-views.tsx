// The airport sheet's sections: the section control, where travellers from here go (destinations), the airlines here,
// and the full-day board.
import { useContext, useMemo, useState } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS } from '../data/airports';
import { airlinesAt, rivalsAt, rivalsBetween, type Airline, type RivalService } from '../sim/competitors';
import { countryName } from '../sim/networks';
import type { NetworkResult } from '../sim/simulate';
import { marketSplit, type ShareRow } from '../sim/share';
import { allFlights, marketPotential } from '../sim/airports';
import { LONG_HAUL_KM, marketBetween, pairKey } from '../sim/markets';
import { blockMinutes, canCodeshare, competitionFor, hasCodeshare, hhmm, localMinutes, utcFromLocal, type Plan } from '../sim/simulate';
import { CodeshareLink } from './codeshare';
import { CompactTimetable } from './CompactTimetable';
import { count, pct, short } from './format';
import { PullDown } from './sheets';
import { Icon } from './viz';

export type AirportSection = 'routes' | 'dest' | 'transfer' | 'airlines' | 'schedule';

/** One segmented control, the same four sections for every airport, in the same order. A count shows only where useful. */
export function AirportSegments<K extends string = AirportSection>({ items, on, onPick }: { items: { key: K; label: string; n?: number }[]; on: K; onPick: (s: K) => void }) {
  return (
    <div className="seg ap-seg" role="tablist" aria-label="機場資訊" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((t) => (
        <button key={t.key} role="tab" aria-selected={on === t.key} className={on === t.key ? 'on' : ''} onClick={() => onPick(t.key)}>
          {t.label}{t.n ? <small>{t.n}</small> : null}
        </button>
      ))}
    </div>
  );
}

/** Full daily board for every service touching this airport. */
export function AirportDaySchedule({ plan, code }: { plan: Plan; code: string }) {
  const [direction, setDirection] = useState<'departures' | 'arrivals'>('departures');
  const flights = useMemo(() => {
    const rows: { id: string; dep: number; arr: number; other: string; carrier: string; country?: string; color?: string; own: boolean }[] = [];
    for (const f of allFlights(plan)) {
      if (direction === 'departures' ? f.from === code : f.to === code) rows.push({ id: `${f.ac.id}-${f.index}`, dep: f.depUtc, arr: f.arrUtc, other: direction === 'departures' ? f.to : f.from, carrier: '你的航空', country: countryName(AIRPORT_BY_CODE[plan.base].country), own: true });
    }
    const rivalServices = direction === 'departures'
      ? rivalsAt(code).flatMap((route) => route.services)
      : AIRPORTS.flatMap((airport) => airport.code === code ? [] : rivalsBetween(airport.code, code).filter((service) => service.to === code));
    for (const service of rivalServices) for (let i = 0; i < service.times.length; i++) {
      const dep = utcFromLocal(service.from, service.times[i]);
      const arr = dep + blockMinutes(service.from, service.to, service.type);
      rows.push({ id: `${service.airline.id}-${service.from}-${service.to}-${i}`, dep, arr, other: direction === 'departures' ? service.to : service.from, carrier: service.airline.name, country: countryName(service.airline.country), color: service.airline.color, own: false });
    }
    return rows.sort((a, b) => localMinutes(code, direction === 'departures' ? a.dep : a.arr) - localMinutes(code, direction === 'departures' ? b.dep : b.arr) || a.id.localeCompare(b.id));
  }, [plan, code, direction]);
  return <section className="airport-day-schedule">
    <div className="seg two" role="group" aria-label="班表方向">
      <button className={direction === 'departures' ? 'on' : ''} aria-pressed={direction === 'departures'} onClick={() => setDirection('departures')}>出發</button>
      <button className={direction === 'arrivals' ? 'on' : ''} aria-pressed={direction === 'arrivals'} onClick={() => setDirection('arrivals')}>抵達</button>
    </div>
    <div className="list-cap"><span>{direction === 'departures' ? '全日出發' : '全日抵達'} · 本地時間</span><span>{flights.length} 班/日</span></div>
    {!flights.length ? <div className="hint center">今天沒有定期航班</div> : <ul className="airport-day-flights">
      {flights.map((f) => <li key={f.id}>
        <span className="airport-day-times"><time>{hhmm(localMinutes(direction === 'departures' ? code : f.other, f.dep))}</time><span>→</span><time>{hhmm(localMinutes(direction === 'departures' ? f.other : code, f.arr))}</time></span>
        <span className="airport-day-carrier"><i className={f.own ? 'own' : ''} style={{ background: f.own ? 'var(--accent)' : f.color }} /><span>{f.carrier}<small>{f.country}</small></span></span>
        <span className="airport-day-destination"><b>{f.other}</b><small>{AIRPORT_BY_CODE[f.other].name}</small></span>
      </li>)}
    </ul>}
  </section>;
}

const OWN = 'var(--accent)';
const rowColor = (r: ShareRow) => (r.kind === 'own' ? OWN : r.kind === 'connecting' ? 'var(--muted)' : r.airline?.color ?? 'var(--muted)');
const transitRow = (r: ShareRow) => r.kind === 'ownVia' || r.kind === 'rivalVia' || r.kind === 'connecting';
const shareRowName = (r: ShareRow) => r.kind === 'own' ? '你的航空直飛' : r.kind === 'ownVia' ? `你的航空經 ${r.via} 轉機`
  : r.kind === 'rival' ? r.airline?.name ?? r.id : r.kind === 'rivalVia' ? `${r.airline?.name ?? r.id} 經 ${r.via} 轉機` : '其他航空轉機';
type BridgeOption = { dep1: number; arr1: number; dep2: number; arr2: number; wait: number };
function rivalBridgeOptions(first: RivalService[], second: RivalService[]): BridgeOption[] {
  const options: BridgeOption[] = [];
  for (const a of first) for (const ta of a.times) {
    const dep1 = utcFromLocal(a.from, ta), arr1 = dep1 + blockMinutes(a.from, a.to, a.type);
    for (const b of second) for (const tb of b.times) {
      const dep2 = utcFromLocal(b.from, tb), wait = ((dep2 - arr1) % 1440 + 1440) % 1440;
      if (wait < 30 || wait > 480) continue;
      options.push({ dep1, arr1, dep2, arr2: dep2 + blockMinutes(b.from, b.to, b.type), wait });
    }
  }
  return options.sort((a, b) => a.wait - b.wait || a.dep1 - b.dep1).slice(0, 4);
}
function ownBridgeOptions(plan: Plan, from: string, via: string, to: string): BridgeOption[] {
  const flights = allFlights(plan), first = flights.filter((f) => f.from === from && f.to === via), second = flights.filter((f) => f.from === via && f.to === to);
  const options: BridgeOption[] = [];
  for (const a of first) for (const b of second) {
    const wait = ((b.depUtc - a.arrUtc) % 1440 + 1440) % 1440;
    if (wait < 30 || wait > 480) continue;
    options.push({ dep1: a.depUtc, arr1: a.arrUtc, dep2: b.depUtc, arr2: b.arrUtc, wait });
  }
  return options.sort((a, b) => a.wait - b.wait || a.dep1 - b.dep1).slice(0, 4);
}
/** The airlines that fly exactly this airport pair and can codeshare, the busiest first. A codeshare needs the pair itself, not a neighbouring airport in the same city. */
export function partnersOn(a: string, b: string): Airline[] {
  const by = new Map<string, { airline: Airline; freq: number }>();
  for (const s of rivalsBetween(a, b)) {
    if (!canCodeshare(s.airline)) continue;
    const e = by.get(s.airline.id) ?? { airline: s.airline, freq: 0 };
    e.freq += s.freq;
    by.set(s.airline.id, e);
  }
  return [...by.values()].sort((x, y) => y.freq - x.freq).map((x) => x.airline);
}

const PAGE = 12;
type Scope = 'all' | 'short' | 'long' | Continent;
type Continent = 'asia' | 'europe' | 'africa' | 'northAmerica' | 'southAmerica' | 'oceania';
const CONTINENT_LABELS: Record<Continent, string> = { asia: '亞洲', europe: '歐洲', africa: '非洲', northAmerica: '北美洲', southAmerica: '南美洲', oceania: '大洋洲' };
const CONTINENT_COUNTRIES: Record<Continent, Set<string>> = {
  asia: new Set('AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE AE'.split(' ')),
  europe: new Set('AD AL AT BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK'.split(' ')),
  africa: new Set('AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW'.split(' ')),
  northAmerica: new Set('AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PR SV SX TC TT US VC VG VI'.split(' ')),
  southAmerica: new Set('AR BO BR CL CO EC FK GF GY PE PY SR UY VE'.split(' ')),
  oceania: new Set('AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PW SB TK TO TV VU WF WS'.split(' ')),
};
const continentOf = (country: string): Continent => Object.entries(CONTINENT_COUNTRIES).find(([, countries]) => countries.has(country))?.[0] as Continent ?? 'asia';

/** One place travellers from this airport go: market size, who flies it, and (unflown) what a daily flight would carry. */
interface Dest { to: string; key: string; distKm: number; flown: boolean; total: number | null; rivalFlights: number; estimate: number; seats: number; spill: number }

/**
 * Where travellers from this airport go, biggest market first. One list replaces the old 市場 and 對手 lists, which
 * showed the same destinations twice. A row is a name, one grey line of facts and a bar: its length is the market
 * against the biggest one, the coloured part is your share. Tap a row to open it in place.
 */
export function AirportDestinations({ plan, result, code, onOpen, onOpenRoute }: {
  plan: Plan; result: NetworkResult | null; code: string; onOpen: (to: string) => void; onOpenRoute: (key: string) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const [scope, setScope] = useState<Scope>('all');
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo<Dest[]>(() => {
    const pot = marketPotential(plan, result, code);
    const out = new Map<string, Dest>();
    for (const m of pot.rows) out.set(m.to, { ...m, total: m.flown ? m.total : Math.max(m.total, 0) });
    // Smaller places rivals fly to, after the big markets; their size is worked out when they come on screen.
    const rest = rivalsAt(code).filter((r) => !out.has(r.to)).map((r) => ({ to: r.to, rf: [competitionFor(code, r.to), competitionFor(r.to, code)].reduce((s, c) => s + c.services.reduce((t, x) => t + x.freq, 0), 0) }));
    rest.sort((x, y) => y.rf - x.rf);
    for (const r of rest) out.set(r.to, { to: r.to, key: pairKey(code, r.to), distKm: marketBetween(code, r.to)?.distKm ?? 0, flown: false, total: null, rivalFlights: r.rf, estimate: 0, seats: 0, spill: 0 });
    return [...out.values()];
  }, [plan, result, code]);
  const inScope = (d: Dest, s: Scope) => s === 'all' || (s === 'long' ? d.distKm > LONG_HAUL_KM : s === 'short' ? d.distKm <= LONG_HAUL_KM : continentOf(AIRPORT_BY_CODE[d.to].country) === s);
  const scopes = useMemo(() => {
    const keys: Scope[] = ['all', 'short', 'long', ...(Object.keys(CONTINENT_LABELS) as Continent[])];
    return keys.map((k) => [k, all.filter((d) => inScope(d, k)).length] as const)
      // A choice that shows everything or nothing is not a choice.
      .filter(([k, n]) => k === 'all' || (n > 0 && n < all.length))
      .map(([k, n]) => [k, `${k === 'all' ? '全部' : k === 'short' ? '短程' : k === 'long' ? '長程' : CONTINENT_LABELS[k as Continent]} ${n}`] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);
  const list = all.filter((d) => inScope(d, scope));
  const page = list.slice(0, shown).map((d) => (d.total === null ? { ...d, total: marketSplit(code, d.to, undefined, result).total } : d));
  const top = Math.max(1, ...page.map((d) => d.total ?? 0));
  if (!all.length) return <div className="hint center">這裡還沒有航線市場</div>;
  return (
    <>
      <div className="list-head">
        {scopes.length > 1 ? <PullDown label="範圍" items={scopes} value={scope} onPick={(v) => { setScope(v); setShown(PAGE); setOpen(null); }} /> : <span />}
        <span className="list-cap-r">每週旅客</span>
      </div>
      <ul className="ap-list">
        {page.map((d) => {
          const r = result?.routes[d.key];
          const share = d.flown && r ? r.marketShare : 0;
          const isOpen = open === d.to;
          const ownFreq = r ? r.flightsPerWeek / 2 : 0;
          const facts = [
            d.flown ? `你 ${count(ownFreq)} 班` : null,
            d.rivalFlights ? `對手 ${count(d.rivalFlights)} 班` : '沒人直飛',
            !d.flown && d.estimate >= 1 ? `每日一班約 ${short(d.estimate)} 人` : null,
          ].filter(Boolean).join(' · ');
          return (
            <li key={d.to} className={isOpen ? 'open' : ''}>
              <button className="ap-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.to)}>
                <span className="ap-row-text">
                  <b>{AIRPORT_BY_CODE[d.to].name} <em>{d.to}</em>{d.flown && <span className="ap-tag">你 {pct(share)}</span>}</b>
                  <small>{facts}</small>
                </span>
                <span className="ap-row-num">{short(d.total ?? 0)}</span>
                <span className={`chev${isOpen ? ' open' : ''}`} aria-hidden="true" />
                <span className="ap-bar" aria-hidden="true"><i style={{ width: `${(100 * (d.total ?? 0)) / top}%` }}><i style={{ width: `${100 * share}%` }} /></i></span>
              </button>
              {isOpen && <DestDetail plan={plan} result={result} from={code} d={d} onOpen={() => onOpen(d.to)} onOpenRoute={() => onOpenRoute(d.key)} />}
            </li>
          );
        })}
      </ul>
      {list.length > shown && <button className="bridge-more" onClick={() => setShown(shown + PAGE * 2)}>再看 {Math.min(PAGE * 2, list.length - shown)} 個</button>}
    </>
  );
}

/** A destination opened in place: the one action, who carries its travellers, then timetables on demand. */
function DestDetail({ plan, result, from, d, onOpen, onOpenRoute }: { plan: Plan; result: NetworkResult | null; from: string; d: Dest; onOpen: () => void; onOpenRoute: () => void }) {
  const openCodeshare = useContext(CodeshareLink);
  const split = useMemo(() => marketSplit(from, d.to, result?.routes[d.key], result), [from, d.to, d.key, result]);
  const partners = useMemo(() => partnersOn(from, d.to), [from, d.to]);
  const rows = [...split.rows].sort((x, y) => y.pax - x.pax);
  const total = Math.max(1, rows.reduce((s, x) => s + x.pax, 0));
  const legend = rows.slice(0, 4);
  const restShare = rows.slice(4).reduce((s, x) => s + x.share, 0);
  const connections = split.rows.filter((x) => x.kind === 'ownVia' || x.kind === 'rivalVia');
  const services = rivalsBetween(from, d.to).filter((s) => s.from === from);
  return (
    <div className="ap-detail">
      <div className="ap-detail-acts">
        {d.flown ? <button className="primary small" onClick={onOpenRoute}>查看航線</button>
          : d.seats > 0 ? <button className="primary small" onClick={onOpen}><Icon n="plus" /> 開航 {from}⇄{d.to}</button>
            : <span className="hint">沒有適合的機型</span>}
        {openCodeshare && partners.slice(0, 3).map((al) => {
          const on = hasCodeshare(plan, al.id, d.key);
          return <button key={al.id} className={`chip${on ? ' on' : ''}`} onClick={() => openCodeshare(al.id, d.key)}><Icon n="link" /> {on ? `${al.name} 共享中` : `共享 ${al.name}`}</button>;
        })}
      </div>
      {rows.length > 0 && <>
        <div className="share-track ap-share" role="img" aria-label={rows.map((x) => `${shareRowName(x)} ${pct(x.share)}`).join('、')}>
          {rows.map((x) => <i key={x.id} className={transitRow(x) ? 'via' : ''} style={{ width: `${(100 * x.pax) / total}%`, background: rowColor(x) }} />)}
        </div>
        <ul className="ap-legend">
          {legend.map((x) => <li key={x.id}><i style={{ background: rowColor(x) }} className={transitRow(x) ? 'via' : ''} /><span>{shareRowName(x)}</span><b>{pct(x.share)}</b></li>)}
          {restShare >= 0.005 && <li><i style={{ background: 'var(--line-strong)' }} /><span>其他 {rows.length - 4} 項</span><b>{pct(restShare)}</b></li>}
        </ul>
      </>}
      {d.flown && d.spill >= 1 && <p className="ap-note warn">另有 {count(d.spill)} 人／週想搭你但客滿</p>}
      {(services.length > 0 || d.flown) && <details className="ap-more">
        <summary>直飛時刻<small>{services.reduce((s, x) => s + x.times.length, 0) || ''}</small></summary>
        <CompactTimetable from={from} to={d.to} services={services} plan={plan} showFilters={false} />
      </details>}
      {connections.length > 0 && <details className="ap-more">
        <summary>轉機行程<small>{connections.length}</small></summary>
        <ConnectionCards plan={plan} from={from} to={d.to} rows={connections} />
      </details>}
    </div>
  );
}

function ConnectionCards({ plan, from, to, rows }: { plan: Plan; from: string; to: string; rows: ShareRow[] }) {
  return <div className="airport-connection-schedules">
    {rows.map((connection) => {
      const first = connection.kind === 'rivalVia' ? rivalsBetween(from, connection.via!).filter((s) => s.from === from && s.airline.id === connection.airline?.id) : [];
      const second = connection.kind === 'rivalVia' ? rivalsBetween(connection.via!, to).filter((s) => s.from === connection.via && s.airline.id === connection.airline?.id) : [];
      const bridges = connection.kind === 'ownVia' ? ownBridgeOptions(plan, from, connection.via!, to) : rivalBridgeOptions(first, second);
      return <section className="airport-connection-card" key={connection.id}>
        <div className="airport-connection-title"><span><i style={{ background: rowColor(connection) }} />{shareRowName(connection)}</span><b>{pct(connection.share)}</b></div>
        <div className="airport-connection-path"><b>{from}</b><span>→ {connection.via} →</span><b>{to}</b><small>{count(connection.pax)} 人／週</small></div>
        {bridges.length ? <ol className="airport-bridge-options">{bridges.map((bridge, i) => <li key={`${bridge.dep1}-${bridge.dep2}`}>
          <span className="bridge-index">{i + 1}</span><span><small>{from} 出發</small><b>{hhmm(localMinutes(from, bridge.dep1))}</b></span>
          <span className="bridge-leg"><small>抵達 {connection.via}</small><b>{hhmm(localMinutes(connection.via!, bridge.arr1))}</b></span>
          <span className="bridge-wait"><small>轉機等候</small><b>{Math.floor(bridge.wait / 60)}小時{bridge.wait % 60 ? `${bridge.wait % 60}分` : ''}</b></span>
          <span><small>{to} 抵達</small><b>{hhmm(localMinutes(to, bridge.arr2))}</b></span>
        </li>)}</ol> : <p className="airport-connection-note">沒有 30 分鐘至 8 小時內銜接的班次。</p>}
      </section>;
    })}
  </div>;
}

/**
 * The airlines at this airport: one bar of everyone's weekly flights (you first), the four biggest named under it, then
 * one row per airline. Tap a name for its profile.
 */
export function AirportCarriers({ plan, result, code, onPickAirline }: { plan: Plan; result: NetworkResult | null; code: string; onPickAirline?: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const carriers = airlinesAt(code);
  const ours = Object.values(result?.routes ?? {}).filter((r) => r.a === code || r.b === code).reduce((s, r) => s + r.flightsPerWeek / 2, 0);
  const segs = [...(ours > 0 ? [{ id: 'own', name: '你', flights: ours, color: OWN }] : []), ...carriers.map((c) => ({ id: c.airline.id, name: c.airline.name, flights: c.flights, color: c.airline.color }))];
  const sum = Math.max(1, segs.reduce((s, x) => s + x.flights, 0));
  const top = Math.max(1, ...carriers.map((c) => c.flights));
  if (!carriers.length) return <div className="hint center">沒有對手，你會是第一家</div>;
  const named = segs.slice(0, 4);
  const rest = segs.slice(4).reduce((s, x) => s + x.flights, 0);
  void plan;
  return (
    <>
      <div className="ap-carrier-head">
        <div className="share-track ap-share" role="img" aria-label={segs.map((x) => `${x.name} ${count(x.flights)} 班/週`).join('、')}>
          {segs.map((x) => <i key={x.id} style={{ width: `${(100 * x.flights) / sum}%`, background: x.color }} />)}
        </div>
        <ul className="ap-legend">
          {named.map((x) => <li key={x.id}><i style={{ background: x.color }} /><span>{x.name}</span><b>{pct(x.flights / sum)}</b></li>)}
          {rest > 0 && <li><i style={{ background: 'var(--line-strong)' }} /><span>其他 {segs.length - 4} 家</span><b>{pct(rest / sum)}</b></li>}
        </ul>
      </div>
      <div className="list-cap"><span>{carriers.length} 家航空公司</span><span>班/週</span></div>
      <ul className="ap-list">
        {(all ? carriers : carriers.slice(0, 8)).map((c) => {
          const role = c.airline.bases[0] === code ? '主要樞紐' : c.airline.bases.includes(code) ? '基地' : `樞紐 ${c.airline.bases[0]}`;
          return (
            <li key={c.airline.id}>
              <button className="ap-row" onClick={() => onPickAirline?.(c.airline.id)} disabled={!onPickAirline}>
                <span className="ap-row-text">
                  <b><i className="ap-dot" style={{ background: c.airline.color }} />{c.airline.name}</b>
                  <small>{countryName(c.airline.country)} · {role} · {c.destinations} 航點</small>
                </span>
                <span className="ap-row-num">{count(c.flights)}</span>
                <span className="chev" aria-hidden="true" />
                <span className="ap-bar" aria-hidden="true"><i style={{ width: `${(100 * c.flights) / top}%`, background: c.airline.color }} /></span>
              </button>
            </li>
          );
        })}
      </ul>
      {!all && carriers.length > 8 && <button className="bridge-more" onClick={() => setAll(true)}>再看 {carriers.length - 8} 家</button>}
    </>
  );
}
