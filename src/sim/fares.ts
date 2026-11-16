// What the player's fare setting on one route does to the network: used to explain the trade-off and suggest a fare.
import { simulate, type Plan } from './simulate';

export const FARE_MIN = 0.7;
export const FARE_MAX = 3;
export const FARE_STEP = 0.05;

export interface FarePoint {
  mult: number;
  /** Weekly profit of the whole network (fares on one route also change its connecting travellers). */
  profit: number;
  loadFactor: number; // on this route
  demand: number; // weekly travellers wanting this route's flights
  spill: number;
  /** Drawn between two simulated steps instead of simulated (the curve only simulates around its best fare). */
  approx?: boolean;
}

export const clampFare = (x: number) => Math.max(FARE_MIN, Math.min(FARE_MAX, Math.round(x / FARE_STEP) * FARE_STEP));

const STEPS = Math.round((FARE_MAX - FARE_MIN) / FARE_STEP) + 1;

/**
 * The route's results at every fare step from 70% to 300% of the reference fare, one simulation at a time so a caller
 * can yield between them and drop a curve a newer plan has made stale. Every other step comes first (the ones in line
 * with today's fare), and the generator yields 'coarse' once those are in `out`: a usable curve in half the time.
 * Returns the full curve, which is also `out`.
 */
export function* fareCurveSteps(plan: Plan, key: string, out: FarePoint[] = []): Generator<'coarse' | void, FarePoint[], void> {
  const today = plan.fares[key] ?? 1;
  const first = Math.max(0, Math.round((today - FARE_MIN) / FARE_STEP)) % 2;
  const multAt = (i: number) => Math.round((FARE_MIN + i * FARE_STEP) * 100) / 100;
  const tried = new Map<number, FarePoint>();
  const run = (i: number) => {
    const mult = multAt(i);
    const res = simulate(Math.abs(mult - today) < 1e-9 ? plan : { ...plan, fares: { ...plan.fares, [key]: mult } });
    const r = res.routes[key];
    if (r) tried.set(i, { mult, profit: res.revenue - res.cost, loadFactor: r.loadFactor, demand: r.demand, spill: r.spill });
  };
  // Every point of the curve: simulated ones as they are, the rest drawn between their neighbours (flagged approx).
  const fill = () => {
    const known = [...tried.keys()].sort((a, b) => a - b);
    out.length = 0;
    for (let i = 0; i < STEPS; i++) {
      const hit = tried.get(i);
      if (hit) { out.push(hit); continue; }
      const lo = known.filter((k) => k < i).pop(), hi = known.find((k) => k > i);
      if (lo === undefined || hi === undefined) continue;
      const a = tried.get(lo)!, b = tried.get(hi)!, t = (i - lo) / (hi - lo);
      const mix = (x: number, y: number) => x + (y - x) * t;
      out.push({ mult: multAt(i), profit: mix(a.profit, b.profit), loadFactor: mix(a.loadFactor, b.loadFactor), demand: mix(a.demand, b.demand), spill: mix(a.spill, b.spill), approx: true });
    }
  };
  for (let i = first; i < STEPS; i += 2) { run(i); yield; }
  fill();
  yield 'coarse';
  // Profit rises then falls with the fare, so the best step is next to the best of every other step: try just those two.
  let top = -1;
  for (const [i, p] of tried) if (top < 0 || p.profit > tried.get(top)!.profit) top = i;
  for (const i of [top - 1, top + 1]) if (i >= 0 && i < STEPS && !tried.has(i)) { run(i); yield; }
  fill();
  return out;
}

/** The whole curve at once. */
export function fareCurve(plan: Plan, key: string): FarePoint[] {
  const steps = fareCurveSteps(plan, key);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** The most profitable fare step; ties go to the cheaper fare. */
export const bestFare = (curve: FarePoint[]) =>
  curve.reduce<FarePoint | undefined>((best, p) => (p.approx || (best && p.profit <= best.profit + 1) ? best : p), undefined);
