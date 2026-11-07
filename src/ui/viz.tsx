// Small pictures for numbers: a ring for a share, a sparkline for a trend, a bar that grows left for a loss.
// Each keeps its number next to it, so colour is never the only cue.
import type { ReactNode } from 'react';

export type Tone = 'good' | 'warn' | 'bad' | 'accent' | 'muted';
const toneVar = (t: Tone) => `var(--${t === 'accent' ? 'accent' : t === 'muted' ? 'muted' : t})`;

/** A ring filled to `value` (0–1). The label sits in the middle when there is room. */
export function Ring({ value, tone = 'accent', size = 36, stroke = 5, children, label }: {
  value: number; tone?: Tone; size?: number; stroke?: number; children?: ReactNode; label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={toneVar(tone)} strokeWidth={stroke}
          strokeDasharray={`${c * v} ${c}`} strokeLinecap={v < 1 ? 'round' : 'butt'} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      {children != null && <span className="ring-in">{children}</span>}
    </span>
  );
}

/** A thin bar filled to `value` (0–1). */
export function Meter({ value, tone = 'accent', label }: { value: number; tone?: Tone; label?: string }) {
  return (
    <span className="meter" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: toneVar(tone) }} />
    </span>
  );
}

/**
 * A profit bar. With `split` it grows from a centre line (gains right in green, losses left in red);
 * without, from the left edge, for lists that have no losses.
 */
export function ProfitBar({ value, max, split = true }: { value: number; max: number; split?: boolean }) {
  const half = split ? 50 : 100;
  const w = max > 0 ? Math.min(half, (half * Math.abs(value)) / max) : 0;
  const zero = split ? '50%' : '0%';
  return (
    <span className={`profit-bar${split ? ' split' : ''}`} aria-hidden="true">
      <i className={value >= 0 ? 'good' : 'bad'} style={value >= 0 ? { left: zero, width: `${w}%` } : { right: '50%', width: `${w}%` }} />
    </span>
  );
}

/** A tiny line of a series with its last point marked. Above zero is green, below red. */
export function Spark({ values, width = 64, height = 20, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => 2 + ((width - 4) * i) / (values.length - 1);
  const y = (v: number) => 2 + (height - 4) * (1 - (v - lo) / span);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {lo < 0 && hi > 0 && <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />}
      <polyline points={pts} fill="none" stroke={last >= 0 ? 'var(--good)' : 'var(--bad)'} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.4} fill={last >= 0 ? 'var(--good)' : 'var(--bad)'} />
    </svg>
  );
}

/** One bar split into parts, each part's width its share of the total. */
export function Stack({ parts, label }: { parts: { value: number; color: string; key: string }[]; label?: string }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <div className="stack" role="img" aria-label={label}>
      {parts.filter((p) => p.value > 0).map((p) => <i key={p.key} style={{ width: `${(100 * p.value) / total}%`, background: p.color }} />)}
    </div>
  );
}

// ---------- Icons ----------
// One small line-icon set, so units and labels can be a picture next to a number instead of words.
// Every icon that stands in for a word carries that word as its accessible name (and a hover title).

