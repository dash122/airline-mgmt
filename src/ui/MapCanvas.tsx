import { useEffect, useLayoutEffect, useRef } from 'react';
import geo from '../data/geo.json';
import { AIRPORTS, AIRPORT_BY_CODE, airportMarkerRadius } from '../data/airports';
import { greatCirclePoint } from '../sim/geo';
import { blockMinutes, cycleOf, DAY, routePairs, type NetworkResult, type Plan } from '../sim/simulate';
import { type GameClock } from './clock';
import { useAirportAnalysis } from './airport-analysis';
import { airlineNetwork } from '../sim/networks';
import { airlines } from '../sim/competitors';
import { fitView, nearestLongitude, projY, toScreen, worldCopies, zoomAt, type View } from './projection';

export type Theme = 'day' | 'night';

export interface Selection {
  kind: 'airport' | 'route' | 'aircraft' | 'airline';
  id: string;
}

interface Props {
  plan: Plan;
  result: NetworkResult | null;
  clock: GameClock;
  selection: Selection | null;
  connectFrom: string | null;
  /** Legs to sketch while transit ideas are on screen: flown ones glow, missing ones are dashed. */
  hint?: [string, string][] | null;
  theme: Theme;
  /** A competitor airline whose whole network is drawn, with one of its routes picked out. */
  airline?: { id: string; route?: string | null } | null;
  onTapAirport: (code: string) => void;
  onTapRoute: (id: string) => void;
  onTapEmpty: () => void;
  onDragRoute: (a: string, b: string) => void;
}

const PALETTE = {
  day: { sea: '#d3e4ec', land: '#f7f7f5', coast: '#b9ccd5', border: '#d9d9dc', label: '#3a3a3c', labelHalo: '#f7f7f5', airport: '#2c2c2e', route: '#0d6c78', idle: '#8e8e93', plane: '#1c1c1e', sel: '#d8693c' },
  night: { sea: '#0b141a', land: '#1c1c1e', coast: '#2f3a40', border: '#3a3a3c', label: '#e5e5ea', labelHalo: '#0b141a', airport: '#e5e5ea', route: '#5ac8d6', idle: '#636366', plane: '#ffffff', sel: '#f2915f' },
};

const SIZE_PRIORITY = { hub: 2, major: 3, large: 4, medium: 5, small: 6 } as const;
/** Same hues as --good / --warn / --bad in style.css. */
export const LF_COLORS = { good: '#2a9447', ok: '#d98b00', bad: '#d7261e' };
const lfColor = (lf: number) => (lf >= 0.8 ? LF_COLORS.good : lf >= 0.6 ? LF_COLORS.ok : LF_COLORS.bad);

const ARC_STEPS = 32;
const HIT_AIRPORT_PX = 22;

// Project geography once. Native paths can be translated/scaled without walking
// the entire world and calculating Mercator logarithms on every gesture frame.
let geography: { land: Path2D; borders: Path2D } | null = null;
function geographyPaths() {
  if (geography) return geography;
  const path = (lines: number[][][], closed: boolean) => {
    const p = new Path2D();
    for (const line of lines) {
      line.forEach(([lon, lat], i) => i ? p.lineTo(lon, -projY(lat)) : p.moveTo(lon, -projY(lat)));
      if (closed) p.closePath();
    }
    return p;
  };
  return geography = { land: path(geo.land, true), borders: path(geo.borders, false) };
}

