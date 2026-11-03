// Weekly network simulation. Pure and deterministic: the same plan always gives the same result.
import { AIRCRAFT, classRank, type AircraftClass } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airUtility, surfaceUtility, noTravelUtility, blockHours } from './choice';
import { marketBetween, MIN_MARKET_KM } from './markets';
import { distanceKm } from './geo';

export interface Route {
  id: string;
  a: string;
  b: string;
  aircraft: AircraftClass;
  /** Weekly flights in each direction. */
  freq: number;
  /** Fare as a multiple of the market reference fare (0.7 to 1.4). */
  fareMult: number;
}

export interface Plan {
  base: string;
  routes: Route[];
}

export interface RouteResult {
  id: string;
  distKm: number;
  blockH: number;
  fare: number;
  seatsPerDir: number;
  demandPerDir: number;
  paxPerDir: number;
  spillPerDir: number;
  loadFactor: number;
  marketShare: number; // of air travellers in the market
  revenue: number;
  cost: number;
  aircraftNeeded: number;
  rivalFreq: number;
  surfaceName?: string;
}

export interface NetworkResult {
  routes: Record<string, RouteResult>;
  pax: number; // weekly one-way trips
  seats: number;
  revenue: number;
  cost: number;
  costRecovery: number; // revenue / cost
  loadFactor: number;
  fleet: number;
  flights: number; // weekly departures
}

/** Hours an aircraft can fly each week. */
export const WEEKLY_UTILIZATION_H = 7 * 15;
export const TURN_HOURS = 0.75;

export function routeProblem(a: string, b: string, aircraft: AircraftClass): string | null {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  if (!A || !B) return '找不到機場';
  if (a === b) return '同一個機場';
  if (A.city === B.city) return '同一城市的機場';
  const d = distanceKm(A.lat, A.lon, B.lat, B.lon);
  if (d < MIN_MARKET_KM) return '距離太近';
  const spec = AIRCRAFT[aircraft];
  if (d > spec.rangeKm) return `超出${spec.name}航程`;
  const maxRank = Math.min(classRank(A.maxClass), classRank(B.maxClass));
  if (classRank(aircraft) > maxRank) return '跑道無法起降此機型';
  return null;
}

export function weeklyDepartures(plan: Plan, code: string): number {
  return plan.routes.reduce((s, r) => s + (r.a === code || r.b === code ? r.freq : 0), 0);
}

export function simulateRoute(r: Route): RouteResult {
  const m = marketBetween(r.a, r.b);
  const spec = AIRCRAFT[r.aircraft];
  const A = AIRPORT_BY_CODE[r.a], B = AIRPORT_BY_CODE[r.b];
  const distKm = m?.distKm ?? distanceKm(A.lat, A.lon, B.lat, B.lon);
  const blockH = blockHours(distKm, spec.speedKmh);
  const refFare = m?.refFare ?? 0;
  const fare = Math.round(refFare * r.fareMult);
  const seatsPerDir = spec.seats * r.freq;

  let demandPerDir = 0;
  let airTotal = 0;
  if (m && r.freq > 0) {
    const uMe = Math.exp(airUtility(fare, distKm, r.freq));
    const uRival = m.rivalFreq > 0 ? Math.exp(airUtility(m.refFare, distKm, m.rivalFreq)) : 0;
    const uSurf = m.surface ? Math.exp(surfaceUtility(m.surface)) : 0;
    const uNone = Math.exp(noTravelUtility(m.refFare, distKm));
    const total = uMe + uRival + uSurf + uNone;
    demandPerDir = (m.potential * uMe) / total;
    airTotal = (m.potential * (uMe + uRival)) / total;
  }
  const paxPerDir = Math.min(demandPerDir, seatsPerDir);
  const spillPerDir = demandPerDir - paxPerDir;
  const flights = 2 * r.freq;
  const cost = flights * (blockH * spec.costPerBlockHour + spec.costPerDeparture);
  const revenue = 2 * paxPerDir * fare;
  const aircraftNeeded = r.freq > 0 ? Math.ceil((flights * (blockH + TURN_HOURS)) / WEEKLY_UTILIZATION_H) : 0;
  return {
    id: r.id,
    distKm,
    blockH,
    fare,
    seatsPerDir,
    demandPerDir,
    paxPerDir,
    spillPerDir,
    loadFactor: seatsPerDir > 0 ? paxPerDir / seatsPerDir : 0,
    marketShare: airTotal > 0 ? Math.min(paxPerDir, demandPerDir) / airTotal : 0,
    revenue,
    cost,
    aircraftNeeded,
    rivalFreq: m?.rivalFreq ?? 0,
    surfaceName: m?.surface?.name,
  };
}

export function simulate(plan: Plan): NetworkResult {
  const routes: Record<string, RouteResult> = {};
  let pax = 0, seats = 0, revenue = 0, cost = 0, fleet = 0, flights = 0;
  for (const r of plan.routes) {
    const res = simulateRoute(r);
    routes[r.id] = res;
    pax += 2 * res.paxPerDir;
    seats += 2 * res.seatsPerDir;
    revenue += res.revenue;
    cost += res.cost;
    fleet += res.aircraftNeeded;
    flights += 2 * r.freq;
  }
  return {
    routes,
    pax,
    seats,
    revenue,
    cost,
    costRecovery: cost > 0 ? revenue / cost : 0,
    loadFactor: seats > 0 ? pax / seats : 0,
    fleet,
    flights,
  };
}

/** Biggest markets from an airport, with whether the plan already serves them. */
export function topMarketsFrom(code: string, plan: Plan, limit = 8) {
  const served = new Set(plan.routes.filter((r) => r.a === code || r.b === code).map((r) => (r.a === code ? r.b : r.a)));
  const list: { to: string; airDemand: number; distKm: number; served: boolean }[] = [];
  for (const other of Object.keys(AIRPORT_BY_CODE)) {
    if (other === code) continue;
    const m = marketBetween(code, other);
    if (m) list.push({ to: other, airDemand: m.airDemand, distKm: m.distKm, served: served.has(other) });
  }
  return list.sort((x, y) => y.airDemand - x.airDemand).slice(0, limit);
}
