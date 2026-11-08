import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { pairKey } from '../sim/markets';
import { shiftWindow, unitOf, type Unit } from '../sim/schedule';
import { blockMinutes, DAY, hhmm, localMinutes, rotationInfo, type Aircraft, type Plan } from '../sim/simulate';
import { pct } from './format';
import { dayStart, routeColor, shortType } from './sheets';

/** Pixels per hour on the board. 24 h is a bit taller than a phone screen, so the board scrolls. */
const HOUR = 30;
const H = 24 * HOUR;
/** Press and hold this long on a flight to pick it up; a quick swipe still scrolls the sheet. */
const HOLD_MS = 280;
const SNAP = 5;
const mod = (x: number, m: number) => ((x % m) + m) % m;

type Drag = { acId: string; unit: Unit; y0: number; delta: number; min: number; max: number };

/**
 * The day as a board: one column per aircraft, time running down. Tap a flight to edit it, tap a gap to add one,
 * press and hold a flight then drag it up or down to move it (a round trip moves together). Past the next or
 * previous flight the block turns red and stops at the limit.
 */
export function ScheduleBoard({ plan, now, selected, onPickLeg, onGap, onShift }: {
  plan: Plan; now: number; selected: { acId: string; legs: number[] } | null;
  onPickLeg: (acId: string, leg: number) => void; onGap: (acId: string, t: number) => void;
  onShift: (acId: string, unit: Unit, delta: number) => void;
}) {
  const start0 = dayStart(plan.base);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const hold = useRef<{ timer: number; x: number; y: number; moved: boolean; picked: boolean } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // While a flight is held, stop the sheet from scrolling under the finger.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const pressFlight = (e: RPointerEvent, ac: Aircraft, leg: number) => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const pid = e.pointerId;
    const y0 = e.clientY;
    const h = { timer: 0, x: e.clientX, y: e.clientY, moved: false, picked: false };
    h.timer = window.setTimeout(() => {
      if (h.moved) return;
      h.picked = true;
      try { target.setPointerCapture(pid); } catch { /* pointer already gone */ }
      const unit = unitOf(ac, leg);
      const w = shiftWindow(ac, unit);
      navigator.vibrate?.(10);
      setDrag({ acId: ac.id, unit, y0, delta: 0, min: w.min, max: w.max });
    }, HOLD_MS);
    hold.current = h;
  };
  const moveFlight = (e: RPointerEvent) => {
    const h = hold.current;
    if (h && !h.picked && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) { h.moved = true; clearTimeout(h.timer); }
    const d = dragRef.current;
    if (!d) return;
    const raw = ((e.clientY - d.y0) / HOUR) * 60;
    setDrag({ ...d, delta: Math.round(raw / SNAP) * SNAP });
  };
  const releaseFlight = (ac: Aircraft, leg: number) => {
    const h = hold.current; hold.current = null;
    if (h) clearTimeout(h.timer);
    const d = dragRef.current;
    if (d) {
      setDrag(null);
      const delta = Math.max(d.min, Math.min(d.max, d.delta));
      if (delta) onShift(d.acId, d.unit, delta);
      return;
    }
    if (h && !h.moved) onPickLeg(ac.id, leg);
  };
  const cancel = () => { const h = hold.current; hold.current = null; if (h) clearTimeout(h.timer); setDrag(null); };

  const nowY = (mod(now - start0, DAY) / DAY) * H;
  return (
    <div className="board" ref={boardRef} style={{ ['--cols' as string]: Math.max(1, plan.fleet.length) }}>
      <div className="board-head">
        <span />
        {plan.fleet.map((ac) => {
          const info = rotationInfo(ac);
          const bad = !info.closed || !info.fits;
          return <span key={ac.id} className="board-who"><b>{ac.reg}</b><small className={bad ? 'bad' : ''}>{shortType(ac.type)} · {bad ? '⚠' : pct(info.utilisation)}</small></span>;
        })}
      </div>
      <div className="board-grid" style={{ height: H }}>
        <div className="board-hours" aria-hidden="true">
          {Array.from({ length: 25 }, (_, h) => h).filter((h) => h % 3 === 0).map((h) => <span key={h} style={{ top: h * HOUR }}>{String(h).padStart(2, '0')}</span>)}
        </div>
        {plan.fleet.map((ac) => {
          const d = drag?.acId === ac.id ? drag : null;
          const over = d ? d.delta < d.min || d.delta > d.max : false;
          return (
            <div key={ac.id} className="board-col" role="button" aria-label={`${ac.reg} 點空白處加航班`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const minute = Math.round((((e.clientY - r.top) / H) * DAY) / 15) * 15;
                onGap(ac.id, start0 + minute);
              }}>
              {[3, 6, 9, 12, 15, 18, 21].map((h) => <i key={h} className={`board-line${h % 6 === 0 ? ' major' : ''}`} style={{ top: h * HOUR }} />)}
              {ac.legs.flatMap((l, i) => {
                const bm = blockMinutes(l.from, l.to, ac.type);
                const inUnit = d && i >= d.unit.start && i < d.unit.start + d.unit.count;
                const shift = inUnit ? d.delta : 0;
                const s = mod(l.dep + shift - start0, DAY);
                const parts = s + bm > DAY ? [[s, DAY - s], [0, s + bm - DAY]] : [[s, bm]];
                const sel = selected?.acId === ac.id && selected.legs.includes(i);
                return parts.map(([p, w], k) => (
                  <button key={`${i}-${k}`} className={`board-blk${sel ? ' sel' : ''}${inUnit ? ' lifted' : ''}${inUnit && over ? ' clash' : ''}`}
                    style={{ top: (p / DAY) * H, height: Math.max(6, (w / DAY) * H), background: routeColor(pairKey(l.from, l.to)) }}
                    aria-label={`${hhmm(localMinutes(l.from, l.dep))} ${l.from} 到 ${l.to}，按住拖動改時間`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => pressFlight(e, ac, i)} onPointerMove={moveFlight}
                    onPointerUp={(e) => { e.stopPropagation(); releaseFlight(ac, i); }} onPointerCancel={cancel}
                    onContextMenu={(e) => e.preventDefault()}>
                    {k === 0 && (w / DAY) * H >= 22 && <><b>{l.from}→{l.to}</b>{(w / DAY) * H >= 36 && <small>{hhmm(localMinutes(plan.base, l.dep + shift))}</small>}</>}
                    {k === 0 && d && i === d.unit.start && <span className="board-tip">{shift ? `${shift > 0 ? '+' : ''}${shift} 分` : '拖動'}{over ? ' · 衝突' : ''}</span>}
                  </button>
                ));
              })}
              <i className="board-now" style={{ top: nowY }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Turn minutes into "+1h05" style text for toasts. */
export const shiftText = (delta: number) => `${delta > 0 ? '延後' : '提早'} ${Math.floor(Math.abs(delta) / 60) ? `${Math.floor(Math.abs(delta) / 60)} 小時 ` : ''}${Math.abs(delta) % 60 ? `${Math.abs(delta) % 60} 分` : ''}`.trim();
