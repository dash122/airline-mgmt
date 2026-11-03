import { useEffect, useRef } from 'react';
import geo from '../data/geo.json';
import { AIRPORTS, AIRPORT_BY_CODE } from '../data/airports';
import { greatCirclePoint } from '../sim/geo';
import { blockMinutes, DAY, hhmm, localMinutes, routePairs, type NetworkResult, type Plan } from '../sim/simulate';
import { fitView, projX, projY, toScreen, zoomAt, type View } from './projection';

export type Theme = 'day' | 'night';

export interface Selection {
  kind: 'airport' | 'route' | 'aircraft';
  id: string;
}

interface Props {
  plan: Plan;
  result: NetworkResult | null;
  stale: boolean;
  selection: Selection | null;
  connectFrom: string | null;
  theme: Theme;
  onTapAirport: (code: string) => void;
  onTapRoute: (id: string) => void;
  onTapEmpty: () => void;
  onDragRoute: (a: string, b: string) => void;
}

const PALETTE = {
  day: { sea: '#dfe9f0', land: '#f7f5ef', coast: '#c3cdd3', border: '#cfc8b8', label: '#26323a', labelHalo: '#f7f5ef', airport: '#26323a', route: '#2f6fb3', idle: '#8a9aa6', plane: '#14212b', sel: '#e0662b' },
  night: { sea: '#0c1620', land: '#17232e', coast: '#2b3a47', border: '#33424f', label: '#d6e2ea', labelHalo: '#0c1620', airport: '#d6e2ea', route: '#5fb0ff', idle: '#5d6f7d', plane: '#ffffff', sel: '#ff9a5a' },
};

const SIZE_RADIUS = { hub: 7, major: 5, large: 4.5, medium: 3.5, small: 3 } as const;
const SIZE_PRIORITY = { hub: 2, major: 3, large: 4, medium: 5, small: 6 } as const;
const LF_COLORS = { good: '#2e9d6a', ok: '#d9a021', bad: '#d4493b' };
const lfColor = (lf: number) => (lf >= 0.8 ? LF_COLORS.good : lf >= 0.6 ? LF_COLORS.ok : LF_COLORS.bad);

const ARC_STEPS = 32;
export const CLOCK_DAY_MS = 60_000;
const HIT_AIRPORT_PX = 22;

