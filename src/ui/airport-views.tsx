// The airport sheet's competition and market potential sections, and the summary tiles that lead to each section.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlinesAt, rivalsAt, rivalsBetween } from '../sim/competitors';
import { countryName } from '../sim/networks';
import type { NetworkResult } from '../sim/simulate';
import { marketSplit, type ShareRow } from '../sim/share';
import { allFlights, marketPotential, type AirportPotential, type MarketPotential } from '../sim/airports';
import { LONG_HAUL_KM, marketBetween, pairKey } from '../sim/markets';
import { blockMinutes, defaultAircraft, hhmm, localMinutes, utcFromLocal, type Plan } from '../sim/simulate';
import { CompactTimetable } from './CompactTimetable';
import { AirlineName } from './rivals';
import { count, pct } from './format';
import { Head } from './sheets';
import { Badge, IN, Icon, type IconName } from './viz';

export type AirportSection = 'routes' | 'rivals' | 'market' | 'transfer';

export interface Tile {
  key: AirportSection;
  icon: IconName;
  label: string;
  value: string;
  sub?: ReactNode;
}

/** Four tiles, the same for every airport, in the same order. Each one opens its section. */
export function AirportTiles({ tiles, on, onPick }: { tiles: Tile[]; on: AirportSection; onPick: (s: AirportSection) => void }) {
  return (
    <div className="ap-tiles" role="tablist" aria-label="機場資訊">
      {tiles.map((t) => (
        <button key={t.key} role="tab" aria-selected={on === t.key} className={on === t.key ? 'on' : ''} onClick={() => onPick(t.key)}>
          <span className="label"><Icon n={t.icon} /> {t.label}</span>
          <span className="ap-tab-count">{t.value !== '—' && t.value !== '?' ? t.value : ''}</span>
        </button>
      ))}
    </div>
  );
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
const PAGE = 10;
type RouteFilter = 'all' | 'short' | 'long';
type RouteView = RouteFilter | Continent;
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

/** Routes from this airport with the player against each competitor: flights and share of travellers. */
export function AirportCompetition({ plan, result, code, onOpenRoute, onOpen }: {
  plan: Plan; result: NetworkResult | null; code: string; onOpenRoute: (key: string) => void; onOpen: (to: string) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<RouteView>('all');
  const [open, setOpen] = useState<string | null>(null);
  const carriers = airlinesAt(code);
  const dests = useMemo(() => {
    const ours = new Set(Object.values(result?.routes ?? {}).filter((r) => r.a === code || r.b === code).map((r) => (r.a === code ? r.b : r.a)));
    const rival = rivalsAt(code).map((r) => r.to);
    return [...ours, ...rival.filter((d) => !ours.has(d))];
  }, [result, code]);
  const filteredDests = useMemo(() => dests.filter((to) => {
    const dist = marketBetween(code, to)?.distKm ?? 0;
    if (filter === 'all') return true;
    if (filter === 'long') return dist > LONG_HAUL_KM;
    if (filter === 'short') return dist <= LONG_HAUL_KM;
    return continentOf(AIRPORT_BY_CODE[to].country) === filter;
  }), [dests, code, filter]);
  const routeFilters = useMemo(() => {
    const counts: Record<RouteView, number> = { all: dests.length, short: 0, long: 0, asia: 0, europe: 0, africa: 0, northAmerica: 0, southAmerica: 0, oceania: 0 };
    for (const to of dests) {
      const dist = marketBetween(code, to)?.distKm ?? 0;
      counts[dist > LONG_HAUL_KM ? 'long' : 'short']++;
      counts[continentOf(AIRPORT_BY_CODE[to].country)]++;
    }
    return counts;
  }, [dests, code]);
  const rows = useMemo(() => filteredDests.slice(0, shown).map((to) => {
    const r = result?.routes[pairKey(code, to)];
    return { to, flown: !!r, split: marketSplit(code, to, r, result) };
  }), [filteredDests, shown, result, code]);
  const ourFlights = Object.values(result?.routes ?? {}).filter((r) => r.a === code || r.b === code).reduce((s, r) => s + r.flightsPerWeek / 2, 0);
  const rivalFlights = carriers.reduce((s, c) => s + c.flights, 0);
  const [allCarriers, setAllCarriers] = useState(false);
  if (!dests.length) return <div className="hint center">沒有對手，你會是第一家</div>;
  useEffect(() => {
    if (filter !== 'all' && routeFilters[filter] === 0) setFilter('all');
  }, [filter, routeFilters]);
  const topFlights = Math.max(1, ...carriers.map((c) => c.flights));
  return (
    <>
      <div className="vs-head">
        <div><b>{count(ourFlights)}</b><small>你 · 班/週</small></div>
        <span>vs</span>
        <div><b>{count(rivalFlights)}</b><small>{carriers.length} 家對手 · 班/週</small></div>
      </div>
      <div className="share-track airport-competition-share" role="group" aria-label={`每週航班：你 ${count(ourFlights)} 班，對手 ${count(rivalFlights)} 班`}>
        {[
          { id: 'own', name: '你', flights: ourFlights, color: OWN },
          ...carriers.map((c) => ({ id: c.airline.id, name: c.airline.name, flights: c.flights, color: c.airline.color })),
        ].map((segment) => {
          const label = `${segment.name}：${count(segment.flights)} 班/週`;
          return (
            <div key={segment.id} className="airport-competition-segment" tabIndex={0} aria-label={label} style={{ width: `${(100 * segment.flights) / Math.max(1, ourFlights + rivalFlights)}%`, background: segment.color }}>
              <span className="airport-competition-tooltip" role="tooltip"><i style={{ background: segment.color }} /><span><b>{segment.name}</b><small>每週航班</small></span><strong>{count(segment.flights)}<small>班</small></strong></span>
            </div>
          );
        })}
      </div>
      <Head info={<p>每週、雙向。<span className="k" style={{ color: OWN }}>■</span> 你 <span className="k spill">■</span> 想搭你但客滿，其他顏色是各家對手。你飛的航線點了開航線；沒飛的點了看對手班表。對手的班表和票價固定。</p>}>每條航線</Head>
      <div className="airport-route-filters" role="group" aria-label="航線篩選">
        {([
          ['all', `全部 ${routeFilters.all}`],
          ['short', `短程 ${routeFilters.short}`],
          ['long', `長程 ${routeFilters.long}`],
          ...Object.entries(CONTINENT_LABELS).map(([key, label]) => [key, `${label} ${routeFilters[key as Continent]}`] as [RouteView, string]),
        ] as [RouteView, string][]).filter(([key]) => key === 'all' || routeFilters[key] > 0).map(([key, label]) => (
          <button key={key} className={`chip${filter === key ? ' strong' : ''}`} aria-pressed={filter === key} onClick={() => { setFilter(key); setShown(PAGE); }}>{label}</button>
        ))}
      </div>
      <ul className="vs-list">
        {rows.map(({ to, flown, split }) => {
          const own = split.rows.find((x) => x.kind === 'own');
          const rivals = split.rows.filter((x) => x.kind === 'rival');
          const directRows = split.rows.filter((x) => !transitRow(x));
          const directPax = directRows.reduce((sum, row) => sum + row.pax, 0);
          const transitRows = split.rows.filter(transitRow);
          const transitPax = transitRows.reduce((sum, row) => sum + row.pax, 0);
          const connectionRows = transitRows.filter((x) => x.kind === 'ownVia' || x.kind === 'rivalVia');
          const rf = rivals.reduce((s, x) => s + x.freq, 0);
          const isOpen = open === to;
          return (
            <li key={to} className={flown ? 'flown' : ''}>
              <div className="vs-top" role="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : to)}>
                <span className="name"><b>{AIRPORT_BY_CODE[to].name} {to}</b>
                  <span className="ins">{flown && <IN n="plane" v={count(own?.freq ?? 0)} label="你的班次/週" w="你" u="班" tone="accent" />}<IN n="rival" v={count(rf)} label="對手班次/週" w="對手" u="班" /><IN n="pax" v={count(split.total)} label="旅客/週" u="人/週" /></span></span>
                <span className="rival-share">{flown ? pct(own?.share ?? 0) : '—'}<small>{flown ? '市占' : '未開航'}</small></span>
              </div>
              {!isOpen && <div className="airport-row-summary">
                <div className="airport-row-summary-track" role="img" aria-label={`直飛 ${pct(directPax / Math.max(1, split.total))}，轉機 ${pct(transitPax / Math.max(1, split.total))}`}>
                  <i className="direct" style={{ width: `${100 * directPax / Math.max(1, split.total)}%` }} />
                  <i className="connecting" style={{ width: `${100 * transitPax / Math.max(1, split.total)}%` }} />
                </div>
                <div><span>直飛 {pct(directPax / Math.max(1, split.total))}</span><span>轉機 {pct(transitPax / Math.max(1, split.total))}</span><small>展開</small></div>
              </div>}
              {isOpen && <div className="vs-actions">
                {flown
                  ? <button className="chip strong" onClick={() => onOpenRoute(pairKey(code, to))}>查看航線 {code} ⇄ {to}</button>
                  : <button className="chip strong" onClick={() => onOpen(to)}>開航 {code} ⇄ {to}</button>}
              </div>}
              {isOpen && <div className="airport-share-groups">
                {[{ key: 'direct', label: '直飛', rows: directRows }, { key: 'connecting', label: '轉機', rows: transitRows }].map((group) => group.rows.length > 0 && (
                  <section className={`airport-share-group ${group.key}`} key={group.key}>
                    <div className="airport-share-group-title"><b>{group.label}</b><span>{pct(group.rows.reduce((sum, x) => sum + x.pax, 0) / Math.max(1, split.total))}</span></div>
                    <div className="share-track thin" role="img" aria-label={`${group.label}：${group.rows.map((x) => `${shareRowName(x)} ${pct(x.share)}`).join('、')}`}>
                      {group.rows.map((x) => <i key={x.id} title={`${shareRowName(x)} · ${pct(x.share)} · ${count(x.pax)} 人/週`} style={{ width: `${100 * x.pax / Math.max(1, group.rows.reduce((sum, row) => sum + row.pax, 0))}%`, background: rowColor(x) }} />)}
                    </div>
                    <ul className="airport-share-legend">{group.rows.map((x) => <li key={x.id}><i style={{ background: rowColor(x) }} /><span>{shareRowName(x)}</span><b>{pct(x.share)}</b></li>)}</ul>
                  </section>
                ))}
                {split.ownTurnedAway >= 1 && <div className="airport-share-lost">另有 {count(split.ownTurnedAway)} 人／週想搭你但客滿</div>}
              </div>}
              {isOpen && (
                <div className="vs-more">
                  <div className="airport-direct-schedules"><h5>直飛航班時刻</h5><CompactTimetable from={code} to={to} services={rivalsBetween(code, to).filter((s) => s.from === code)} plan={plan} showFilters={false} /></div>
                  {transitPax > 0 && <div className="airport-transit-share">
                    <div className="airport-transit-heading"><b>轉機旅客</b><span>{pct(transitPax / Math.max(1, split.total))} · {count(transitPax)} 人／週</span></div>
                    <div className="airport-connection-schedules">
                      <h5>轉機航班時刻</h5>
                      {connectionRows.map((connection) => {
                        const firstLeg = connection.kind === 'rivalVia'
                          ? rivalsBetween(code, connection.via!).filter((s) => s.from === code && s.airline.id === connection.airline?.id)
                          : [];
                        const secondLeg = connection.kind === 'rivalVia'
                          ? rivalsBetween(connection.via!, to).filter((s) => s.from === connection.via && s.airline.id === connection.airline?.id)
                          : [];
                        const bridges = connection.kind === 'ownVia' && plan ? ownBridgeOptions(plan, code, connection.via!, to) : rivalBridgeOptions(firstLeg, secondLeg);
                        return <section className="airport-connection-card" key={connection.id}>
                          <div className="airport-connection-title"><span><i style={{ background: rowColor(connection) }} />{shareRowName(connection)}</span><b>{pct(connection.share)}</b></div>
                          <div className="airport-connection-path"><b>{code}</b><span>→ {connection.via} →</span><b>{to}</b><small>{count(connection.pax)} 人／週</small></div>
                          {bridges.length ? <ol className="airport-bridge-options">{bridges.map((bridge, i) => <li key={`${bridge.dep1}-${bridge.dep2}`}>
                            <span className="bridge-index">{i + 1}</span>
                            <span><small>{code} 出發</small><b>{hhmm(localMinutes(code, bridge.dep1))}</b></span>
                            <span className="bridge-leg"><small>抵達 {connection.via}</small><b>{hhmm(localMinutes(connection.via!, bridge.arr1))}</b></span>
                            <span className="bridge-wait"><small>轉機等候</small><b>{Math.floor(bridge.wait / 60)}小時{bridge.wait % 60 ? `${bridge.wait % 60}分` : ''}</b></span>
                            <span><small>{to} 抵達</small><b>{hhmm(localMinutes(to, bridge.arr2))}</b></span>
                          </li>)}</ol> : <p className="airport-connection-note">目前沒有能在 30 分鐘至 8 小時內銜接的班次。</p>}
                        </section>;
                      })}
                      {transitRows.some((x) => x.kind === 'connecting') && <p className="airport-connection-note">其他航空轉機的市場占比已計入；模型未提供其承運航空與分段班表。</p>}
                      {connectionRows.some((x) => x.kind === 'ownVia') && <p className="airport-connection-note">你的轉機旅客經營運班表銜接；請在上方航線班表查看各段航班。</p>}
                    </div>
                  </div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {filteredDests.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, filteredDests.length - shown)} 條</button>}
      <h4><Icon n="rival" /> 航空公司 <small>{carriers.length}</small></h4>
      <ul className="competitor-list">
        {(allCarriers ? carriers : carriers.slice(0, 8)).map((c) => (
          <li key={c.airline.id} className={`carrier${c.airline.bases.includes(code) ? ' airport-carrier-hub' : ''}`}>
            <span className="name"><AirlineName airline={c.airline} />
              <small className="airport-carrier-meta">{countryName(c.airline.country)} · {c.airline.bases[0] === code ? '主要樞紐' : c.airline.bases.includes(code) ? '基地' : `樞紐：${c.airline.bases[0]}`}</small>
              <span className="carrier-bar"><i style={{ width: `${(100 * c.flights) / topFlights}%`, background: c.airline.color }} /></span></span>
            {c.airline.bases[0] === code ? <Badge n="hub" tone="accent" label="主要樞紐" /> : c.airline.bases.includes(code) ? <Badge n="base" tone="muted" label="基地" /> : null}
            <span className="rival-share" title={`${c.destinations} 個航點`}>{count(c.flights)}<small>班/週</small></span>
          </li>
        ))}
      </ul>
      {!allCarriers && carriers.length > 8 && <button className="secondary" onClick={() => setAllCarriers(true)}>其他 {carriers.length - 8} 家</button>}
    </>
  );
}

/** Demand available at this airport against what the player captures, market by market. */
export function AirportMarkets({ plan, result, code, onOpen, onOpenRoute }: {
  plan: Plan; result: NetworkResult | null; code: string; onOpen: (to: string) => void; onOpenRoute: (key: string) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const pot = useMemo(() => marketPotential(plan, result, code), [plan, result, code]);
  return (
    <>
      <PotentialHead pot={pot} />
      <Head info={<p>每週、雙向。沒飛的市場用和模擬一樣的算法估：每天一班來回、平均時段、你的票價，未扣座位上限。</p>}>市場</Head>
      <div className="market-list-heading"><span>目的地</span><span>每週旅客 · 點擊查看</span></div>
      <ul className="pot-list">
        {pot.rows.slice(0, shown).map((m) => <PotentialRow key={m.to} m={m} from={code} plan={plan} result={result} onOpen={() => onOpen(m.to)} onOpenRoute={() => onOpenRoute(m.key)} />)}
      </ul>
      {pot.rows.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, pot.rows.length - shown)} 個</button>}
    </>
  );
}

function PotentialHead({ pot }: { pot: AirportPotential }) {
  const share = pot.total > 0 ? pot.ours / pot.total : 0;
  return (
    <div className="pot-head">
      <div className="pot-nums">
        <div><b>{count(pot.total)}</b><small>人/週</small></div>
        <div><b className="acc">{count(pot.ours)}</b><small>搭你直飛 {pct(share)}</small></div>
        {pot.transfer >= 1 && <div><b>{count(pot.transfer)}</b><small>在這裡轉機</small></div>}
      </div>
      <div className="share-track"><div style={{ width: `${Math.min(100, share * 100)}%`, background: OWN }} /></div>
    </div>
  );
}

function PotentialRow({ m, from, plan, result, onOpen, onOpenRoute }: { m: MarketPotential; from: string; plan: Plan; result: NetworkResult | null; onOpen: () => void; onOpenRoute: () => void }) {
  const [open, setOpen] = useState(false);
  const split = marketSplit(from, m.to, result?.routes[m.key], result);
  const directRows = split.rows.filter((x) => !transitRow(x));
  const transitRows = split.rows.filter(transitRow);
  const directPax = directRows.reduce((sum, x) => sum + x.pax, 0);
  const transitPax = transitRows.reduce((sum, x) => sum + x.pax, 0);
  const connectionRows = transitRows.filter((x) => x.kind === 'ownVia' || x.kind === 'rivalVia');
  const aircraft = plan.fleet.find((ac) => ac.legs.some((leg) => pairKey(leg.from, leg.to) === m.key));
  const type = aircraft?.type ?? defaultAircraft(from, m.to);
  return (
    <li className={`potential-card vs-card${m.flown ? ' flown' : ''}${open ? ' expanded' : ''}`}>
      <button className="potential-toggle vs-top" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="potential-destination name"><b>{AIRPORT_BY_CODE[m.to].name} {m.to}</b><span className="ins">
          <IN n="rival" v={count(m.rivalFlights)} label="對手班次／週" w="對手" u="班" />
          <IN n="pax" v={count(m.total)} label="市場旅客／週" u="人／週" />
          {!m.flown && m.seats > 0 && <IN n="plane" v={`約 ${count(m.estimate)}`} label="每日一班估計旅客／週" w="估計" u="人／週" />}
        </span></span>
        <span className="rival-share">{m.flown ? pct(split.rows.find((x) => x.kind === 'own')?.share ?? 0) : '—'}<small>{m.flown ? '你的市占' : '未開航'}</small></span>
        <span className="potential-chevron" aria-hidden="true">›</span>
      </button>
      {!open && <div className="airport-row-summary">
        <div className="airport-row-summary-track" role="img" aria-label={`直飛 ${pct(directPax / Math.max(1, split.total))}，轉機 ${pct(transitPax / Math.max(1, split.total))}`}>
          <i className="direct" style={{ width: `${100 * directPax / Math.max(1, split.total)}%` }} /><i className="connecting" style={{ width: `${100 * transitPax / Math.max(1, split.total)}%` }} />
        </div>
        <div><span>直飛 {pct(directPax / Math.max(1, split.total))}</span><span>轉機 {pct(transitPax / Math.max(1, split.total))}</span><small>展開</small></div>
      </div>}
      {open && <>
        <div className="vs-actions market-row-action">
          {m.flown ? <button className="chip strong" onClick={onOpenRoute}>查看航線 {from} ⇄ {m.to}</button>
            : m.seats > 0 ? <button className="chip strong" onClick={onOpen}>規劃航線 {from} ⇄ {m.to}</button>
              : <span className="potential-unavailable">目前沒有適合的機型</span>}
        </div>
        <div className="airport-share-groups">
          {[{ key: 'direct', label: '直飛', rows: directRows }, { key: 'connecting', label: '轉機', rows: transitRows }].map((group) => group.rows.length > 0 && <section className={`airport-share-group ${group.key}`} key={group.key}>
            <div className="airport-share-group-title"><b>{group.label}</b><span>{pct(group.rows.reduce((sum, x) => sum + x.pax, 0) / Math.max(1, split.total))}</span></div>
            <div className="share-track thin" role="img" aria-label={`${group.label}：${group.rows.map((x) => `${shareRowName(x)} ${pct(x.share)}`).join('、')}`}>
              {group.rows.map((x) => <i key={x.id} title={`${shareRowName(x)} · ${pct(x.share)} · ${count(x.pax)} 人／週`} style={{ width: `${100 * x.pax / Math.max(1, group.rows.reduce((sum, row) => sum + row.pax, 0))}%`, background: rowColor(x) }} />)}
            </div>
            <ul className="airport-share-legend">{group.rows.map((x) => <li key={x.id}><i style={{ background: rowColor(x) }} /><span>{shareRowName(x)}</span><b>{pct(x.share)}</b></li>)}</ul>
          </section>)}
        </div>
        <div className="vs-more market-row-details">
          <div className="airport-direct-schedules"><h5>直飛航班時刻</h5><CompactTimetable from={from} to={m.to} services={rivalsBetween(from, m.to).filter((s) => s.from === from)} plan={plan} showFilters={false} /></div>
          {transitPax > 0 && <div className="airport-transit-share"><div className="airport-transit-heading"><b>轉機旅客</b><span>{pct(transitPax / Math.max(1, split.total))} · {count(transitPax)} 人／週</span></div>
            <div className="airport-connection-schedules"><h5>轉機航班時刻</h5>
              {connectionRows.map((connection) => {
                const first = connection.kind === 'rivalVia' ? rivalsBetween(from, connection.via!).filter((s) => s.from === from && s.airline.id === connection.airline?.id) : [];
                const second = connection.kind === 'rivalVia' ? rivalsBetween(connection.via!, m.to).filter((s) => s.from === connection.via && s.airline.id === connection.airline?.id) : [];
                const bridges = connection.kind === 'ownVia' ? ownBridgeOptions(plan, from, connection.via!, m.to) : rivalBridgeOptions(first, second);
                return <section className="airport-connection-card" key={connection.id}>
                  <div className="airport-connection-title"><span><i style={{ background: rowColor(connection) }} />{shareRowName(connection)}</span><b>{pct(connection.share)}</b></div>
                  <div className="airport-connection-path"><b>{from}</b><span>→ {connection.via} →</span><b>{m.to}</b><small>{count(connection.pax)} 人／週</small></div>
                  {bridges.length ? <ol className="airport-bridge-options">{bridges.map((bridge, i) => <li key={`${bridge.dep1}-${bridge.dep2}`}>
                    <span className="bridge-index">{i + 1}</span><span><small>{from} 出發</small><b>{hhmm(localMinutes(from, bridge.dep1))}</b></span>
                    <span className="bridge-leg"><small>抵達 {connection.via}</small><b>{hhmm(localMinutes(connection.via!, bridge.arr1))}</b></span>
                    <span className="bridge-wait"><small>轉機等候</small><b>{Math.floor(bridge.wait / 60)}小時{bridge.wait % 60 ? `${bridge.wait % 60}分` : ''}</b></span>
                    <span><small>{m.to} 抵達</small><b>{hhmm(localMinutes(m.to, bridge.arr2))}</b></span>
                  </li>)}</ol> : <p className="airport-connection-note">目前沒有能在 30 分鐘至 8 小時內銜接的班次。</p>}
                </section>;
              })}
              {transitRows.some((x) => x.kind === 'connecting') && <p className="airport-connection-note">其他航空轉機的旅客已計入，但沒有可用的分段班表。</p>}
            </div>
          </div>}
        </div>
        {!m.flown && m.seats > 0 && <p className="airport-connection-note market-estimate-note">未開航估算以每日一班來回計算，尚未扣除座位上限。</p>}
        {m.flown && m.spill >= 1 && <p className="airport-connection-note">另有 {count(m.spill)} 人／週想搭你但客滿。</p>}
      </>}
    </li>
  );
}
