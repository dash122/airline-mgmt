import { useState } from 'react';
import { localMinutes, hhmm, type FlightResult, type Plan } from '../sim/simulate';
import { count, money, pct } from './format';
import { Head } from './sheets';
import { Badge, IN } from './viz';

export const lfTone = (lf: number) => (lf >= 0.8 ? 'good' : lf < 0.6 ? 'bad' : 'warn');

/** A flight's load factor as a small coloured pill, with 客滿 when it turned travellers away. */
export function LoadPill({ f }: { f: FlightResult }) {
  const full = f.spill > 0.5;
  return <span className={`pill ${full ? 'warn' : lfTone(f.loadFactor)}`} title={`載客 ${count(f.pax)} / ${f.seats} 座`}>
    {full ? '客滿' : pct(f.loadFactor)}
  </span>;
}

/** One line on a flight's load: carried / seats, connecting, spill. */
export const loadLine = (f: FlightResult) =>
  `載客 ${count(f.pax)}/${f.seats}${f.connectingPax >= 0.5 ? ` · 轉機 ${count(f.connectingPax)}` : ''}${f.spill > 0.5 ? ` · 溢出 ${count(f.spill)}` : ''}`;

/** A flight's load as icons: travellers/seats, connecting, spill. */
export function LoadIcons({ f }: { f: FlightResult }) {
  return <span className="ins">
    <IN n="pax" v={`${count(f.pax)}/${f.seats}`} label="載客/座位" w="載客" />
    {f.spill > 0.5 && <IN n="spill" v={count(f.spill)} label="溢出" w="溢出" tone="warn" />}
  </span>;
}

type Sort = 'time' | 'lf';

/** Load factor of every departure on a route, split by direction. Tap a flight to adjust it. */
export function FlightLoads({ a, b, flights, plan, onEdit }: {
  a: string; b: string; flights: FlightResult[]; plan: Plan; onEdit?: (acId: string, leg: number) => void;
}) {
  const [sort, setSort] = useState<Sort>('time');
  if (!flights.length) return null;
  // Name the aircraft only when more than one flies the route.
  const many = new Set(flights.map((f) => f.acId)).size > 1;
  const reg = (id: string) => (many ? ` · ${plan.fleet.find((x) => x.id === id)?.reg ?? ''}` : '');
  const order = (list: FlightResult[]) => [...list].sort((x, y) => sort === 'lf'
    ? y.loadFactor - x.loadFactor || y.spill - x.spill
    : localMinutes(x.from, x.dep) - localMinutes(y.from, y.dep));
  const full = flights.filter((f) => f.spill > 0.5).length;
  const empty = flights.filter((f) => f.loadFactor < 0.6).length;
  return <section className="flight-loads" aria-label="每班載客率">
    <Head info={<p>當地出發時間。損益是每次出發的票價收入減飛行成本，不含租金。客滿的時段可加班或換大飛機；空的時段可移到熱門時間或取消。點航班可調整。</p>}
      right={<div className="seg two small" aria-label="排序">
        <button className={sort === 'time' ? 'on' : ''} onClick={() => setSort('time')}>時間</button>
        <button className={sort === 'lf' ? 'on' : ''} onClick={() => setSort('lf')}>載客率</button>
      </div>}>
      每班載客率
    </Head>
    {flights.length > 1 && (full || empty) && <div className="ins">
      {full > 0 && <Badge n="spill" tone="warn">{full} 班客滿</Badge>}
      {empty > 0 && <Badge n="seat" tone="bad">{empty} 班不到六成</Badge>}
    </div>}
    {[[a, b], [b, a]].map(([from, to]) => {
      const list = order(flights.filter((f) => f.from === from));
      if (!list.length) return null;
      return <div key={from} className="flight-loads-dir">
        <div className="flight-loads-dirname">{from} → {to}</div>
        <ul className="flight-load-list">
          {list.map((f) => {
            const profit = f.revenue - f.cost;
            const body = <>
              <time>{hhmm(localMinutes(f.from, f.dep))}</time>
              <span className="flight-load-mid">
                <span className="flight-load-bar" aria-hidden="true">
                  <i className={lfTone(f.loadFactor)} style={{ width: `${Math.min(100, 100 * f.loadFactor)}%` }} />
                </span>
                <small><LoadIcons f={f} />{reg(f.acId)}{f.perWeek < 7 ? ` · ${+f.perWeek.toFixed(1)}/週` : ''}</small>
              </span>
              <span className="flight-load-right">
                <b className={`num ${lfTone(f.loadFactor)}`}>{pct(f.loadFactor)}</b>
                <small className={profit >= 0 ? 'good' : 'bad'}>{profit >= 0 ? '+' : ''}{money(profit)}/班</small>
              </span>
            </>;
            return <li key={f.key}>
              {onEdit
                ? <button className="flight-load-row" onClick={() => onEdit(f.acId, f.index)}
                    aria-label={`${hhmm(localMinutes(f.from, f.dep))} ${from} 到 ${to}，載客率 ${pct(f.loadFactor)}，${loadLine(f)}，點選調整`}>{body}</button>
                : <div className="flight-load-row">{body}</div>}
            </li>;
          })}
        </ul>
      </div>;
    })}
  </section>;
}
