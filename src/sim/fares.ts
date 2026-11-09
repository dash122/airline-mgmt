// What the player's fare setting on one route does to the network: used to explain the trade-off and suggest a fare.
import { simulate, type Plan } from './simulate';

export const FARE_MIN = 0.7;
export const FARE_MAX = 1.4;
export const FARE_STEP = 0.05;

export interface FarePoint {
  mult: number;
  /** Weekly profit of the whole network (fares on one route also change its connecting travellers). */
  profit: number;
  loadFactor: number; // on this route
  demand: number; // weekly travellers wanting this route's flights
  spill: number;
}

export const clampFare = (x: number) => Math.max(FARE_MIN, Math.min(FARE_MAX, Math.round(x / FARE_STEP) * FARE_STEP));

const STEPS = Math.round((FARE_MAX - FARE_MIN) / FARE_STEP) + 1;

/**
 * The route's results at every fare step from 70% to 140% of the reference fare, one simulation at a time so a caller
 * can yield between them and drop a curve a newer plan has made stale. Every other step comes first (the ones in line
 * with today's fare), and the generator yields 'coarse' once those are in `out`: a usable curve in half the time.
 * Returns the full curve, which is also `out`.
 */
export function* fareCurveSteps(plan: Plan, key: string, out: FarePoint[] = []): Generator<'coarse' | void, FarePoint[], void> {
  const today = plan.fares[key] ?? 1;
  const first = Math.max(0, Math.round((today - FARE_MIN) / FARE_STEP)) % 2;
  for (const parity of [first, 1 - first]) {
    for (let i = parity; i < STEPS; i += 2) {
      const mult = Math.round((FARE_MIN + i * FARE_STEP) * 100) / 100;
      const res = simulate(Math.abs(mult - today) < 1e-9 ? plan : { ...plan, fares: { ...plan.fares, [key]: mult } });
      const r = res.routes[key];
      if (r) out.push({ mult, profit: res.revenue - res.cost, loadFactor: r.loadFactor, demand: r.demand, spill: r.spill });
      yield;
    }
    out.sort((x, y) => x.mult - y.mult);
    if (parity === first) yield 'coarse';
  }
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
  curve.reduce<FarePoint | undefined>((best, p) => (!best || p.profit > best.profit + 1 ? p : best), undefined);
