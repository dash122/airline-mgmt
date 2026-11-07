// Competitor airlines: a directory of every airline, and a profile for each one (hubs, routes, fleet and timetable).
import { createContext, useContext, useMemo, useState } from 'react';
import { AIRCRAFT, CLASS_NAMES } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { KIND_NAMES, type AirlineKind } from '../sim/competitors';
import { LONG_HAUL_KM } from '../sim/markets';
import { airlineNetwork, airlineNetworks, AREA_NAMES, AREA_ORDER, areaOf, countryName, departuresFrom, overlapWithPlan, type AirlineNetwork, type AirlineRoute } from '../sim/networks';
import { marketSplit } from '../sim/share';
import { hhmm, routePairs, type NetworkResult, type Plan } from '../sim/simulate';
import { nameAreaOf } from '../sim/competitors';
import { CompactTimetable } from './CompactTimetable';
import { count, pct, short } from './format';
import { Head, Sheet, shortType } from './sheets';
import { Badge, IN, Icon, type IconName } from './viz';

/** Opens an airline's profile from anywhere an airline name is shown. */
export const AirlineLink = createContext<((id: string) => void) | null>(null);
export const useAirlineLink = () => useContext(AirlineLink);

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;

/** The airline's colour swatch with the first two characters of its name, like a tail fin. */
export function Tail({ net, size = 34 }: { net: AirlineNetwork; size?: number }) {
  const a = net.airline;
  return <span className="tail" style={{ background: a.color, width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">{[...a.name].slice(0, 2).join('')}</span>;
}

const hubCodes = (net: AirlineNetwork) => net.hubs.map((h) => h.code).join('・');

// ---------- Directory ----------

type DirFilter = 'mine' | 'all';
type KindFilter = 'any' | AirlineKind;

export function AirlinesPanel({ plan, onPick, onClose }: { plan: Plan; onPick: (id: string) => void; onClose: () => void }) {
  const all = useMemo(() => airlineNetworks(), []);
  const flown = routePairs(plan).length;
  const rows = useMemo(() => all.map((net) => ({ net, ...overlapWithPlan(net, plan) })), [all, plan]);
  const mine = rows.filter((r) => r.routes.length || r.airports.length)
    .sort((x, y) => y.routes.length - x.routes.length || y.airports.length - x.airports.length || y.net.flights - x.net.flights);
  const [filter, setFilter] = useState<DirFilter>(mine.length ? 'mine' : 'all');
  const [kind, setKind] = useState<KindFilter>('any');
  const [q, setQ] = useState('');
  const query = q.trim().toUpperCase();
  const match = (net: AirlineNetwork) => (kind === 'any' || net.airline.kind === kind) && (!query
    || net.airline.name.toUpperCase().includes(query) || countryName(net.airline.country).includes(q.trim())
    || net.airline.country === query || net.airports.includes(query) || net.hubs.some((h) => name(h.code).includes(q.trim())));
  // Searching ranks name matches, then airlines based at the airport, then those that only fly there.
  const rank = (net: AirlineNetwork) => (net.airline.name.toUpperCase().includes(query) ? 0 : net.hubs.some((h) => h.code === query) || net.airline.bases[0] === query ? 1
    : countryName(net.airline.country).includes(q.trim()) || net.airline.country === query ? 2 : 3);
  const list = query
    ? rows.filter((r) => match(r.net)).sort((x, y) => rank(x.net) - rank(y.net) || y.net.flights - x.net.flights)
    : (filter === 'mine' ? mine : rows).filter((r) => match(r.net));
  const homeArea = nameAreaOf(AIRPORT_BY_CODE[plan.base].country);
  const groups = filter === 'all' && !query
    ? [homeArea, ...AREA_ORDER.filter((a) => a !== homeArea)].map((area) => ({ area, rows: list.filter((r) => areaOf(r.net.airline) === area) })).filter((g) => g.rows.length)
    : [{ area: null, rows: list }];
  return (
    <Sheet size="full" title={`航空公司 · ${all.length}`} onClose={onClose} info={<p>對手的樞紐、航線和機隊。點一家看它的航線網。搜尋可用航空、國家或機場代碼（如 HKG）。</p>}>
      <input className="search" type="search" placeholder="🔍 航空、國家、機場" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋航空公司" />
      {!query && (
        <div className="seg two" role="tablist">
          <button role="tab" className={filter === 'mine' ? 'on' : ''} onClick={() => setFilter('mine')}>交集 {mine.length}</button>
          <button role="tab" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>全部 {all.length}</button>
        </div>
      )}
      <div className="chips scroll kind-chips">
        {(['any', 'full', 'low', 'regional'] as KindFilter[]).map((k) => (
          <button key={k} className={`chip${kind === k ? ' strong' : ''}`} onClick={() => setKind(k)} aria-pressed={kind === k}>{k === 'any' ? '全部類型' : KIND_NAMES[k]}</button>
        ))}
      </div>
      {filter === 'mine' && !query && !flown && mine.length > 0 && <div className="hint"><Icon n="base" /> {plan.base}</div>}
      {groups.map((g) => (
        <section key={g.area ?? 'list'}>
          {g.area && <h4>{AREA_NAMES[g.area]} <small>{g.rows.length}</small></h4>}
          <ul className="airline-list">
            {g.rows.map(({ net, routes, airports }) => (
              <li key={net.airline.id}>
                <button onClick={() => onPick(net.airline.id)}>
                  <Tail net={net} />
                  <span className="name">
                    <b>{net.airline.name}<em>{KIND_NAMES[net.airline.kind]}</em></b>
                    <span className="ins"><span>{countryName(net.airline.country)}</span><IN n="hub" v={hubCodes(net)} label="樞紐" w="樞紐" /><IN n="plane" v={short(net.flights)} label="班/週" u="班/週" /></span>
                  </span>
                  {routes.length > 0
                    ? <Badge n="route" tone="warn">{routes.length} 條同線</Badge>
                    : airports.length > 0 ? <Badge n="base" tone="muted">{airports.length} 個同機場</Badge> : null}
                  <span className="chev">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!list.length && <div className="hint center">{query ? '找不到' : '還沒有和你重疊的航空'}</div>}
    </Sheet>
  );
}

// ---------- Profile ----------

type Section = 'routes' | 'hubs' | 'fleet' | 'vs';
type RouteFilter = 'all' | 'long' | 'mine' | `hub:${string}`;
const PAGE = 15;

export function AirlineSheet({ plan, result, id, focus, onFocus, onPickAirport, onOpenRoute, onOpen, back, onClose }: {
  plan: Plan; result: NetworkResult | null; id: string;
  /** The route picked out on the map. */
  focus: string | null; onFocus: (key: string | null) => void;
  onPickAirport: (code: string) => void; onOpenRoute: (key: string) => void; onOpen: (a: string, b: string) => void;
  back?: { label: string; go: () => void }; onClose: () => void;
}) {
  const net = useMemo(() => airlineNetwork(id), [id]);
  const [tab, setTab] = useState<Section>('routes');
  if (!net) return <Sheet title="航空公司" onClose={onClose}><div className="hint center">這家航空目前沒有航班。</div></Sheet>;
  const a = net.airline;
  const overlap = overlapWithPlan(net, plan);
  const aircraft = net.fleet.reduce((s, f) => s + f.aircraft, 0);
  const main = net.hubs[0];
  const tiles: { key: Section; icon: IconName; label: string; value: string; sub?: React.ReactNode }[] = [
    { key: 'routes', icon: 'route', label: '航線', value: count(net.routes.length), sub: <IN n="base" v={count(net.airports.length)} label="航點" u="個航點" /> },
    net.pointToPoint
      ? { key: 'hubs', icon: 'hub', label: '主要機場', value: main.code, sub: '點對點' }
      : { key: 'hubs', icon: 'hub', label: '樞紐', value: net.hubs.length > 1 ? `${net.hubs.length}` : main.code, sub: net.hubs.length > 1 ? hubCodes(net) : <IN n="share" v={pct(main.share)} label="占班次" w="占" u="班次" /> },
    { key: 'fleet', icon: 'plane', label: '機隊', value: `約 ${count(aircraft)} 架`, sub: `${net.fleet.length} 種機型` },
    { key: 'vs', icon: 'rival', label: '和你', value: overlap.routes.length ? `${overlap.routes.length}` : '—', sub: overlap.routes.length ? <IN n="route" v="同線" label="同航線競爭" /> : overlap.airports.length ? <IN n="base" v={overlap.airports.length} label="同機場" u="個同機場" /> : undefined },
  ];
  return (
    <Sheet title={a.name} onClose={onClose}
      sub={<span className="ins"><span>{countryName(a.country)} · {KIND_NAMES[a.kind]}</span><IN n="market" v={count(net.countries.length)} label="飛的國家" w="飛" u="國" /></span>}
      info={<p>{blurb(net)} {net.pointToPoint ? '最大機場' : '主樞紐'}：{name(main.code)} {main.code}。對手的班表和票價固定，不會因為你而改變。</p>}
      action={back && <button className="back" onClick={back.go} aria-label={`返回${back.label}`}>‹ {back.label}</button>}>
      <div className="al-head">
        <Tail net={net} size={44} />
        <div className="grow">
          <div className="al-facts">
            <span><b>{short(net.flights)}</b><small>班/週</small></span>
          </div>
        </div>
      </div>
      <div className="ap-tiles" role="tablist">
        {tiles.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="label"><Icon n={t.icon} /> {t.label}</span><span className="value">{t.value}</span>{t.sub && <small>{t.sub}</small>}
          </button>
        ))}
      </div>
      {tab === 'routes' && <RouteList plan={plan} net={net} focus={focus} onFocus={onFocus} onPickAirport={onPickAirport} onOpenRoute={onOpenRoute} onOpen={onOpen} />}
      {tab === 'hubs' && <Hubs net={net} onPickAirport={onPickAirport} onShowRoutes={() => setTab('routes')} />}
      {tab === 'fleet' && <Fleet net={net} />}
      {tab === 'vs' && <VersusYou plan={plan} result={result} net={net} onOpenRoute={onOpenRoute} onOpen={onOpen} onPickAirport={onPickAirport} />}
    </Sheet>
  );
}

/** One line on what kind of airline this is, from its network. */
function blurb(net: AirlineNetwork): string {
  const long = net.routes.filter((r) => r.distKm > LONG_HAUL_KM).length;
  const intl = net.countries.length - 1;
  const hubs = net.pointToPoint ? `航線分散，沒有明顯的樞紐（最忙的${name(net.hubs[0].code)}只占 ${pct(net.hubs[0].share)} 班次）`
    : net.hubs.length > 1 ? `以 ${hubCodes(net)} 為樞紐` : `以${name(net.hubs[0].code)}為樞紐（占 ${pct(net.hubs[0].share)} 班次）`;
  const reach = intl > 0 ? `飛 ${intl} 個其他國家${long ? `，其中 ${long} 條長程` : ''}` : '只飛國內';
  const style = net.airline.kind === 'low' ? '票價較低、服務精簡' : net.airline.kind === 'regional' ? '用小飛機飛較短、較冷門的航線' : '票價較高、服務較好';
  return `${hubs}，${reach}；${style}。`;
}

function RouteList({ plan, net, focus, onFocus, onPickAirport, onOpenRoute, onOpen }: {
  plan: Plan; net: AirlineNetwork; focus: string | null; onFocus: (key: string | null) => void;
  onPickAirport: (code: string) => void; onOpenRoute: (key: string) => void; onOpen: (a: string, b: string) => void;
}) {
  const [filter, setFilter] = useState<RouteFilter>('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const ours = useMemo(() => new Set(routePairs(plan).map((r) => r.key)), [plan]);
  const long = net.routes.filter((r) => r.distKm > LONG_HAUL_KM);
  const mine = net.routes.filter((r) => ours.has(r.key));
  const query = q.trim().toUpperCase();
  const list = net.routes.filter((r) =>
    (filter === 'all' || (filter === 'long' ? r.distKm > LONG_HAUL_KM : filter === 'mine' ? ours.has(r.key) : r.a === filter.slice(4) || r.b === filter.slice(4)))
    && (!query || r.a === query || r.b === query || name(r.a).includes(q.trim()) || name(r.b).includes(q.trim())));
  const pick = (f: RouteFilter) => { setFilter(f); setShown(PAGE); };
  return (
    <>
      <div className="chips scroll">
        <button className={`chip${filter === 'all' ? ' strong' : ''}`} onClick={() => pick('all')}>全部 {net.routes.length}</button>
        {net.hubs.map((h) => (
          <button key={h.code} className={`chip${filter === `hub:${h.code}` ? ' strong' : ''}`} onClick={() => pick(`hub:${h.code}`)}>{h.code} 出發 {h.destinations}</button>
        ))}
        {long.length > 0 && <button className={`chip${filter === 'long' ? ' strong' : ''}`} onClick={() => pick('long')}>長程 {long.length}</button>}
        {mine.length > 0 && <button className={`chip${filter === 'mine' ? ' strong' : ''}`} onClick={() => pick('mine')}><Icon n="route" /> 你也飛 {mine.length}</button>}
      </div>
      {net.routes.length > PAGE && <input className="search" type="search" placeholder="🔍 機場" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} aria-label="搜尋航線" />}
      <ul className="al-routes">
        {list.slice(0, shown).map((r) => (
          <RouteRow key={r.key} r={r} plan={plan} flown={ours.has(r.key)} open={focus === r.key}
            onToggle={() => onFocus(focus === r.key ? null : r.key)} onPickAirport={onPickAirport} onOpenRoute={onOpenRoute} onOpen={onOpen} />
        ))}
      </ul>
      {list.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, list.length - shown)} 條</button>}
      {!list.length && <div className="hint center">沒有符合的航線</div>}
    </>
  );
}

function RouteRow({ r, plan, flown, open, onToggle, onPickAirport, onOpenRoute, onOpen }: {
  r: AirlineRoute; plan: Plan; flown: boolean; open: boolean; onToggle: () => void;
  onPickAirport: (code: string) => void; onOpenRoute: (key: string) => void; onOpen: (a: string, b: string) => void;
}) {
  const [reverse, setReverse] = useState(false);
  const s = reverse ? r.back : r.out;
  return (
    <li className={`${open ? 'open' : ''}${flown ? ' flown' : ''}`}>
      <button className="al-route-top" onClick={onToggle} aria-expanded={open}>
        <span className="name">
          <b>{r.a} ⇄ {name(r.b)} {r.b}</b>
          <span className="ins"><IN n="long" v={`${count(r.distKm)}km`} label={r.distKm > LONG_HAUL_KM ? '長程' : '距離'} u={r.distKm > LONG_HAUL_KM ? ' 長程' : undefined} tone={r.distKm > LONG_HAUL_KM ? 'accent' : undefined} /><IN n="plane" v={shortType(r.type)} label="機型" /><IN n="fare" v={`$${count(r.fare)}`} label="票價 NT$" w="票價" /></span>
        </span>
        {flown && <Badge n="route" tone="warn" label="你也飛" />}
        <span className="rival-share">{count(r.freq)}<small>班/週</small></span>
      </button>
      {open && (
        <div className="al-route-more">
          <div className="rival-directions" role="group" aria-label="班表方向">
            <button aria-pressed={!reverse} onClick={() => setReverse(false)}>{r.a} → {r.b}</button>
            <button aria-pressed={reverse} onClick={() => setReverse(true)}>{r.b} → {r.a}</button>
          </div>
          <CompactTimetable from={s.from} to={s.to} services={[s]} plan={flown ? plan : undefined} />
          <div className="chips">
            {flown
              ? <button className="chip strong" onClick={() => onOpenRoute(r.key)}>看你的 {r.a} ⇄ {r.b}</button>
              : <button className="chip strong" onClick={() => onOpen(r.a, r.b)}>你也開航 {r.a} ⇄ {r.b}</button>}
            <button className="chip" onClick={() => onPickAirport(r.b)}>看{name(r.b)}機場</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Hubs({ net, onPickAirport, onShowRoutes }: { net: AirlineNetwork; onPickAirport: (code: string) => void; onShowRoutes: () => void }) {
  const hubFlights = net.hubs.reduce((s, h) => s + h.departures, 0);
  const others = net.airports.length - net.hubs.length;
  return (
    <>
      <ul className="hub-cards">
        {net.hubs.map((h) => {
          const deps = departuresFrom(net, h.code);
          const byHour = Array.from({ length: 24 }, (_, i) => deps.filter((d) => Math.floor(d.time / 60) === i).reduce((s, d) => s + d.freq, 0));
          const peak = Math.max(1, ...byHour);
          return (
            <li key={h.code}>
              <div className="hub-top">
                <span className="name"><b>{h.main && !net.pointToPoint && <Icon n="hub" label="主樞紐" />} {name(h.code)} {h.code}</b><small>{countryName(AIRPORT_BY_CODE[h.code].country)}</small></span>
                <button className="chip" onClick={() => onPickAirport(h.code)}>看機場</button>
              </div>
              <div className="hub-nums">
                <span><b>{count(h.departures)}</b><small>出發/週</small></span>
                <span><b>{h.destinations}</b><small>航點</small></span>
                <span><b>{pct(h.share)}</b><small>占它的班次</small></span>
              </div>
              <div className="hub-hours" role="img" aria-label={`${h.code} 一天中的出發班次`}>
                {byHour.map((n, i) => <i key={i} style={{ height: `${(100 * n) / peak}%`, background: net.airline.color }} />)}
              </div>
              <div className="hours-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
            </li>
          );
        })}
      </ul>
      {others > 0 && <div className="hint">另飛 {count(others)} 個機場 · {net.pointToPoint ? '這幾個' : '樞紐'}占 {pct(hubFlights / net.flights)} 班次 <button className="link-btn" onClick={onShowRoutes}>全部航線 ›</button></div>}
      <h4>飛到的國家</h4>
      <div className="chips">
        {countryCounts(net).map(([c, n]) => <span key={c} className="chip">{countryName(c)} <small>{n}</small></span>)}
      </div>
    </>
  );
}

const countryCounts = (net: AirlineNetwork): [string, number][] => {
  const m = new Map<string, number>();
  for (const c of net.airports) { const k = AIRPORT_BY_CODE[c].country; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((x, y) => y[1] - x[1]);
};

function Fleet({ net }: { net: AirlineNetwork }) {
  const [hub, setHub] = useState(net.hubs[0].code);
  const [shown, setShown] = useState(20);
  const deps = useMemo(() => departuresFrom(net, hub), [net, hub]);
  const maxA = Math.max(1, ...net.fleet.map((f) => f.aircraft));
  return (
    <>
      <Head info={<p>架數由班表推算：每架每天飛行加過站約 15 小時。</p>}>機隊（估計）</Head>
      <ul className="fleet-lines">
        {net.fleet.map((f) => (
          <li key={f.type}>
            <span className="name"><b>{AIRCRAFT[f.type].name}</b><span className="ins"><span>{CLASS_NAMES[AIRCRAFT[f.type].cls]}</span><IN n="seat" v={AIRCRAFT[f.type].seats} label="座位" u="座" /><IN n="route" v={f.routes} label="航線" u="條航線" /><IN n="plane" v={count(f.flights)} label="班/週" u="班/週" /></span>
              <span className="fleet-bar"><i style={{ width: `${(100 * f.aircraft) / maxA}%`, background: net.airline.color }} /></span></span>
            <span className="rival-share">約 {count(f.aircraft)}<small>架</small></span>
          </li>
        ))}
      </ul>
      <h4>出發時刻表 <small>當地時間</small></h4>
      {net.hubs.length > 1 && (
        <div className="chips">
          {net.hubs.map((h) => <button key={h.code} className={`chip${hub === h.code ? ' strong' : ''}`} onClick={() => { setHub(h.code); setShown(20); }}>{h.code}</button>)}
        </div>
      )}
      <ul className="dep-board">
        {deps.slice(0, shown).map((d, i) => (
          <li key={`${d.to}${i}`}>
            <time>{hhmm(d.time)}</time>
            <span className="name"><b>{name(d.to)} {d.to}</b><small>{shortType(d.type)}</small></span>
            <span className="dep-days">{d.freq >= 7 ? '每天' : `每週 ${d.freq} 班`}</span>
          </li>
        ))}
      </ul>
      {deps.length > shown && <button className="secondary" onClick={() => setShown(shown + 40)}>再顯示 {Math.min(40, deps.length - shown)} 班</button>}
    </>
  );
}

function VersusYou({ plan, result, net, onOpenRoute, onOpen, onPickAirport }: {
  plan: Plan; result: NetworkResult | null; net: AirlineNetwork; onOpenRoute: (key: string) => void; onOpen: (a: string, b: string) => void; onPickAirport: (code: string) => void;
}) {
  const overlap = overlapWithPlan(net, plan);
  const ours = new Set(routePairs(plan).map((r) => r.key));
  // Its routes from airports you already use that you don't fly yet: where you could take it on.
  const ideas = net.routes.filter((r) => !ours.has(r.key) && (overlap.airports.includes(r.a) || overlap.airports.includes(r.b))).slice(0, 8);
  return (
    <>
      {overlap.routes.length > 0 ? (
        <>
          <Head info={<p>班次為每週雙向。市占看班次、時段、票價和服務。{net.airline.kind === 'low' ? '廉價航空票價低，但服務評價也低。' : net.airline.kind === 'full' ? '全服務航空票價高一些，服務評價較好。' : ''}</p>}>同航線市占</Head>
          <ul className="vs-list">
            {overlap.routes.map((r) => {
              const split = marketSplit(r.a, r.b, result?.routes[r.key], result);
              const own = split.rows.find((x) => x.kind === 'own');
              const them = split.rows.find((x) => x.airline?.id === net.airline.id);
              return (
                <li key={r.key} className="flown">
                  <div className="vs-top" role="button" onClick={() => onOpenRoute(r.key)}>
                    <span className="name"><b>{r.a} ⇄ {r.b}</b><span className="ins"><IN n="plane" v={`${count(own?.freq ?? 0)} : ${count(them?.freq ?? 0)}`} label="班次 你 : 它" w="班次" /><IN n="pax" v={count(split.total)} label="旅客/週" u="人/週" /></span></span>
                    <span className="rival-share">{pct(own?.share ?? 0)} : {pct(them?.share ?? 0)}<small>市占 你 : 它</small></span>
                  </div>
                  <div className="share-track thin">
                    <div style={{ width: `${100 * (own?.share ?? 0)}%`, background: 'var(--accent)' }} />
                    <div style={{ width: `${100 * (them?.share ?? 0)}%`, background: net.airline.color }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : <div className="hint center">還沒有同航線競爭</div>}
      {overlap.airports.length > 0 && (
        <>
          <h4>你們都在的機場</h4>
          <div className="chips">{overlap.airports.map((c) => <button key={c} className="chip" onClick={() => onPickAirport(c)}>{name(c)} {c}</button>)}</div>
        </>
      )}
      {ideas.length > 0 && (
        <>
          <h4>它飛、你還沒飛</h4>
          <ul className="markets">
            {ideas.map((r) => (
              <li key={r.key}>
                <span className="name">{r.a} ⇄ {name(r.b)} {r.b}<span className="ins"><IN n="plane" v={`${r.freq}/週`} label="它的班次" w="它" /><IN n="fare" v={`$${count(r.fare)}`} label="票價 NT$" w="票價" /></span></span>
                <button onClick={() => onOpen(r.a, r.b)}>開航</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
