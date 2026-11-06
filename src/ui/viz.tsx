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
