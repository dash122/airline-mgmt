import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Badge, Icon, Meter, type IconName } from './viz';
import { money, pct } from './format';

/** What a route needs right now, in one word, plus the single action that helps most. */
export type Health = {
  key: 'full' | 'loss' | 'empty' | 'ok' | 'pending';
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'accent' | 'muted';
  icon: IconName;
  /** The one quick action that helps most, if any. */
  act?: 'add' | 'remove';
  actLabel?: string;
};

export type RouteFigures = { loadFactor: number; spill: number; profit: number };

export function routeHealth(r: RouteFigures | null | undefined, daily: number): Health {
  if (!r) return { key: 'pending', label: '計算中', tone: 'muted', icon: 'clock' };
  if (r.spill > 1 && r.loadFactor >= 0.97) return { key: 'full', label: '客滿', tone: 'accent', icon: 'spill', act: 'add', actLabel: '加一班' };
  if (r.profit < 0) return { key: 'loss', label: '虧損', tone: 'bad', icon: 'down', ...(r.loadFactor < 0.6 && daily > 1 ? { act: 'remove' as const, actLabel: '減一班' } : {}) };
  if (r.loadFactor < 0.5) return { key: 'empty', label: '空位多', tone: 'warn', icon: 'seat', ...(daily > 1 ? { act: 'remove' as const, actLabel: '減一班' } : {}) };
  return { key: 'ok', label: '穩定', tone: 'good', icon: 'check' };
}

/** Sort order: routes that need something first, then by profit. */
export const healthRank = (h: Health) => ({ full: 0, loss: 1, empty: 2, ok: 3, pending: 4 })[h.key];

/** "每日 2 班" / "每 2 日 1 班": round trips in words, never a bare 0.5. */
export function frequencyLabel(roundTripsPerDay: number) {
  if (roundTripsPerDay <= 0) return '未排班';
  if (roundTripsPerDay >= 1) return `每日 ${Number.isInteger(roundTripsPerDay) ? roundTripsPerDay : roundTripsPerDay.toFixed(1)} 班來回`;
  return `每 ${Math.round(1 / roundTripsPerDay)} 日 1 班來回`;
}

const lfTone = (lf: number) => (lf >= 0.8 ? 'good' : lf >= 0.6 ? 'warn' : 'bad');

/** How far a row must travel before a swipe counts as a decision. */
const SWIPE_COMMIT = 88;

/**
 * One route as a row: name, how often, load, profit and one status. Tap for details.
 * Swipe right to add a daily round trip, left to remove one; the colour behind the row says which.
 */
export function RouteRow({ name, sub, swatch, figures, daily, onOpen, onAdd, onRemove }: {
  name: string; sub?: string; swatch?: string; figures: RouteFigures | null | undefined; daily: number;
  onOpen: () => void; onAdd?: () => void; onRemove?: () => void;
}) {
  const h = routeHealth(figures, daily);
  const status = h.key !== 'ok' && h.key !== 'pending';
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; axis: 'x' | 'y' | null; id: number } | null>(null);
  const swiped = useRef(false);
  const canAdd = !!onAdd, canRemove = !!onRemove && daily >= 1;
  const onDown = (e: RPointerEvent) => { if (e.button) return; drag.current = { x: e.clientX, y: e.clientY, axis: null, id: e.pointerId }; swiped.current = false; };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    if (!d.axis && Math.hypot(mx, my) > 8) {
      d.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (d.axis === 'x') (e.currentTarget as HTMLElement).setPointerCapture(d.id);
    }
    if (d.axis !== 'x') return;
    swiped.current = true;
    const v = mx > 0 ? (canAdd ? mx : 0) : (canRemove ? mx : 0);
    // Past the commit point the row resists, so it is clear the action is armed.
    setDx(Math.abs(v) > SWIPE_COMMIT ? Math.sign(v) * (SWIPE_COMMIT + (Math.abs(v) - SWIPE_COMMIT) * 0.3) : v);
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (d?.axis === 'x') {
      if (dx >= SWIPE_COMMIT && onAdd) onAdd();
      else if (dx <= -SWIPE_COMMIT && onRemove) onRemove();
    }
    setDx(0);
  };
  const armed = Math.abs(dx) >= SWIPE_COMMIT;
  return (
    <li className={`route-row ${h.key}${dx ? ' swiping' : ''}${armed ? ' armed' : ''}`}>
      {(canAdd || canRemove) && <div className={`route-row-under ${dx > 0 ? 'add' : dx < 0 ? 'remove' : ''}`} aria-hidden="true">
        <span className="u-add"><Icon n="plus" /> 加一班</span>
        <span className="u-remove">減一班 <Icon n="seat" /></span>
      </div>}
      <button className="route-row-main" style={dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setDx(0); }}
        onClick={() => { if (swiped.current) { swiped.current = false; return; } onOpen(); }}>
        {swatch && <span className="swatch" style={{ background: swatch }} />}
        <span className="route-row-text">
          <span className="route-row-top"><strong>{name}</strong>{figures && <b className={`route-row-profit ${figures.profit < 0 ? 'bad' : 'good'}`}>{figures.profit >= 0 ? '+' : ''}{money(figures.profit)}<small>／週</small></b>}</span>
          <span className="route-row-meta">
            {status && <Badge n={h.icon} tone={h.tone}>{h.label}</Badge>}
            {figures && <span className="route-row-load"><Meter value={figures.loadFactor} tone={lfTone(figures.loadFactor)} label={`載客率 ${pct(figures.loadFactor)}`} /><b className={lfTone(figures.loadFactor)}>{pct(figures.loadFactor)}</b></span>}
            <small className="route-row-sub">{frequencyLabel(daily)}{sub ? ` · ${sub}` : ''}</small>
          </span>
        </span>
        <span className="chev" aria-hidden="true">›</span>
      </button>
      {canAdd && <button className="sr-only" onClick={onAdd}>{name} 加一班來回</button>}
      {canRemove && <button className="sr-only" onClick={onRemove}>{name} 減一班來回</button>}
    </li>
  );
}
