import { useState } from 'react';
import { AIRCRAFT } from '../data/aircraft';
import { dayShiftBetween } from '../sim/airports';
import type { RivalService } from '../sim/competitors';
import { marketBetween, pairKey } from '../sim/markets';
import { blockMinutes, flightsOn, hhmm, localMinutes, utcFromLocal, type FlightResult, type Plan } from '../sim/simulate';
import { loadLine, LoadPill } from './FlightLoads';
import { count } from './format';

export function CarrierMark({ name, color, own = false }: { name: string; color?: string; own?: boolean }) {
  return <span className={`carrier-mark${own ? ' own' : ''}`} style={{ borderColor: color }} aria-hidden="true">{own ? '自家' : [...name].slice(0, 2).join('')}</span>;
}

type Row = {
  id: string; carrier: string; name: string; color?: string; dep: number; arr: number;
  type: string; freq: number; fare?: number; reg?: string; edit?: () => void; load?: FlightResult;
};

/** A repeating timetable: sort by the departure airport's local clock, not raw UTC. */
export function chronological<T extends { dep: number; id: string }>(rows: T[], from: string): T[] {
  return [...rows].sort((a, b) => localMinutes(from, a.dep) - localMinutes(from, b.dep) || a.id.localeCompare(b.id));
}

export function CompactTimetable({ from, to, services, plan, loads, onEdit }: {
  from: string; to: string; services: RivalService[]; plan?: Plan; loads?: FlightResult[]; onEdit?: (ac: string, leg: number) => void;
}) {
  const [mode, setMode] = useState<'own' | 'all' | 'select'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const carriers = [...new Map(services.map((s) => [s.airline.id, s.airline])).values()];
  const rows: Row[] = services.flatMap((s) => s.times.map((time, index) => {
    const dep = utcFromLocal(s.from, time);
    return { id: s.airline.id + '-' + index, carrier: s.airline.id, name: s.airline.name, color: s.airline.color,
      dep, arr: dep + blockMinutes(s.from, s.to, s.type), type: AIRCRAFT[s.type].name, freq: s.freq, fare: s.fare };
  }));
  if (plan) {
    for (const { ac, index, leg } of flightsOn(plan, pairKey(from, to)).filter((f) => f.leg.from === from)) {
      rows.push({ id: ac.id + '-' + index, carrier: 'own', name: '你的航空', dep: leg.dep,
        arr: leg.dep + blockMinutes(from, to, ac.type), type: AIRCRAFT[ac.type].name, freq: 7, reg: ac.reg, fare: (marketBetween(from, to)?.refFare ?? 0) * (plan.fares[pairKey(from, to)] ?? 1),
        edit: onEdit ? () => onEdit(ac.id, index) : undefined, load: loads?.find((f) => f.acId === ac.id && f.index === index) });
    }
  }
  const visible = chronological(rows.filter((r) => mode === 'all' || (mode === 'own' ? r.carrier === 'own' : selected.includes(r.carrier))), from);
  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  return <div className="compact-schedule">
    <div className="schedule-filters" role="group" aria-label="顯示航空公司">
      {plan && <button aria-pressed={mode === 'own'} onClick={() => setMode('own')}>自家</button>}
      <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>全部</button>
      <button aria-pressed={mode === 'select'} onClick={() => { if (mode !== 'select' && !selected.length) setSelected([...(plan ? ['own'] : []), ...carriers.map((c) => c.id)]); setMode('select'); }}>自選</button>
    </div>
    {mode === 'select' && <fieldset className="carrier-picker"><legend>選擇要比較的航空</legend>
      {plan && <label><input type="checkbox" checked={selected.includes('own')} onChange={() => toggle('own')} /><CarrierMark name="你的航空" own />你的航空</label>}
      {carriers.map((c) => <label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /><CarrierMark name={c.name} color={c.color} />{c.name}</label>)}
    </fieldset>}
    <div className="schedule-caption"><span>{visible.length} 班</span></div>
    <div className="compact-columns" aria-hidden="true"><span>航空</span><span>{from} 出發</span><span>{to} 抵達</span><span>飛行</span></div>
    <ul className="compact-flights">
      {visible.map((r) => {
        const shift = dayShiftBetween(from, to, r.dep, r.arr);
        const duration = Math.round(r.arr - r.dep);
        return <li key={r.id}><details className="compact-flight">
          <summary aria-label={`${r.name}，${from} ${hhmm(localMinutes(from, r.dep))} 出發，${to} ${hhmm(localMinutes(to, r.arr))} 抵達${shift ? '，日期差 ' + shift + ' 天' : ''}`}>
            <CarrierMark name={r.name} color={r.color} own={r.carrier === 'own'} />
            <time>{hhmm(localMinutes(from, r.dep))}</time>
            <span className="compact-arrival"><time>{hhmm(localMinutes(to, r.arr))}</time>{shift !== 0 && <sup>{shift > 0 ? '+' : ''}{shift}</sup>}</span>
            <span className="compact-duration">{Math.floor(duration / 60)}h{String(duration % 60).padStart(2, '0')}{r.load && <><br /><LoadPill f={r.load} /></>}</span>
          </summary>
          <div className="compact-flight-detail"><b>{r.name}</b><span>{r.type}{r.reg ? ' · ' + r.reg : ''}{r.fare !== undefined ? ' · NT$' + count(r.fare) : ''}</span>
            <span>{r.carrier === 'own' ? '每日營運' : `此方向每週 ${r.freq} 班`}{r.freq < 7 ? ' · 未指定營運星期' : ''}{shift !== 0 ? ` · 抵達日期差 ${shift > 0 ? '+' : ''}${shift} 天` : ''}</span>
            {r.load && <span>載客率 {Math.round(r.load.loadFactor * 100)}% · {loadLine(r.load)}</span>}
            {r.edit && <button onClick={r.edit}>調整這班航班</button>}
          </div>
        </details></li>;
      })}
    </ul>
    {!visible.length && <p className="schedule-empty">沒有符合篩選的航班</p>}
    {visible.some((r) => dayShiftBetween(from, to, r.dep, r.arr)) && <p className="schedule-footnote">+1 隔天抵達 · −1 前一天抵達</p>}
  </div>;
}
