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

/** One route as a row: name, how often, load, profit, one status and at most one action. Tap the row for details. */
export function RouteRow({ name, sub, swatch, figures, daily, onOpen, onAdd, onRemove }: {
  name: string; sub?: string; swatch?: string; figures: RouteFigures | null | undefined; daily: number;
  onOpen: () => void; onAdd?: () => void; onRemove?: () => void;
}) {
  const h = routeHealth(figures, daily);
  const act = h.act === 'add' ? onAdd : h.act === 'remove' ? onRemove : undefined;
  return (
    <li className={`route-row ${h.key}`}>
      <button className="route-row-main" onClick={onOpen}>
        {swatch && <span className="swatch" style={{ background: swatch }} />}
        <span className="route-row-text">
          <span className="route-row-top"><strong>{name}</strong>{figures && <b className={`route-row-profit ${figures.profit < 0 ? 'bad' : 'good'}`}>{figures.profit >= 0 ? '+' : ''}{money(figures.profit)}<small>／週</small></b>}</span>
          <small className="route-row-sub">{frequencyLabel(daily)}{sub ? ` · ${sub}` : ''}</small>
          {figures && <span className="route-row-load"><Meter value={figures.loadFactor} tone={lfTone(figures.loadFactor)} label={`載客率 ${pct(figures.loadFactor)}`} /><small>載客率</small><b className={lfTone(figures.loadFactor)}>{pct(figures.loadFactor)}</b></span>}
        </span>
        <span className="chev" aria-hidden="true">›</span>
      </button>
      {h.key !== 'ok' && h.key !== 'pending' && (
        <div className="route-row-status">
          <Badge n={h.icon} tone={h.tone}>{h.label}</Badge>
          {act && <button className="route-row-act" onClick={act}><Icon n={h.act === 'add' ? 'plus' : 'seat'} /> {h.actLabel}</button>}
        </div>
      )}
    </li>
  );
}
