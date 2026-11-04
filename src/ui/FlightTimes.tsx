import { dayShiftBetween } from '../sim/airports';
import { hhmm, localMinutes } from '../sim/simulate';

/** Each endpoint uses its own airport clock; date shifts are relative to departure. */
export function FlightTimes({ from, to, dep, arr }: { from: string; to: string; dep: number; arr: number }) {
  const shift = dayShiftBetween(from, to, dep, arr);
  const duration = Math.round(arr - dep);
  return (
    <span className="flight-times">
      <span className="flight-end"><small>{from} 出發</small><strong>{hhmm(localMinutes(from, dep))}</strong></span>
      <span className="flight-duration"><small>{Math.floor(duration / 60)} 小時 {duration % 60} 分</small><span aria-hidden="true">→</span></span>
      <span className="flight-end"><small>{to} 抵達</small><strong>{hhmm(localMinutes(to, arr))}{shift !== 0 && <sup className="flight-date" title={`抵達日期比出發日期${shift > 0 ? '晚' : '早'} ${Math.abs(shift)} 天`}>{shift > 0 ? '+' : ''}{shift} 天</sup>}</strong></span>
    </span>
  );
}