function arc(a: string, b: string): [number, number][] {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= ARC_STEPS; i++) pts.push(greatCirclePoint(A.lat, A.lon, B.lat, B.lon, i / ARC_STEPS));
  return pts;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function MapCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<{ from: string; x: number; y: number } | null>(null);
  const landCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const panTarget = useRef<{ cx: number; cy: number } | null>(null);

  // Keep the selected airport or route visible above the bottom sheet on phones.
  useEffect(() => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    if (!v || !props.selection || w >= 820) return;
    let lat: number, lon: number;
    if (props.selection.kind === 'airport') {
      const a = AIRPORT_BY_CODE[props.selection.id];
      if (!a) return;
      [lat, lon] = [a.lat, a.lon];
    } else {
      const r = props.selection.kind === 'route' ? routePairs(props.plan).find((x) => x.key === props.selection!.id) : undefined;
      if (!r) return;
      const A = AIRPORT_BY_CODE[r.a], B = AIRPORT_BY_CODE[r.b];
      [lat, lon] = greatCirclePoint(A.lat, A.lon, B.lat, B.lon, 0.5);
    }
    const [x, y] = toScreen(v, w, h, lat, lon);
    const visibleBottom = h * 0.42;
    if (y > 100 && y < visibleBottom && x > 20 && x < w - 20) return;
    const targetY = h * 0.27;
    panTarget.current = { cx: v.cx + (x - w / 2) / v.scale, cy: v.cy + (targetY - y) / v.scale };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selection?.kind, props.selection?.id]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (!viewRef.current) {
        const v = fitView(rect.width, rect.height, 20, 112, 44, 146);
        viewRef.current = { ...v, cy: projY(31) };
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Test hook: screen position of an airport.
    (window as unknown as { __wpScreen?: unknown }).__wpScreen = (code: string) => {
      const a = AIRPORT_BY_CODE[code];
      return a ? toScreen(viewRef.current!, sizeRef.current.w, sizeRef.current.h, a.lat, a.lon) : null;
    };

    const screen = (lat: number, lon: number) => toScreen(viewRef.current!, sizeRef.current.w, sizeRef.current.h, lat, lon);

    const drawLand = (pal: (typeof PALETTE)['day']) => {
      const { w, h, dpr } = sizeRef.current;
      const v = viewRef.current!;
      const key = `${w}x${h}@${dpr}:${v.cx.toFixed(4)},${v.cy.toFixed(4)},${v.scale.toFixed(4)}:${propsRef.current.theme}`;
      if (landCache.current?.key === key) return landCache.current.canvas;
      const off = landCache.current?.canvas ?? document.createElement('canvas');
      off.width = Math.round(w * dpr);
      off.height = Math.round(h * dpr);
      const c = off.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = pal.sea;
      c.fillRect(0, 0, w, h);
      const sx = (lon: number) => w / 2 + (projX(lon) - v.cx) * v.scale;
      const sy = (lat: number) => h / 2 - (projY(lat) - v.cy) * v.scale;
      c.beginPath();
      for (const ring of geo.land as number[][][]) {
        ring.forEach(([lon, lat], i) => (i ? c.lineTo(sx(lon), sy(lat)) : c.moveTo(sx(lon), sy(lat))));
        c.closePath();
      }
      c.fillStyle = pal.land;
      c.fill();
      c.strokeStyle = pal.coast;
      c.lineWidth = 0.8;
      c.stroke();
      c.beginPath();
      for (const line of geo.borders as number[][][]) {
        line.forEach(([lon, lat], i) => (i ? c.lineTo(sx(lon), sy(lat)) : c.moveTo(sx(lon), sy(lat))));
      }
      c.setLineDash([3, 3]);
      c.strokeStyle = pal.border;
      c.stroke();
      c.setLineDash([]);
      landCache.current = { key, canvas: off };
      return off;
    };

    const draw = (time: number) => {
      const p = propsRef.current;
      const pal = PALETTE[p.theme];
      const { w, h, dpr } = sizeRef.current;
      if (panTarget.current) {
        const cur = viewRef.current!, t = panTarget.current;
        const nx = cur.cx + (t.cx - cur.cx) * 0.2, ny = cur.cy + (t.cy - cur.cy) * 0.2;
        if (Math.abs(t.cx - nx) * cur.scale < 0.5 && Math.abs(t.cy - ny) * cur.scale < 0.5) {
          viewRef.current = { ...cur, cx: t.cx, cy: t.cy };
          panTarget.current = null;
        } else viewRef.current = { ...cur, cx: nx, cy: ny };
      }
      const v = viewRef.current!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(drawLand(pal), 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Routes
      const pairs = routePairs(p.plan);
      for (const r of pairs) {
        const pts = arc(r.a, r.b).map(([la, lo]) => screen(la, lo));
        const res = p.result && !p.stale ? p.result.routes[r.key] : undefined;
        const selected = p.selection?.kind === 'route' && p.selection.id === r.key;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineCap = 'round';
        if (selected) {
          ctx.strokeStyle = pal.sel;
          ctx.lineWidth = 9;
          ctx.globalAlpha = 0.35;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = res ? lfColor(res.loadFactor) : pal.idle;
        ctx.lineWidth = res ? Math.min(8, 2 + Math.sqrt(res.pax / 14) / 12) : 1.5 + Math.min(4, r.flightsPerDay * 0.5);
        if (!res) ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Aircraft, placed by a simulated clock running through the day (one day per CLOCK_DAY_MS).
      const clock = ((time % CLOCK_DAY_MS) / CLOCK_DAY_MS) * DAY;
      for (const ac of p.plan.fleet) {
        const selectedAc = p.selection?.kind === 'aircraft' && p.selection.id === ac.id;
        for (const leg of ac.legs) {
          const block = blockMinutes(leg.from, leg.to, ac.type);
          const t = (((clock - leg.dep) % DAY) + DAY) % DAY;
          if (t >= block) continue;
          const pts = arc(leg.from, leg.to);
          const f = (t / block) * ARC_STEPS;
          const i = Math.min(ARC_STEPS - 1, Math.floor(f));
          const [x0, y0] = screen(pts[i][0], pts[i][1]), [x1, y1] = screen(pts[i + 1][0], pts[i + 1][1]);
          const x = x0 + (x1 - x0) * (f - i), y = y0 + (y1 - y0) * (f - i);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
          ctx.fillStyle = selectedAc ? pal.sel : pal.plane;
          const s = selectedAc ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(6 * s, 0);
          ctx.lineTo(-4 * s, -4 * s);
          ctx.lineTo(-2 * s, 0);
          ctx.lineTo(-4 * s, 4 * s);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // Rubber band while dragging a new route
      const drag = dragRef.current;
      if (drag) {
        const A = AIRPORT_BY_CODE[drag.from];
        const [ax, ay] = screen(A.lat, A.lon);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(drag.x, drag.y);
        ctx.strokeStyle = pal.sel;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Airports
      const inPlan = new Set(pairs.flatMap((r) => [r.a, r.b]));
      ctx.font = '600 12px system-ui, "PingFang TC", "Noto Sans TC", sans-serif';
      ctx.textBaseline = 'middle';
      const labels: { prio: number; text: string; x: number; y: number }[] = [];
      for (const a of AIRPORTS) {
        const [x, y] = screen(a.lat, a.lon);
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
        const r = SIZE_RADIUS[a.size];
        const isBase = a.code === p.plan.base;
        const selected = (p.selection?.kind === 'airport' && p.selection.id === a.code) || p.connectFrom === a.code;
        if (selected) {
          ctx.beginPath();
          ctx.arc(x, y, r + 7 + Math.sin(time / 250) * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = pal.sel;
          ctx.globalAlpha = 0.25;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = inPlan.has(a.code) || isBase ? pal.airport : pal.land;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isBase ? pal.sel : pal.airport;
        ctx.stroke();
        const showLabel = a.size === 'hub' || (a.size === 'major' && v.scale > 25) || v.scale > 45 || inPlan.has(a.code) || selected || isBase;
        if (showLabel) {
          const prio = selected || isBase ? 0 : inPlan.has(a.code) ? 1 : SIZE_PRIORITY[a.size];
          labels.push({ prio, text: v.scale > 45 ? `${a.name} ${a.code}` : a.name, x: x + r + 4, y });
        }
      }
      // Labels, most important first, skipping any that would overlap one already placed.
      labels.sort((l1, l2) => l1.prio - l2.prio);
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      ctx.lineWidth = 3;
      for (const l of labels) {
        const box = { x0: l.x - 2, y0: l.y - 8, x1: l.x + ctx.measureText(l.text).width + 2, y1: l.y + 8 };
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        placed.push(box);
        ctx.strokeStyle = pal.labelHalo;
        ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = pal.label;
        ctx.fillText(l.text, l.x, l.y);
      }
      // Clock (local time at the base)
      if (p.plan.fleet.length) {
        ctx.font = '700 15px system-ui, sans-serif';
        const label = `${AIRPORT_BY_CODE[p.plan.base].name} ${hhmm(localMinutes(p.plan.base, clock))}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = pal.labelHalo;
        ctx.strokeText(label, 14, h - 40);
        ctx.fillStyle = pal.label;
        ctx.fillText(label, 14, h - 40);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // --- Input ---
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'pan' | 'route' | 'pinch' = 'none';
    let downAt = { x: 0, y: 0 };
    let moved = 0;
    let pinchStart: { dist: number; view: View; mid: { x: number; y: number } } | null = null;

    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const airportAt = (x: number, y: number): string | null => {
      let best: string | null = null, bestD = HIT_AIRPORT_PX;
      for (const a of AIRPORTS) {
        const [ax, ay] = screen(a.lat, a.lon);
        const d = Math.hypot(ax - x, ay - y);
        if (d < bestD) { bestD = d; best = a.code; }
      }
      return best;
    };
    const routeAt = (x: number, y: number): string | null => {
      for (const r of routePairs(propsRef.current.plan)) {
        const pts = arc(r.a, r.b).map(([la, lo]) => screen(la, lo));
        for (let i = 0; i < pts.length - 1; i++) {
          if (distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 12) return r.key;
        }
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      panTarget.current = null;
      const pt = local(e);
      pointers.set(e.pointerId, pt);
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        mode = 'pinch';
        dragRef.current = null;
        pinchStart = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), view: { ...viewRef.current! }, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
        return;
      }
      downAt = pt;
      moved = 0;
      const ap = airportAt(pt.x, pt.y);
      mode = ap ? 'route' : 'pan';
      if (ap) dragRef.current = { from: ap, x: pt.x, y: pt.y };
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const pt = local(e);
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, pt);
      const { w, h } = sizeRef.current;
      if (mode === 'pinch' && pinchStart && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        let v = zoomAt(pinchStart.view, w, h, pinchStart.mid.x, pinchStart.mid.y, dist / pinchStart.dist);
        v = { ...v, cx: v.cx - (mid.x - pinchStart.mid.x) / v.scale, cy: v.cy + (mid.y - pinchStart.mid.y) / v.scale };
        viewRef.current = v;
        return;
      }
      moved = Math.max(moved, Math.hypot(pt.x - downAt.x, pt.y - downAt.y));
      if (mode === 'pan') {
        const v = viewRef.current!;
        viewRef.current = { ...v, cx: v.cx - (pt.x - prev.x) / v.scale, cy: v.cy + (pt.y - prev.y) / v.scale };
      } else if (mode === 'route' && dragRef.current) {
        dragRef.current = { ...dragRef.current, x: pt.x, y: pt.y };
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const pt = local(e);
      pointers.delete(e.pointerId);
      const p = propsRef.current;
      if (mode === 'pinch') {
        if (pointers.size === 0) mode = 'none';
        return;
      }
      const tap = moved < 8;
      if (mode === 'route' && dragRef.current) {
        const from = dragRef.current.from;
        dragRef.current = null;
        if (tap) p.onTapAirport(from);
        else {
          const to = airportAt(pt.x, pt.y);
          if (to && to !== from) p.onDragRoute(from, to);
        }
      } else if (mode === 'pan' && tap) {
        const rid = routeAt(pt.x, pt.y);
        if (rid) p.onTapRoute(rid);
        else p.onTapEmpty();
      }
      mode = 'none';
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = local(e);
      const { w, h } = sizeRef.current;
      viewRef.current = zoomAt(viewRef.current!, w, h, pt.x, pt.y, Math.exp(-e.deltaY * 0.0015));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return <canvas ref={canvasRef} className="map" aria-label="航線地圖" />;
}
