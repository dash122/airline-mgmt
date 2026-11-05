// Tap a number to see why it is what it is: a plain sentence, the few numbers behind it, and what to try.
import { PAX_COST_PER_SEGMENT, SALES_COST_SHARE, type RouteResult } from '../sim/simulate';
import type { MarketSplit } from '../sim/share';
import { count, money, pct } from './format';

export type ExplainKey = 'lf' | 'spill' | 'share' | 'profit';

export interface ExplainRow {
  label: string;
  value: string;
  /** A total line (drawn with a rule above it). */
  total?: boolean;
  tone?: 'good' | 'bad' | 'warn';
}

export interface Explanation {
  title: string;
  /** One or two plain sentences: what the number means and why it is this high or low. */
  why: string;
  rows: ExplainRow[];
  /** What to try next, if anything. */
  tip?: string;
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${money(n)}`;

/** Travellers the route needs each week to cover its flying costs (not the lease), and that as a share of seats. */
export function breakEven(r: RouteResult): { pax: number; loadFactor: number } | null {
  if (r.pax < 1 || r.seats < 1) return null;
  const perPax = r.revenue / r.pax * (1 - SALES_COST_SHARE) - PAX_COST_PER_SEGMENT;
  if (perPax <= 0) return null;
  const pax = (r.money.blockCost + r.money.departureCost) / perPax;
  return { pax, loadFactor: pax / r.seats };
}

export function explainRoute(key: ExplainKey, r: RouteResult, split: MarketSplit): Explanation {
  const connecting = r.pax - r.localPax;
  const empty = Math.max(0, r.seats - r.pax);
  const seatsPerFlight = r.flightsPerWeek ? r.seats / r.flightsPerWeek : 0;
  switch (key) {
    case 'lf': {
      const why = r.loadFactor >= 0.97 && r.spill > 1
        ? `座位全賣光了：每週 ${count(r.seats)} 個座位，想搭的人有 ${count(r.demand)}。`
        : r.loadFactor >= 0.8
          ? `每週 ${count(r.seats)} 個座位坐了 ${count(r.pax)} 人，很滿。`
          : `每週 ${count(r.seats)} 個座位只坐了 ${count(r.pax)} 人，空了 ${count(empty)} 個。想搭的人比你提供的座位少。`;
      return {
        title: `載客率 ${pct(r.loadFactor)}`,
        why: `載客率是坐了人的座位比例。${why}`,
        rows: [
          { label: '座位', value: `${count(r.flightsPerWeek)} 班 × ${count(seatsPerFlight)} 座 = ${count(r.seats)}` },
          { label: '本地旅客（只飛這段）', value: count(r.localPax) },
          { label: '轉機旅客（接你的其他航班）', value: count(connecting) },
          { label: '空位', value: count(empty), tone: empty > r.seats * 0.4 ? 'bad' : undefined },
          { label: '載客率', value: `${count(r.pax)} ÷ ${count(r.seats)} = ${pct(r.loadFactor)}`, total: true },
        ],
        tip: r.loadFactor >= 0.97 && r.spill > 1 ? '想多載人：加班次或換大一點的飛機。也可以先漲價，載客率不會掉。'
          : r.loadFactor < 0.6 ? '想坐滿一點：減一班、換小飛機、降一點票價，或接上轉機旅客。' : undefined,
      };
    }
    case 'spill': {
      const why = r.spill > 1
        ? `每週有 ${count(r.spill)} 人想搭你的航班，但那班已經客滿。他們沒搭到，不付錢，也不算在載客裡。${r.fullFlights >= r.flightsPerWeek - 0.5 ? '每一班都客滿。' : `每週 ${count(r.flightsPerWeek)} 班裡有 ${count(r.fullFlights)} 班客滿，其他班還有空位。`}`
        : '沒有人因為客滿而買不到位子：每一班都還有空位。';
      return {
        title: `溢出 ${count(r.spill)} 人`,
        why: `溢出是想搭卻買不到位子的旅客。${why}`,
        rows: [
          { label: '想搭你的航班', value: count(r.demand) },
          { label: '座位', value: count(r.seats) },
          { label: '坐到位子', value: count(r.pax) },
          { label: '客滿的航班', value: `${count(r.fullFlights)} / ${count(r.flightsPerWeek)} 班` },
          { label: '溢出', value: `${count(r.demand)} − ${count(r.pax)} = ${count(r.spill)}`, total: true, tone: r.spill > 1 ? 'warn' : undefined },
        ],
        tip: r.spill > 1
          ? (r.fullFlights >= r.flightsPerWeek - 0.5
            ? '客滿時降價只會少賺。漲價會先減少溢出，載客率不變；或加班次、換大飛機，把這些人載走。'
            : '只有熱門時段客滿：在那個時段加一班或換大飛機，降價幫不上忙。')
          : undefined,
      };
    }
    case 'share': {
      const own = split.rows.find((x) => x.kind === 'own');
      const rivals = split.rows.filter((x) => x.kind === 'rival');
      const rivalFlights = rivals.reduce((s, x) => s + x.freq, 0);
      const rivalFare = rivalFlights ? rivals.reduce((s, x) => s + (x.fare ?? 0) * x.freq, 0) / rivalFlights : 0;
      const reasons: string[] = [];
      if (rivals.length === 0) reasons.push('沒有其他航空直飛，你的對手是轉機或其他交通方式。');
      else {
        reasons.push(`你的班次占全部直飛的 ${pct(split.ownFreqShare)}。`);
        if (rivalFare && r.fare > rivalFare * 1.03) reasons.push(`你的票價（NT$${count(r.fare)}）比對手平均（NT$${count(rivalFare)}）貴，所以市占比班次比例低。`);
        else if (rivalFare && r.fare < rivalFare * 0.97) reasons.push(`你的票價（NT$${count(r.fare)}）比對手平均（NT$${count(rivalFare)}）便宜，幫你多拿一些旅客。`);
        if (split.ownTurnedAway >= 1) reasons.push(`另有 ${count(split.ownTurnedAway)} 人選了你但航班客滿，不算在市占裡。`);
      }
      const top = [...rivals].sort((x, y) => y.pax - x.pax).slice(0, 3);
      return {
        title: `市占 ${pct(r.marketShare)}`,
        why: `這個市場每週有 ${count(r.airTotal)} 人搭飛機（雙向），你載了 ${count(r.localPax)} 人。旅客依班次多寡、起飛時段、票價和服務來選航空。${reasons.join('')}`,
        rows: [
          { label: '你的班次 / 全部直飛', value: `${count(r.flightsPerWeek)} / ${count(r.flightsPerWeek + rivalFlights)} 班` },
          ...(rivalFare ? [{ label: '你的票價 / 對手平均', value: `NT$${count(r.fare)} / NT$${count(rivalFare)}` }] : []),
          ...top.map((x) => ({ label: x.airline?.name ?? x.id, value: `${pct(x.share)} · ${count(x.pax)} 人` })),
          ...(split.rows.some((x) => x.kind === 'connecting' || x.kind === 'rivalVia')
            ? [{ label: '轉機（其他航空）', value: count(split.rows.filter((x) => x.kind === 'connecting' || x.kind === 'rivalVia').reduce((s, x) => s + x.pax, 0)) }] : []),
          { label: '你', value: `${count(own?.pax ?? 0)} ÷ ${count(r.airTotal)} = ${pct(r.marketShare)}`, total: true },
        ],
        tip: rivals.length ? '想多拿市占：加班次、排在早上或傍晚的熱門時段，或降一點票價。對手不會因為你而改變。' : undefined,
      };
    }
    case 'profit': {
      const profit = r.revenue - r.flyingCost;
      const be = breakEven(r);
      const m = r.money;
      const costs = [
        { label: '飛行成本（燃油、組員、維修）', v: m.blockCost },
        { label: '起降與導航費', v: m.departureCost },
        { label: `旅客服務（每人 NT$${PAX_COST_PER_SEGMENT}）`, v: m.paxCost },
        { label: `銷售手續費（票價 ${pct(SALES_COST_SHARE)}）`, v: m.salesCost },
      ];
      const biggest = [...costs].sort((x, y) => y.v - x.v)[0];
      const why = be
        ? profit >= 0
          ? `收入比飛行成本多 ${money(profit)}。載客率 ${pct(be.loadFactor)} 就打平，你現在是 ${pct(r.loadFactor)}。`
          : be.loadFactor <= 1
            ? `收入不夠付飛行成本。以現在的票價，載客率要到 ${pct(be.loadFactor)} 才打平，你現在是 ${pct(r.loadFactor)}。`
            : '收入不夠付飛行成本：就算每個座位都坐滿，現在的票價也付不起這架飛機飛這條線。'
        : '還沒有旅客，只有成本。';
      return {
        title: `週航段損益 ${signed(profit)}`,
        why: `${why}最大的支出是${biggest.label.replace(/（.*）/, '')}。這裡不含飛機租金，租金在「機隊」看。`,
        rows: [
          { label: '本地旅客票價', value: money(m.localRevenue) },
          { label: '轉機旅客票價（按距離分攤）', value: money(m.connectingRevenue) },
          ...costs.map((c) => ({ label: c.label, value: `−${money(c.v)}` })),
          { label: '週航段損益', value: signed(profit), total: true, tone: profit >= 0 ? 'good' as const : 'bad' as const },
        ],
        tip: profit < 0
          ? (be && be.loadFactor > 1 ? '換小一點、省油的飛機，或漲價。' : r.spill > 1 ? '已經客滿：漲價或換大飛機。' : '多載人（降價、好時段、接轉機），或減班、換小飛機。')
          : undefined,
      };
    }
  }
}

/** The explanation card under a row of tappable numbers. */
export function ExplainCard({ e, onClose }: { e: Explanation; onClose: () => void }) {
  return (
    <div className="explain" role="region" aria-label={e.title}>
      <div className="explain-head"><b>{e.title}</b><button className="close sm" onClick={onClose} aria-label="收起">✕</button></div>
      <p>{e.why}</p>
      <dl>
        {e.rows.map((row, i) => (
          <div key={i} className={`${row.total ? 'total' : ''} ${row.tone ?? ''}`}>
            <dt>{row.label}</dt><dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {e.tip && <p className="tip">{e.tip}</p>}
    </div>
  );
}
