import { useEffect, useRef } from 'react';
import geo from '../data/geo.json';
import { AIRPORTS, AIRPORT_BY_CODE } from '../data/airports';
import { greatCirclePoint } from '../sim/geo';
import { blockMinutes, DAY, routePairs, type NetworkResult, type Plan } from '../sim/simulate';
import { type GameClock } from './clock';
import { fitView, projX, projY, toScreen, zoomAt, type View } from './projection';

export type Theme = 'day' | 'night';

export interface Selection {
  kind: 'airport' | 'route' | 'aircraft';
  id: string;
}

interface Props {
  plan: Plan;
  result: NetworkResult | null;
  clock: GameClock;
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
/** Wrap-around: the world is drawn once on each side so the Pacific can be crossed. */
const WORLD_COPIES = [-1, 0, 1];
/** Zoom (pixels per degree) at which each airport size starts to show; below that only bigger ones do. */
const SHOW_FROM = { hub: 0, major: 2.4, large: 4.5, medium: 9, small: 18 } as const;
/** Label thresholds, same idea. */
const LABEL_FROM = { hub: 2.2, major: 7, large: 14, medium: 26, small: 40 } as const;
/** Airports closer than this on screen (px) are grouped under the biggest one. */
const CLUSTER_PX = 26;
const BY_PRIORITY = [...AIRPORTS].sort((a, b) => SIZE_PRIORITY[a.size] - SIZE_PRIORITY[b.size] || b.catchment - a.catchment);
const RING_BOX: number[][] = (geo.land as number[][][]).map((ring) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
});
const PROJ_Y: Record<string, number> = Object.fromEntries(AIRPORTS.map((a) => [a.code, projY(a.lat)]));

interface Visible { code: string; x: number; y: number; hidden: number }
const HIT_AIRPORT_PX = 22;

function arc(a: string, b: string): [number, number][] {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= ARC_STEPS; i++) pts.push(greatCirclePoint(A.lat, A.lon, B.lat, B.lon, i / ARC_STEPS));
  return pts;
}