const arcCache = new Map<string, [number, number][]>();
function arc(a: string, b: string): [number, number][] {
  const key = `${a}>${b}`;
  const cached = arcCache.get(key);
  if (cached) return cached;
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const [lat, lon] = greatCirclePoint(A.lat, A.lon, B.lat, B.lon, i / ARC_STEPS);
    pts.push([lat, nearestLongitude(lon, i ? pts[i - 1][1] : A.lon)]);
  }
  if (arcCache.size >= 4096) arcCache.delete(arcCache.keys().next().value!);
  arcCache.set(key, pts);
  return pts;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function MapCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analysis = useAirportAnalysis(props.plan, props.result, props.selection?.kind === 'airport' && !props.hint?.length ? props.selection.id : null);
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<{ from: string; x: number; y: number } | null>(null);
  const landCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const panTarget = useRef<{ cx: number; cy: number; scale?: number } | null>(null);
  const aircraftCanvasRef = useRef<HTMLCanvasElement>(null);

  // Fit a competitor's whole network (or its picked route) into the part of the map the sheet leaves free.
  useEffect(() => {
    const v = viewRef.current;
    const id = props.airline?.id;
    const net = id ? airlineNetwork(id) : null;
    if (!v || !net) return;
    const { w, h } = sizeRef.current;
    const route = props.airline?.route?.split('-');
    const codes = route?.length === 2 ? route : net.airports;
    const ref = AIRPORT_BY_CODE[codes[0] === net.hubs[0].code || !route ? net.hubs[0].code : codes[0]];
    const pts = codes.map((c) => AIRPORT_BY_CODE[c]).map((a) => [a.lat, nearestLongitude(a.lon, ref.lon)]);
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
    const phone = w < 820;
    const top = 124, bottom = phone ? h * 0.38 : h - 70;
    const right = phone ? w : w - 420;
    const pad = route ? 48 : 28;
    const fit = fitView(Math.max(80, right - 2 * pad), Math.max(80, bottom - top - 2 * pad), Math.min(...lats) - 1, Math.min(...lons) - 1, Math.max(...lats) + 1, Math.max(...lons) + 1);
    const scale = Math.max(0.6, Math.min(route ? 30 : 60, fit.scale));
    // Shift the centre so the fitted box lands in the free area, not the middle of the screen.
    panTarget.current = { cx: fit.cx + (w / 2 - right / 2) / scale, cy: fit.cy - (h / 2 - (top + bottom) / 2) / scale, scale };
  }, [props.airline?.id, props.airline?.route]);

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
    const [x, y] = toScreen(v, w, h, lat, nearestLongitude(lon, v.cx));
    // On a phone the selection sits between the one-row header and a half-height sheet.
    const visibleBottom = h * 0.3;
    if (y > 80 && y < visibleBottom && x > 20 && x < w - 20) return;
    const targetY = h * 0.2;
    panTarget.current = { cx: v.cx + (x - w / 2) / v.scale, cy: v.cy + (targetY - y) / v.scale };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selection?.kind, props.selection?.id]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const mapContext = canvas.getContext('2d')!;
    const aircraftCanvas = aircraftCanvasRef.current!;
    const aircraftContext = aircraftCanvas.getContext('2d')!;
    let ctx = mapContext;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // A 5K Retina display has far more pixels than this animated map needs.
      // Keeping its backing store near 1440p cuts map fill and copy work sharply.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25, 2560 / rect.width, 1440 / rect.height);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      aircraftCanvas.width = canvas.width;
      aircraftCanvas.height = canvas.height;
      if (!viewRef.current) {
        const a = AIRPORT_BY_CODE[propsRef.current.plan.base];
        const v = fitView(rect.width, rect.height, a.lat - 15, a.lon - 20, a.lat + 15, a.lon + 20);
        viewRef.current = v;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Test hook: screen position of an airport.
    (window as unknown as { __wpScreen?: unknown }).__wpScreen = (code: string) => {
      const a = AIRPORT_BY_CODE[code];
      return a ? toScreen(viewRef.current!, sizeRef.current.w, sizeRef.current.h, a.lat, nearestLongitude(a.lon, viewRef.current!.cx)) : null;
    };

    let worldOffset = 0;
    const screen = (lat: number, lon: number) => toScreen(viewRef.current!, sizeRef.current.w, sizeRef.current.h, lat, lon + worldOffset);

    const drawLand = (pal: (typeof PALETTE)['day']) => {
      const { w, h, dpr } = sizeRef.current;
      const v = viewRef.current!;
      const key = `${w}x${h}@${dpr}:${v.cx.toFixed(4)},${v.cy.toFixed(4)},${v.scale.toFixed(4)}:${propsRef.current.theme}`;
      if (landCache.current?.key === key) return landCache.current.canvas;
      const off = landCache.current?.canvas ?? document.createElement('canvas');
      const width = Math.round(w * dpr), height = Math.round(h * dpr);
      if (off.width !== width) off.width = width;
      if (off.height !== height) off.height = height;
      const c = off.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = pal.sea;
      c.fillRect(0, 0, w, h);
      const paths = geographyPaths();
      for (const offset of worldCopies(v, w)) {
      c.setTransform(dpr * v.scale, 0, 0, dpr * v.scale,
        dpr * (w / 2 + (offset - v.cx) * v.scale), dpr * (h / 2 + v.cy * v.scale));
      c.fillStyle = pal.land;
      c.fill(paths.land);
      c.strokeStyle = pal.coast;
      c.lineWidth = 0.8 / v.scale;
      c.stroke(paths.land);
      c.setLineDash([3 / v.scale, 3 / v.scale]);
      c.strokeStyle = pal.border;
      c.stroke(paths.borders);
      c.setLineDash([]);
      }
      landCache.current = { key, canvas: off };
      return off;
    };

    // Keep labels, airports and routes out of the aircraft animation hot path.
    let sceneKey = '';
    let scenePlan: Plan | null = null;
    let sceneResult: NetworkResult | null = null;
    let sceneAnalysis = analysisRef.current;
    let sceneView: View | null = null;
    let flightPlan: Plan | null = null;
    let flights: { acId: string; cycle: number; dep: number; block: number; points: [number, number][] }[] = [];
    let lastPaint = -Infinity;
    let lastFrame = 0;
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || !viewRef.current) return;
      const v0 = viewRef.current!;
      const viewChanged = !sceneView || v0.cx !== sceneView.cx || v0.cy !== sceneView.cy || v0.scale !== sceneView.scale;
      // Gestures and automatic nudges follow the display refresh rate. Only
      // aircraft animation is capped to 30 fps when the camera is stationary.
      if (!viewChanged && !panTarget.current && !dragRef.current && time - lastPaint < 1000 / 30 - 0.5) return;
      lastPaint = time;
      const p = propsRef.current;
      if (flightPlan !== p.plan) {
        flights = p.plan.fleet.flatMap(ac => ac.legs.map(leg => ({
          acId: ac.id, cycle: cycleOf(ac) * DAY, dep: leg.dep,
          block: blockMinutes(leg.from, leg.to, ac.type), points: arc(leg.from, leg.to),
        })));
        flightPlan = p.plan;
      }
      const pal = PALETTE[p.theme];
      const { w, h, dpr } = sizeRef.current;
      // Ease towards a target view at the same speed whatever the frame rate (a fifth of the way per 60 Hz frame).
      const k = 1 - Math.pow(0.8, Math.min(30, (time - (lastFrame || time - 16.7)) / 16.7));
      lastFrame = time;
      if (panTarget.current) {
        const cur = viewRef.current!, t = panTarget.current;
        const nx = cur.cx + (t.cx - cur.cx) * k, ny = cur.cy + (t.cy - cur.cy) * k;
        const ts = t.scale ?? cur.scale, ns = cur.scale * Math.pow(ts / cur.scale, k);
        if (Math.abs(t.cx - nx) * cur.scale < 0.5 && Math.abs(t.cy - ny) * cur.scale < 0.5 && Math.abs(ts / ns - 1) < 0.005) {
          viewRef.current = { cx: t.cx, cy: t.cy, scale: ts };
          panTarget.current = null;
        } else viewRef.current = { cx: nx, cy: ny, scale: ns };
      }
      const v = viewRef.current!;
      const key = JSON.stringify([w, h, dpr, v.cx, v.cy, v.scale, p.theme, p.selection, p.connectFrom, p.airline, p.hint, !!dragRef.current]);
      const rebuild = key !== sceneKey || p.plan !== scenePlan || p.result !== sceneResult || analysisRef.current !== sceneAnalysis || !!dragRef.current;
      if (!rebuild && (p.clock.speed === 0 || !p.plan.fleet.some(ac => ac.legs.length))) return;
      ctx = mapContext;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (rebuild) {
        ctx.drawImage(drawLand(pal), 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        for (const offset of worldCopies(v, w)) {
        worldOffset = offset;
        // Competitor routes from the selected airport, in each airline's colour (busiest airline wins).
        const rivalFocus = p.selection?.kind === 'airport' && !p.hint?.length ? p.selection.id : null;
        if (rivalFocus) {
          for (const r of analysisRef.current?.rivals ?? []) {
            const pts = arc(rivalFocus, r.to).map(([la, lo]) => screen(la, lo));
            const top = r.services.reduce((x, y) => (y.freq > x.freq ? y : x));
            const freq = r.services.reduce((s, x) => s + x.freq, 0);
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i && Math.abs(x - pts[i - 1][0]) < viewRef.current!.scale * 180 ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.strokeStyle = top.airline.color;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = Math.min(4, 0.8 + Math.sqrt(freq) / 4);
            ctx.setLineDash([2, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        }

        // A competitor's network, in its colour; its hubs get a ring below.
        const net = p.airline ? airlineNetwork(p.airline.id) : null;
        if (net) {
          const maxF = Math.max(1, ...net.routes.map((r) => r.freq));
          for (const r of net.routes) {
            const picked = p.airline?.route === r.key;
            const pts = arc(r.a, r.b).map(([la, lo]) => screen(la, lo));
            if (!picked && pts.every(([x, y]) => x < -20 || y < -20 || x > w + 20 || y > h + 20)) continue;
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i && Math.abs(x - pts[i - 1][0]) < viewRef.current!.scale * 180 ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.lineCap = 'round';
            if (picked) {
              ctx.strokeStyle = pal.sel;
              ctx.lineWidth = 8;
              ctx.globalAlpha = 0.35;
              ctx.stroke();
            }
            ctx.strokeStyle = net.airline.color;
            ctx.globalAlpha = picked ? 1 : p.airline?.route ? 0.15 : 0.7;
            ctx.lineWidth = picked ? 3.5 : 0.8 + 2.4 * Math.sqrt(r.freq / maxF);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        // Codeshare routes: the partner's flights the player sells, dashed in the partner's colour.
        for (const cs of p.plan.codeshares ?? []) {
          const [ca, cb] = cs.key.split('-');
          const color = airlines().find((x) => x.id === cs.airline)?.color;
          if (!color || !AIRPORT_BY_CODE[ca] || !AIRPORT_BY_CODE[cb]) continue;
          const pts = arc(ca, cb).map(([la, lo]) => screen(la, lo));
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i && Math.abs(x - pts[i - 1][0]) < viewRef.current!.scale * 180 ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.lineCap = 'round';
          ctx.strokeStyle = color;
          ctx.globalAlpha = net && net.airline.id !== cs.airline ? 0.25 : 0.95;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([7, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        // Routes
        const pairs = routePairs(p.plan);
        const hintedNodes = new Set((p.hint ?? []).flat());
        for (const r of pairs) {
          const pts = arc(r.a, r.b).map(([la, lo]) => screen(la, lo));
          const res = p.result?.routes[r.key];
          const selected = p.selection?.kind === 'route' && p.selection.id === r.key;
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i && Math.abs(x - pts[i - 1][0]) < viewRef.current!.scale * 180 ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
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
          // With an airport selected, show its direct routes and fade the rest.
          const focus = p.selection?.kind === 'airport' ? p.selection.id : null;
          if (net) ctx.globalAlpha = 0.25;
          else if (focus) {
            if (r.a === focus || r.b === focus) ctx.lineWidth += 1.5;
            else if (hintedNodes.has(r.a) || hintedNodes.has(r.b)) { /* part of a transit idea: keep it visible */ }
            else ctx.globalAlpha = 0.18;
          }
          if (!res) ctx.setLineDash([6, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        // Transit ideas: legs through the hub that would connect the selected airport's markets.
        if (p.hint?.length) {
          const flownKeys = new Set(pairs.map((r) => r.key));
          for (const [a, b] of p.hint) {
            if (!AIRPORT_BY_CODE[a] || !AIRPORT_BY_CODE[b]) continue;
            const pts = arc(a, b).map(([la, lo]) => screen(la, lo));
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i && Math.abs(x - pts[i - 1][0]) < viewRef.current!.scale * 180 ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.strokeStyle = pal.sel;
            ctx.lineCap = 'round';
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.9;
            if (!flownKeys.has(a < b ? `${a}-${b}` : `${b}-${a}`)) {
              ctx.setLineDash([7, 6]);
              ctx.lineDashOffset = 0;
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineDashOffset = 0;
            ctx.globalAlpha = 1;
          }
        }

        // Rubber band while dragging a new route
        const drag = dragRef.current;
        if (drag && AIRPORT_BY_CODE[drag.from].lon + worldOffset === nearestLongitude(AIRPORT_BY_CODE[drag.from].lon, v.cx)) {
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
        const inPlan = new Set([...pairs.flatMap((r) => [r.a, r.b]), ...(p.plan.codeshares ?? []).flatMap((c) => c.key.split('-'))]);
        const hinted = new Set((p.hint ?? []).flat());
        const netHubs = new Set(net?.hubs.map((x) => x.code) ?? []);
        const picked = net && p.airline?.route ? p.airline.route.split('-') : [];
        for (const c of picked) hinted.add(c);
        ctx.font = '600 12px "Noto Sans TC", sans-serif';
        ctx.textBaseline = 'middle';
        const labels: { prio: number; text: string; x: number; y: number }[] = [];
        for (const a of AIRPORTS) {
          const [x, y] = screen(a.lat, a.lon);
          if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
          const r = airportMarkerRadius(a);
          const isBase = a.code === p.plan.base;
          const selected = (p.selection?.kind === 'airport' && p.selection.id === a.code) || p.connectFrom === a.code;
          if (selected) {
            ctx.beginPath();
            ctx.arc(x, y, r + 7, 0, Math.PI * 2);
            ctx.fillStyle = pal.sel;
            ctx.globalAlpha = 0.25;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          if (netHubs.has(a.code)) {
            ctx.beginPath();
            ctx.arc(x, y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = net!.airline.color;
            ctx.lineWidth = 3;
            ctx.stroke();
            hinted.add(a.code);
          }
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = inPlan.has(a.code) || isBase ? pal.airport : pal.land;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = isBase ? pal.sel : pal.airport;
          ctx.stroke();
          const showLabel = hinted.has(a.code) || a.size === 'hub' || (a.size === 'major' && v.scale > 25) || v.scale > 45 || inPlan.has(a.code) || selected || isBase;
          if (showLabel) {
            const prio = selected || isBase || netHubs.has(a.code) ? 0 : inPlan.has(a.code) || hinted.has(a.code) ? 1 : SIZE_PRIORITY[a.size];
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
        }
        sceneKey = key;
        scenePlan = p.plan;
        sceneResult = p.result;
        sceneAnalysis = analysisRef.current;
        sceneView = { ...v };
      }
      ctx = aircraftContext;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, aircraftCanvas.width, aircraftCanvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const offset of worldCopies(v, w)) {
        worldOffset = offset;
        // Aircraft, placed by the game clock.
        const now = p.clock.now();
        for (const flight of flights) {
          const C = flight.cycle;
          const clock = ((now % C) + C) % C;
          const selectedAc = p.selection?.kind === 'aircraft' && p.selection.id === flight.acId;
            const block = flight.block;
            const t = (((clock - flight.dep) % C) + C) % C;
            if (t >= block) continue;
            const pts = flight.points;
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
      worldOffset = 0;
    };

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
      const v = viewRef.current!;
      const pointerLon = v.cx + (x - sizeRef.current.w / 2) / v.scale;
      for (const a of AIRPORTS) {
        const [ax, ay] = screen(a.lat, nearestLongitude(a.lon, pointerLon));
        const d = Math.hypot(ax - x, ay - y);
        if (d < bestD) { bestD = d; best = a.code; }
      }
      return best;
    };
    const routeAt = (x: number, y: number): string | null => {
      for (const r of routePairs(propsRef.current.plan)) {
        for (const offset of worldCopies(viewRef.current!, sizeRef.current.w)) {
        const pts = arc(r.a, r.b).map(([la, lo]) => screen(la, lo + offset));
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
      mode = e.pointerType === 'mouse' && e.shiftKey && ap ? 'route' : 'pan';
      if (mode === 'route' && ap) dragRef.current = { from: ap, x: pt.x, y: pt.y };
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
      const tap = moved < 8 && Math.hypot(pt.x - downAt.x, pt.y - downAt.y) < 8;
      if (mode === 'route' && dragRef.current) {
        const from = dragRef.current.from;
        dragRef.current = null;
        if (tap) p.onTapAirport(from);
        else {
          const to = airportAt(pt.x, pt.y);
          if (to && to !== from) p.onDragRoute(from, to);
        }
      } else if (mode === 'pan' && tap) {
        const ap = airportAt(pt.x, pt.y);
        if (ap) p.onTapAirport(ap);
        else {
          const rid = routeAt(pt.x, pt.y);
          if (rid) p.onTapRoute(rid);
          else p.onTapEmpty();
        }
      }
      mode = 'none';
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      dragRef.current = null;
      mode = pointers.size ? 'pinch' : 'none';
      pinchStart = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      panTarget.current = null;
      const pt = local(e);
      const { w, h } = sizeRef.current;
      viewRef.current = zoomAt(viewRef.current!, w, h, pt.x, pt.y, Math.exp(-e.deltaY * 0.0015));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // Paint land and routes together before React exposes the route UI.
    draw(performance.now());
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return <><canvas ref={canvasRef} className="map" aria-label="航線地圖" /><canvas ref={aircraftCanvasRef} className="map" style={{ pointerEvents: 'none' }} aria-hidden="true" /></>;
}
