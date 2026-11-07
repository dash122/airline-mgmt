// The airport sheet's competition and market potential sections, and the summary tiles that lead to each section.
import { useMemo, useState, type ReactNode } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlinesAt, rivalsAt, rivalsBetween } from '../sim/competitors';
import { marketSplit, type ShareRow } from '../sim/share';
import { marketPotential, type AirportPotential, type MarketPotential } from '../sim/airports';
import { pairKey } from '../sim/markets';
import type { NetworkResult, Plan } from '../sim/simulate';
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
    <div className="ap-tiles" role="tablist">
      {tiles.map((t) => (
        <button key={t.key} role="tab" aria-selected={on === t.key} className={on === t.key ? 'on' : ''} onClick={() => onPick(t.key)}>
          <span className="label"><Icon n={t.icon} /> {t.label}</span>
          <span className="value">{t.value}</span>
          {t.sub && <small>{t.sub}</small>}
        </button>
      ))}
    </div>
  );
}

const OWN = 'var(--accent)';
const rowColor = (r: ShareRow) => (r.kind === 'own' ? OWN : r.kind === 'connecting' ? 'var(--muted)' : r.airline?.color ?? 'var(--muted)');
const PAGE = 10;

/** Routes from this airport with the player against each competitor: flights and share of travellers. */
export function AirportCompetition({ result, code, onOpenRoute, onOpen }: {
  result: NetworkResult | null; code: string; onOpenRoute: (key: string) => void; onOpen: (to: string) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const carriers = airlinesAt(code);
  const dests = useMemo(() => {
    const ours = new Set(Object.values(result?.routes ?? {}).filter((r) => r.a === code || r.b === code).map((r) => (r.a === code ? r.b : r.a)));
    const rival = rivalsAt(code).map((r) => r.to);
    return [...ours, ...rival.filter((d) => !ours.has(d))];
  }, [result, code]);
  const rows = useMemo(() => dests.slice(0, shown).map((to) => {
    const r = result?.routes[pairKey(code, to)];
    return { to, flown: !!r, split: marketSplit(code, to, r, result) };
  }), [dests, shown, result, code]);
  const ourFlights = Object.values(result?.routes ?? {}).filter((r) => r.a === code || r.b === code).reduce((s, r) => s + r.flightsPerWeek / 2, 0);
  const rivalFlights = carriers.reduce((s, c) => s + c.flights, 0);
  const [allCarriers, setAllCarriers] = useState(false);
  if (!dests.length) return <div className="hint center">沒有對手，你會是第一家</div>;
  const topFlights = Math.max(1, ...carriers.map((c) => c.flights));
  return (
    <>
      <div className="vs-head">
        <div><b>{count(ourFlights)}</b><small>你 · 班/週</small></div>
        <span>vs</span>
        <div><b>{count(rivalFlights)}</b><small>{carriers.length} 家對手 · 班/週</small></div>
      </div>
      <div className="share-track" role="img" aria-label={`你 ${count(ourFlights)} 班，對手 ${count(rivalFlights)} 班`}>
        <div style={{ width: `${(100 * ourFlights) / Math.max(1, ourFlights + rivalFlights)}%`, background: OWN }} />
        {carriers.map((c) => <div key={c.airline.id} style={{ width: `${(100 * c.flights) / Math.max(1, ourFlights + rivalFlights)}%`, background: c.airline.color }} />)}
      </div>
      <Head info={<p>每週、雙向。<span className="k" style={{ color: OWN }}>■</span> 你 <span className="k spill">■</span> 想搭你但客滿，其他顏色是各家對手。你飛的航線點了開航線；沒飛的點了看對手班表。對手的班表和票價固定。</p>}>每條航線</Head>
      <ul className="vs-list">
        {rows.map(({ to, flown, split }) => {
          const own = split.rows.find((x) => x.kind === 'own');
          const rivals = split.rows.filter((x) => x.kind === 'rival');
          const rf = rivals.reduce((s, x) => s + x.freq, 0);
          const isOpen = open === to;
          return (
            <li key={to} className={flown ? 'flown' : ''}>
              <div className="vs-top" role="button" aria-expanded={isOpen} onClick={() => (flown ? onOpenRoute(pairKey(code, to)) : setOpen(isOpen ? null : to))}>
                <span className="name"><b>{AIRPORT_BY_CODE[to].name} {to}</b>
                  <span className="ins">{flown && <IN n="plane" v={count(own?.freq ?? 0)} label="你的班次/週" w="你" u="班" tone="accent" />}<IN n="rival" v={count(rf)} label="對手班次/週" w="對手" u="班" /><IN n="pax" v={count(split.total)} label="旅客/週" u="人/週" /></span></span>
                <span className="rival-share">{flown ? pct(own?.share ?? 0) : '—'}<small>{flown ? '市占' : '未開航'}</small></span>
              </div>
              <div className="share-track thin">
                {split.rows.map((x) => <div key={x.id} style={{ width: `${100 * x.share}%`, background: rowColor(x) }} />)}
                {split.ownTurnedAway >= 1 && <div className="lost" style={{ width: `${(100 * split.ownTurnedAway) / Math.max(1, split.total)}%` }} />}
              </div>
              {isOpen && (
                <div className="vs-more">
                  <CompactTimetable from={code} to={to} services={rivalsBetween(code, to).filter((s) => s.from === code)} />
                  <button className="chip strong" onClick={() => onOpen(to)}>開航 {code} ⇄ {to}</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {dests.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, dests.length - shown)} 條</button>}
      <h4><Icon n="rival" /> 航空公司 <small>{carriers.length}</small></h4>
      <ul className="competitor-list">
        {(allCarriers ? carriers : carriers.slice(0, 8)).map((c) => (
          <li key={c.airline.id} className="carrier">
            <span className="name"><AirlineName airline={c.airline} />
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
      <div className="legend-line"><span className="k" style={{ color: OWN }}>■</span> 你載的 <span className="k spill">■</span> 客滿 <span className="k est">■</span> 每天一班可拿 <span className="k rest">■</span> 其他</div>
      <ul className="pot-list">
        {pot.rows.slice(0, shown).map((m) => <PotentialRow key={m.to} m={m} max={Math.max(1, ...pot.rows.map(size))} onOpen={() => onOpen(m.to)} onOpenRoute={() => onOpenRoute(m.key)} />)}
      </ul>
      {pot.rows.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, pot.rows.length - shown)} 個</button>}
    </>
  );
}

const size = (m: MarketPotential) => Math.max(m.total, m.ours + m.spill, m.estimate);

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

function PotentialRow({ m, max, onOpen, onOpenRoute }: { m: MarketPotential; max: number; onOpen: () => void; onOpenRoute: () => void }) {
  const w = (x: number) => `${(100 * x) / max}%`;
  const rest = Math.max(0, m.total - m.ours - (m.flown ? 0 : m.estimate));
  return (
    <li className={m.flown ? 'flown' : ''}>
      <div className="vs-top" role={m.flown ? 'button' : undefined} onClick={m.flown ? onOpenRoute : undefined}>
        <span className="name"><b>{AIRPORT_BY_CODE[m.to].name} {m.to}</b>
          <span className="ins"><IN n="rival" v={count(m.rivalFlights)} label="對手班次/週" w="對手" u="班" /><IN n="pax" v={count(m.total)} label="旅客/週" u="人/週" />
            {m.flown ? (m.spill >= 1 && <IN n="spill" v={count(m.spill)} label="想搭但客滿" w="客滿" tone="warn" />) : m.seats > 0 && <IN n="plus" v={`~${count(m.estimate)}`} label="每天一班約可載" w="每天一班" u="人" tone="accent" />}</span></span>
        {m.flown
          ? <span className="rival-share">{count(m.ours)}<small>你載 {pct(m.total ? m.ours / m.total : 0)}</small></span>
          : m.seats > 0
            ? <button onClick={onOpen}>開航</button>
            : <Badge n="cross" tone="muted" label="飛不了" />}
      </div>
      <div className="pot-bar">
        {m.flown ? <><i className="ours" style={{ width: w(m.ours) }} />{m.spill >= 1 && <i className="lost" style={{ width: w(m.spill) }} />}</>
          : <i className="est" style={{ width: w(Math.min(m.estimate, Math.max(m.total, m.estimate))) }} />}
        <i className="rest" style={{ width: w(rest) }} />
      </div>
    </li>
  );
}