/** Great-circle path with longitudes made continuous, so a Pacific route does not jump across the map. */
function arcUnwrapped(a: string, b: string): [number, number][] {
  const pts = arc(a, b);
  let prev = pts[0][1];
  for (const p of pts) {
    p[1] += 360 * Math.round((prev - p[1]) / 360);
    prev = p[1];
  }
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
  const dragRef = useRef<{ from: string; x: number; y: number; sx: number; sy: number } | null>(null);
  const landCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const visibleRef = useRef<Visible[]>([]);
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
        // Start on the home base, about 4,000 km across (a region), with the whole world a pinch away.
        const b = AIRPORT_BY_CODE[propsRef.current.plan.base];
        const v = fitView(rect.width, rect.height, b.lat - 14, b.lon - 20, b.lat + 14, b.lon + 20);
        viewRef.current = { ...v, cx: b.lon, cy: projY(b.lat) };
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
      const copies = WORLD_COPIES.filter((k) => sx(-180 + 360 * k) < w && sx(180 + 360 * k) > 0);
      const lineRing = (ring: number[][], dx: number) => {
        let lx = -1e9, ly = -1e9, started = false;
        for (let i = 0; i < ring.length; i++) {
          const x = sx(ring[i][0]) + dx, y = sy(ring[i][1]);
          if (started && Math.abs(x - lx) < 0.8 && Math.abs(y - ly) < 0.8 && i < ring.length - 1) continue;
          if (started) c.lineTo(x, y);
          else { c.moveTo(x, y); started = true; }
          lx = x; ly = y;
        }
        c.closePath();
      };
      const wrapPx = 360 * v.scale;
      c.beginPath();
      for (const k of copies) {
        for (let r = 0; r < RING_BOX.length; r++) {
          const bx = RING_BOX[r];
          const x0 = sx(bx[0]) + k * wrapPx, x1 = sx(bx[2]) + k * wrapPx, y0 = sy(bx[3]), y1 = sy(bx[1]);
          if (x1 < 0 || x0 > w || y1 < 0 || y0 > h || (x1 - x0 < 1.2 && y1 - y0 < 1.2)) continue;
          lineRing(geo.land[r] as number[][], k * wrapPx);
        }
      }
      c.fillStyle = pal.land;
      c.fill();
      c.strokeStyle = pal.coast;
      c.lineWidth = 0.8;
      c.stroke();
      if (v.scale > 2.5) {
        c.beginPath();
        for (const k of copies) {
          for (const line of geo.borders as number[][][]) {
            let started = false, lx = -1e9, ly = -1e9;
            for (let i = 0; i < line.length; i++) {
              const x = sx(line[i][0]) + k * wrapPx, y = sy(line[i][1]);
              if (started && Math.abs(x - lx) < 1 && Math.abs(y - ly) < 1) continue;
              if (started) c.lineTo(x, y);
              else { c.moveTo(x, y); started = true; }
              lx = x; ly = y;
            }
          }
        }
        c.setLineDash([3, 3]);
        c.strokeStyle = pal.border;
        c.stroke();
        c.setLineDash([]);
      }
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

      // Routes and aircraft, drawn once per visible copy of the world.
      const pairs = routePairs(p.plan);
      const wrapPx = 360 * v.scale;
      const copies = WORLD_COPIES.filter((k) => ((-180 + 360 * k - v.cx) * v.scale + w / 2) < w && ((180 + 360 * k - v.cx) * v.scale + w / 2) > 0);
      const pathPx = (pts: [number, number][], k: number) => pts.map(([la, lo]) => { const [x, y] = screen(la, lo); return [x + k * wrapPx, y] as [number, number]; });
      for (const r of pairs) {
        const unwrapped = arcUnwrapped(r.a, r.b);
        const res = p.result?.routes[r.key];
        const selected = p.selection?.kind === 'route' && p.selection.id === r.key;
        for (const k of [-2, -1, 0, 1, 2]) {
          const pts = pathPx(unwrapped, k);
          if (pts.every(([x]) => x < -20) || pts.every(([x]) => x > w + 20)) continue;
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
      }

      // Aircraft, placed by the game clock.
      const now = p.clock.now();
      const clock = ((now % DAY) + DAY) % DAY;
      for (const ac of p.plan.fleet) {
        const selectedAc = p.selection?.kind === 'aircraft' && p.selection.id === ac.id;
        for (const leg of ac.legs) {
          const block = blockMinutes(leg.from, leg.to, ac.type);
          const t = (((clock - leg.dep) % DAY) + DAY) % DAY;
          if (t >= block) continue;
          const pts = arcUnwrapped(leg.from, leg.to);
          const f = (t / block) * ARC_STEPS;
          const i = Math.min(ARC_STEPS - 1, Math.floor(f));
          for (const k of [-2, -1, 0, 1, 2]) {
            const [x0, y0] = screen(pts[i][0], pts[i][1]), [x1, y1] = screen(pts[i + 1][0], pts[i + 1][1]);
            const x = x0 + (x1 - x0) * (f - i) + k * wrapPx, y = y0 + (y1 - y0) * (f - i);
            if (x < -20 || x > w + 20) continue;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
            ctx.fillStyle = selectedAc ? pal.sel : pal.plane;
            const sc = selectedAc ? 1.6 : 1;
            ctx.beginPath();
            ctx.moveTo(6 * sc, 0);
            ctx.lineTo(-4 * sc, -4 * sc);
            ctx.lineTo(-2 * sc, 0);
            ctx.lineTo(-4 * sc, 4 * sc);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // Rubber band while dragging a new route
      const drag = dragRef.current;
      if (drag) {
        ctx.beginPath();
        ctx.moveTo(drag.sx, drag.sy);
        ctx.lineTo(drag.x, drag.y);
        ctx.strokeStyle = pal.sel;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Airports. Small ones appear as you zoom in, and nearby ones are grouped under the biggest.
      const inPlan = new Set(pairs.flatMap((r) => [r.a, r.b]));
      ctx.font = '600 12px system-ui, "PingFang TC", "Noto Sans TC", sans-serif';
      ctx.textBaseline = 'middle';
      const labels: { prio: number; text: string; x: number; y: number }[] = [];
      const cells = new Map<number, Visible>();
      const visible: Visible[] = [];
      const cols = Math.ceil(w / CLUSTER_PX) + 2;
      const sel = p.selection?.kind === 'airport' ? p.selection.id : null;
      const baseY = h / 2 + v.cy * v.scale;
      for (const a of BY_PRIORITY) {
        const must = inPlan.has(a.code) || a.code === p.plan.base || a.code === sel || a.code === p.connectFrom;
        if (!must && v.scale < SHOW_FROM[a.size]) continue;
        const y = baseY - PROJ_Y[a.code] * v.scale;
        if (y < -40 || y > h + 40) continue;
        for (const k of copies) {
          const x = w / 2 + (a.lon - v.cx) * v.scale + k * wrapPx;
          if (x < -40 || x > w + 40) continue;
          if (!must) {
            const cell = Math.floor((x + CLUSTER_PX) / CLUSTER_PX) + Math.floor((y + CLUSTER_PX) / CLUSTER_PX) * cols;
            const rep = cells.get(cell);
            if (rep) { rep.hidden++; continue; }
            const item = { code: a.code, x, y, hidden: 0 };
            cells.set(cell, item);
            visible.push(item);
          } else visible.push({ code: a.code, x, y, hidden: 0 });
        }
      }
      visibleRef.current = visible;
      for (const it of visible) {
        const a = AIRPORT_BY_CODE[it.code];
        const { x, y } = it;
        const r = SIZE_RADIUS[a.size];
        const isBase = a.code === p.plan.base;
        const selected = a.code === sel || p.connectFrom === a.code;
        if (selected) {
          ctx.beginPath();
          ctx.arc(x, y, r + 7 + Math.sin(time / 250) * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = pal.sel;
          ctx.globalAlpha = 0.25;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const grouped = it.hidden > 0;
        ctx.beginPath();
        ctx.arc(x, y, grouped ? r + 3 : r, 0, Math.PI * 2);
        ctx.fillStyle = inPlan.has(a.code) || isBase ? pal.airport : pal.land;
        ctx.fill();
        ctx.lineWidth = grouped ? 3 : 2;
        ctx.strokeStyle = isBase ? pal.sel : pal.airport;
        ctx.stroke();
        if (grouped) {
          ctx.save();
          ctx.font = '700 9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = inPlan.has(a.code) || isBase ? pal.land : pal.airport;
          ctx.fillText(String(Math.min(99, it.hidden + 1)), x, y + 0.5);
          ctx.restore();
        }
        const showLabel = v.scale >= LABEL_FROM[a.size] || inPlan.has(a.code) || selected || isBase;
        if (showLabel) {
          const prio = selected || isBase ? 0 : inPlan.has(a.code) ? 1 : SIZE_PRIORITY[a.size];
          labels.push({ prio, text: v.scale > 45 ? `${a.name} ${a.code}` : a.name, x: x + r + 4 + (grouped ? 3 : 0), y });
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
    const airportAt = (x: number, y: number): Visible | null => {
      let best: Visible | null = null, bestD = HIT_AIRPORT_PX;
      for (const it of visibleRef.current) {
        const d = Math.hypot(it.x - x, it.y - y);
        if (d < bestD) { bestD = d; best = it; }
      }
      return best;
    };
    const routeAt = (x: number, y: number): string | null => {
      const v = viewRef.current!;
      for (const r of routePairs(propsRef.current.plan)) {
        const unwrapped = arcUnwrapped(r.a, r.b);
        for (const k of [-2, -1, 0, 1, 2]) {
          const pts = unwrapped.map(([la, lo]) => { const [px, py] = screen(la, lo); return [px + k * 360 * v.scale, py]; });
          for (let i = 0; i < pts.length - 1; i++) {
            if (distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 12) return r.key;
          }
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
      if (ap) dragRef.current = { from: ap.code, x: pt.x, y: pt.y, sx: ap.x, sy: ap.y };
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
        const cx = v.cx - (pt.x - prev.x) / v.scale;
        viewRef.current = { ...v, cx: ((((cx + 180) % 360) + 360) % 360) - 180, cy: Math.max(projY(-65), Math.min(projY(80), v.cy + (pt.y - prev.y) / v.scale)) };
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
        const { from, sx: fx, sy: fy } = dragRef.current;
        dragRef.current = null;
        const group = tap ? visibleRef.current.find((it) => it.code === from && it.hidden > 0) : undefined;
        if (group && viewRef.current!.scale < 60) {
          // Tapping a group zooms in on it.
          const { w, h } = sizeRef.current;
          viewRef.current = zoomAt(viewRef.current!, w, h, fx, fy, 2.2);
        } else if (tap) p.onTapAirport(from);
        else {
          const to = airportAt(pt.x, pt.y);
          if (to && to.code !== from) p.onDragRoute(from, to.code);
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