const PATHS = {
  pax: 'M12 4.5a2.5 2.5 0 1 0 0.01 0 M6.5 20v-3.5a5.5 5.5 0 0 1 11 0V20',
  plane: 'M2.5 13.5l7.5-2 2.2-7h1.8l-.8 7 8 1.2v1.8l-8 1.1.9 3.9-1.8.9-2.9-4-6.9-1.2z',
  seat: 'M7 3.5c1.2 0 2 .8 2 2V12h7.5a1.5 1.5 0 0 1 1.5 1.5V15H7.5A2.5 2.5 0 0 1 5 12.5V5.5c0-1.2.8-2 2-2z M8 15l-1.5 5 M16 15l1.5 5',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0.01 0 M12 7.5V12l3 2',
  money: 'M12 3.5a8.5 8.5 0 1 0 0.01 0 M14.5 9c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.5-2.6-1.5 M12 6v1.5 M12 16.5V18',
  transfer: 'M4 8h13l-3-3 M20 16H7l3 3',
  spill: 'M5 9h14l-1.5 11h-11z M8 9c0-3 1.5-5 4-5s4 2 4 5 M12 4V2 M16.5 5.5l1.5-1.5 M7.5 5.5L6 4',
  share: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z M14.5 2.5v7h7a7 7 0 0 0-7-7z',
  rival: 'M5 21V4 M5 4h11l-2 4 2 4H5',
  hub: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z',
  base: 'M3.5 11L12 4l8.5 7 M6 9.5V20h12V9.5',
  route: 'M5 18c4-10 10-10 14-12 M5 18a2 2 0 1 0 0.01 0 M19 6a2 2 0 1 0 0.01 0',
  market: 'M12 3.5a8.5 8.5 0 1 0 0.01 0 M3.5 12h17 M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  cross: 'M6 6l12 12 M18 6L6 18',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17v.5',
  bed: 'M3 18V7 M3 14h18v4 M21 14v-2a3 3 0 0 0-3-3h-7v5 M6.5 11.5a1.5 1.5 0 1 0 0.01 0',
  up: 'M3 19h18 M5 15l14-7 M15 6l4 2-2 4',
  down: 'M3 19h18 M5 6l14 8 M15 15.5l4-1.5-1-4',
  fast: 'M13 3L5 13h6l-1 8 8-10h-6z',
  fare: 'M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z M14 7v12',
  wrench: 'M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4 7.6 20l6.3-6.3A4.5 4.5 0 0 0 20 9.5l-2.7 2.7-3-1-1-3L16 5.5a4.5 4.5 0 0 0-1.5-1.5z',
  plus: 'M12 5v14 M5 12h14',
  lease: 'M7 14a3.5 3.5 0 1 0 0.01 0 M9.5 11.5L19 2 M15 6l3 3 M13 8l2 2',
  util: 'M4 18a8 8 0 1 1 16 0 M12 18l4-6',
  detour: 'M4 18c0-8 6-12 8-6s8 2 8-6 M18 4l2 2 2-2',
  long: 'M3 12h18 M3 8v8 M21 8v8',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3.5V7 M16 3.5V7',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
} as const;
export type IconName = keyof typeof PATHS;

/** A line icon at the text size. Give `label` when the icon replaces a word. */
export function Icon({ n, label, size }: { n: IconName; label?: string; size?: number }) {
  const solid = n === 'plane' || n === 'hub';
  return (
    <svg className={`ico ico-${n}`} viewBox="0 0 24 24" width={size ?? '1.05em'} height={size ?? '1.05em'}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {label && <title>{label}</title>}
      <path d={PATHS[n]} fill={solid ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={solid ? 0.6 : 1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A number with a small icon and a short word: "👤 1,234 人/週", "利用率 50%→65%". The icon helps the eye find the
 * kind of number; the word `w` (before) and unit `u` (after) say what it is. `label` is the full name for hover.
 */
export function IN({ n, v, label, tone, strong, w, u }: { n: IconName; v: ReactNode; label: string; tone?: Tone; strong?: boolean; w?: string; u?: string }) {
  return (
    <span className={`in${tone ? ` ${tone}` : ''}${strong ? ' strong' : ''}`} title={label}>
      <Icon n={n} />{w && <span className="in-w">{w}</span>}<span className="in-v">{v}</span>{u && <span className="in-u">{u}</span>}
    </span>
  );
}

/** A small coloured badge: an icon and a few characters, for a state ("full", "17h wait", "no link"). */
export function Badge({ n, children, tone = 'muted', label }: { n?: IconName; children?: ReactNode; tone?: Tone; label?: string }) {
  return <span className={`badge ${tone}`} title={label}>{n && <Icon n={n} />}{children ?? label}</span>;
}

/** Hours and minutes in the compact form games use: 3h35, 45m. */
export const hm = (min: number) => {
  const m = Math.round(min);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
};
