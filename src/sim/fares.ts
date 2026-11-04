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

/** The route's results at every fare step from 70% to 140% of the reference fare. */
export function fareCurve(plan: Plan, key: string): FarePoint[] {
  const out: FarePoint[] = [];
  for (let i = 0; FARE_MIN + i * FARE_STEP <= FARE_MAX + 1e-9; i++) {
    const mult = Math.round((FARE_MIN + i * FARE_STEP) * 100) / 100;
    const res = simulate({ ...plan, fares: { ...plan.fares, [key]: mult } });
    const r = res.routes[key];
    if (!r) continue;
    out.push({ mult, profit: res.revenue - res.cost, loadFactor: r.loadFactor, demand: r.demand, spill: r.spill });
  }
  return out;
}

/** The most profitable fare step; ties go to the cheaper fare. */
export const bestFare = (curve: FarePoint[]) =>
  curve.reduce<FarePoint | undefined>((best, p) => (!best || p.profit > best.profit + 1 ? p : best), undefined);
