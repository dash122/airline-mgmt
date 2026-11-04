// The airport sheet's competition and market potential sections, and the summary tiles that lead to each section.
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlinesAt, rivalsAt, rivalsBetween } from '../sim/competitors';
import { marketSplit, type ShareRow } from '../sim/share';
import { marketPotential, type AirportPotential, type MarketPotential } from '../sim/airports';
import { pairKey } from '../sim/markets';
import type { NetworkResult, Plan } from '../sim/simulate';
import { CompactTimetable } from './CompactTimetable';
import { AirlineName } from './rivals';
import { count, pct } from './format';

export type AirportSection = 'routes' | 'rivals' | 'market' | 'transfer';

export interface Tile {
  key: AirportSection;
  label: string;
  value: string;
  sub: string;
}

/** Four tiles, the same for every airport, in the same order. Each one opens its section. */
export function AirportTiles({ tiles, on, onPick }: { tiles: Tile[]; on: AirportSection; onPick: (s: AirportSection) => void }) {
  return (
    <div className="ap-tiles" role="tablist">
      {tiles.map((t) => (
        <button key={t.key} role="tab" aria-selected={on === t.key} className={on === t.key ? 'on' : ''} onClick={() => onPick(t.key)}>
          <span className="label">{t.label}</span>
          <span className="value">{t.value}</span>
          <small>{t.sub}</small>
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
    return { to, flown: !!r, split: marketSplit(code, to, r) };
  }), [dests, shown, result, code]);
  const ourFlights = Object.values(result?.routes ?? {}).filter((r) => r.a === code || r.b === code).reduce((s, r) => s + r.flightsPerWeek / 2, 0);
  const rivalFlights = carriers.reduce((s, c) => s + c.flights, 0);
  if (!dests.length) return <div className="hint center">沒有航空在這裡飛，也還沒有你的航班。你會是第一家。</div>;
  return (
    <>
      <div className="vs-head">
        <div><b>{count(ourFlights)}</b><small>你的出發班次/週</small></div>
        <span>vs</span>
        <div><b>{count(rivalFlights)}</b><small>{carriers.length} 家對手的出發班次/週</small></div>
      </div>
      <div className="share-track" role="img" aria-label={`你 ${count(ourFlights)} 班，對手 ${count(rivalFlights)} 班`}>
        <div style={{ width: `${(100 * ourFlights) / Math.max(1, ourFlights + rivalFlights)}%`, background: OWN }} />
        {carriers.map((c) => <div key={c.airline.id} style={{ width: `${(100 * c.flights) / Math.max(1, ourFlights + rivalFlights)}%`, background: c.airline.color }} />)}
      </div>
      <h4>每條航線：你和對手（每週，雙向）</h4>
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
                  <small>{flown ? `你 ${count(own?.freq ?? 0)} 班 · ` : ''}{rivals.length ? `對手 ${rivals.length} 家 ${count(rf)} 班` : '沒有對手直飛'} · {count(split.total)} 人</small></span>
                <span className="rival-share">{flown ? pct(own?.share ?? 0) : '—'}<small>{flown ? '你的市占' : '未開航'}</small></span>
              </div>
              <div className="share-track thin">
                {split.rows.map((x) => <div key={x.id} style={{ width: `${100 * x.share}%`, background: rowColor(x) }} />)}
                {split.ownTurnedAway >= 1 && <div className="lost" style={{ width: `${(100 * split.ownTurnedAway) / Math.max(1, split.total)}%` }} />}
              </div>
              <small className="vs-who">{rivals.slice(0, 3).map((x) => `${x.airline?.name ?? x.id} ${pct(x.share)}`).join(' · ')}{rivals.length > 3 ? ` · 另 ${rivals.length - 3} 家` : ''}</small>
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
      {dests.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, dests.length - shown)} 條（共 {dests.length}）</button>}
      <div className="hint"><span className="k" style={{ color: OWN }}>■</span> 你 <span className="k spill">■</span> 想搭你但客滿；其他顏色是各家對手。你飛的航線點了開航線；沒飛的點了看對手班表。對手的班表和票價固定，不會因為你而改變。</div>
      <h4>在這裡飛的航空公司</h4>
      <ul className="competitor-list">
        {carriers.map((c) => (
          <li key={c.airline.id} className="carrier">
            <span className="name"><AirlineName airline={c.airline} /><small>{c.destinations} 個航點{c.airline.bases[0] === code ? ' · 主要樞紐' : c.airline.bases.includes(code) ? ' · 基地' : ''}</small></span>
            <span className="rival-share">{count(c.flights)}<small>班／週</small></span>
          </li>
        ))}
      </ul>
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
      <h4>市場：可拿的旅客 vs 你載的（每週，雙向）</h4>
      <ul className="pot-list">
        {pot.rows.slice(0, shown).map((m) => <PotentialRow key={m.to} m={m} max={Math.max(1, ...pot.rows.map(size))} onOpen={() => onOpen(m.to)} onOpenRoute={() => onOpenRoute(m.key)} />)}
      </ul>
      {pot.rows.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, pot.rows.length - shown)} 個（共 {pot.rows.length}）</button>}
      <div className="hint"><span className="k" style={{ color: OWN }}>■</span> 你載的 <span className="k spill">■</span> 客滿沒搭到 <span className="k est">■</span> 每天一班約可拿 <span className="k rest">■</span> 其他航空、轉機。沒飛的市場用和模擬一樣的算法估計：每天一班來回、平均時段、你的票價，未扣座位上限。</div>
    </>
  );
}

const size = (m: MarketPotential) => Math.max(m.total, m.ours + m.spill, m.estimate);

function PotentialHead({ pot }: { pot: AirportPotential }) {
  const share = pot.total > 0 ? pot.ours / pot.total : 0;
  return (
    <div className="pot-head">
      <div className="pot-nums">
        <div><b>{count(pot.total)}</b><small>人/週在這裡搭飛機往返</small></div>
        <div><b className="acc">{count(pot.ours)}</b><small>搭你的直飛（{pct(share)}）</small></div>
        {pot.transfer >= 1 && <div><b>{count(pot.transfer)}</b><small>在這裡轉你的航班</small></div>}
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
          <small>{count(m.distKm)} 公里 · {m.rivalFlights ? `對手 ${count(m.rivalFlights)} 班` : '沒有對手直飛'} · 市場 {count(m.total)} 人</small></span>
        {m.flown
          ? <span className="rival-share">{count(m.ours)}<small>你載 {pct(m.total ? m.ours / m.total : 0)}</small></span>
          : m.seats > 0
            ? <button onClick={onOpen}>開航</button>
            : <span className="tag">飛不了</span>}
      </div>
      <div className="pot-bar">
        {m.flown ? <><i className="ours" style={{ width: w(m.ours) }} />{m.spill >= 1 && <i className="lost" style={{ width: w(m.spill) }} />}</>
          : <i className="est" style={{ width: w(Math.min(m.estimate, Math.max(m.total, m.estimate))) }} />}
        <i className="rest" style={{ width: w(rest) }} />
      </div>
      <small className="vs-who">
        {m.flown
          ? (m.spill >= 1 ? `另有 ${count(m.spill)} 人想搭你但客滿` : '你在飛')
          : m.seats > 0 ? `每天一班約可拿 ${count(m.estimate)} 人 · 每天一班可載 ${count(m.seats)}` : '跑道或航程不夠，沒有機型能飛'}
      </small>
    </li>
  );
}
