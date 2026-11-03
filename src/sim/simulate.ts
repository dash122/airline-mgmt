// Weekly network simulation over the player's fleet and daily schedules.
// Pure and deterministic: the same plan always gives the same result.
import { AIRCRAFT, classRank, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { airChoice, groundUtility, noTravelUtility, THETA, VALUE_OF_TIME } from './choice';
import { marketBetween, MIN_MARKET_KM, pairKey } from './markets';
import { distanceKm } from './geo';

export const DAY = 1440;

/** One scheduled flight in an aircraft's daily rotation. Times are minutes after 00:00 UTC on day 0. */
export interface Leg {
  from: string;
  to: string;
  dep: number;
}

export interface Aircraft {
  id: string;
  reg: string;
  type: AircraftModel;
  /** Daily rotation, in order. It repeats every day. */
  legs: Leg[];
}

export interface Plan {
  version: 2;
  base: string;
  fleet: Aircraft[];
  /** Fare multiple per market (pairKey), 0.7 to 1.4. Default 1. */
  fares: Record<string, number>;
}

export const emptyPlan = (base: string): Plan => ({ version: 2, base, fleet: [], fares: {} });

// ---------- Time helpers ----------

export const utcOffsetMin = (a: Airport) => (a.country === 'JP' ? 9 : 8) * 60;
const mod = (x: number, m: number) => ((x % m) + m) % m;
export const localMinutes = (code: string, utc: number) => mod(utc + utcOffsetMin(AIRPORT_BY_CODE[code]), DAY);
export const utcFromLocal = (code: string, local: number) => local - utcOffsetMin(AIRPORT_BY_CODE[code]);
export const hhmm = (min: number) => {
  const m = mod(Math.round(min), DAY);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Minutes from gate to gate, rounded to 5. */
export function blockMinutes(a: string, b: string, type: AircraftModel): number {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  const h = distanceKm(A.lat, A.lon, B.lat, B.lon) / AIRCRAFT[type].speedKmh + 0.5;
  return Math.round((h * 60) / 5) * 5;
}

/** How attractive a departure at this local time is (1 = about average over 06:00-22:00). */
export function timeOfDayQuality(localMin: number): number {
  const h = localMin / 60;
  if (h < 6) return 0.15;
  if (h < 7) return 0.8;
  if (h < 10) return 1.35;
  if (h < 16) return 0.85;
  if (h < 20) return 1.3;
  if (h < 22) return 0.75;
  return 0.25;
}

// ---------- Validation ----------

export function routeProblem(a: string, b: string, aircraft: AircraftModel): string | null {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  if (!A || !B) return '找不到機場';
  if (a === b) return '同一個機場';
  if (A.metro === B.metro) return '同一城市的機場';
  const d = distanceKm(A.lat, A.lon, B.lat, B.lon);
  if (d < MIN_MARKET_KM) return '距離太近';
  const spec = AIRCRAFT[aircraft];
  if (d > spec.rangeKm) return `超出${spec.name}航程`;
  const maxRank = Math.min(classRank(A.maxClass), classRank(B.maxClass));
  if (classRank(spec.cls) > maxRank) return '跑道無法起降此機型';
  return null;
}

export interface RotationInfo {
  blockMin: number; // per day
  dutyMin: number; // first departure to last arrival + turn
  closed: boolean; // ends where it starts, so it can repeat daily
  fits: boolean; // fits in 24 hours
  utilisation: number; // block hours / 24
}

export function rotationInfo(ac: Aircraft): RotationInfo {
  if (!ac.legs.length) return { blockMin: 0, dutyMin: 0, closed: true, fits: true, utilisation: 0 };
  let block = 0;
  for (const l of ac.legs) block += blockMinutes(l.from, l.to, ac.type);
  const last = ac.legs[ac.legs.length - 1];
  const end = last.dep + blockMinutes(last.from, last.to, ac.type) + AIRCRAFT[ac.type].turnMin;
  const duty = end - ac.legs[0].dep;
  return { blockMin: block, dutyMin: duty, closed: last.to === ac.legs[0].from, fits: duty <= DAY, utilisation: block / DAY };
}

/** Earliest departure (UTC minutes) for the aircraft's next leg, or a default morning slot if it has none. */
export function nextDeparture(ac: Aircraft, from: string): number {
  const last = ac.legs[ac.legs.length - 1];
  if (!last) return utcFromLocal(from, 7 * 60);
  const ready = last.dep + blockMinutes(last.from, last.to, ac.type) + AIRCRAFT[ac.type].turnMin;
  return Math.ceil(ready / 5) * 5;
}

/** Earliest a leg may depart: after the previous leg has landed and turned around. */
export function earliestDeparture(ac: Aircraft, index: number): number | null {
  if (index === 0) return null;
  const prev = ac.legs[index - 1];
  return prev.dep + blockMinutes(prev.from, prev.to, ac.type) + AIRCRAFT[ac.type].turnMin;
}

export function weeklyDepartures(plan: Plan, code: string): number {
  let n = 0;
  for (const ac of plan.fleet) for (const l of ac.legs) if (l.from === code) n += 7;
  return n;
}

// ---------- Simulation ----------

interface Flight {
  key: string; // `${acId}#${index}`
  ac: Aircraft;
  from: string;
  to: string;
  dep: number; // UTC minutes mod DAY
  arr: number; // dep + block (may exceed DAY)
  seats: number;
  blockH: number;
  distKm: number;
}

interface Itinerary {
  flights: Flight[];
  weight: number; // relative attractiveness (time of day, connection penalty)
}

export interface RouteResult {
  key: string; // pairKey
  a: string;
  b: string;
  distKm: number;
  flightsPerWeek: number; // both directions
  seats: number; // weekly, both directions
  pax: number; // weekly onboard (local + connecting), both directions
  localPax: number; // weekly travellers starting and ending on this route
  spill: number; // weekly travellers turned away on this route's flights
  loadFactor: number;
  marketShare: number; // of local air travellers
  revenue: number; // weekly, prorated from itineraries
  flyingCost: number; // weekly
  fare: number; // one-way local fare
  rivalFreq: number;
  groundName?: string;
}

export interface AircraftResult {
  id: string;
  blockHoursPerDay: number;
  utilisation: number;
  pax: number; // weekly
  seats: number; // weekly
  revenue: number;
  flyingCost: number;
  ownershipCost: number;
}

export interface NetworkResult {
  routes: Record<string, RouteResult>;
  aircraft: Record<string, AircraftResult>;
  pax: number; // weekly trips (a connecting trip counts once)
  connectingPax: number;
  seats: number;
  revenue: number;
  flyingCost: number;
  ownershipCost: number;
  cost: number;
  costRecovery: number;
  loadFactor: number;
  fleet: number;
  flights: number; // weekly departures
  avgUtilisation: number;
}

export const MIN_CONNECT = 45;
export const MAX_CONNECT = 240;
const CONNECTION_PENALTY_H = 1;

function buildFlights(plan: Plan): Flight[] {
  const out: Flight[] = [];
  for (const ac of plan.fleet) {
    const spec = AIRCRAFT[ac.type];
    ac.legs.forEach((l, i) => {
      const A = AIRPORT_BY_CODE[l.from], B = AIRPORT_BY_CODE[l.to];
      const bm = blockMinutes(l.from, l.to, ac.type);
      const dep = mod(l.dep, DAY);
      out.push({ key: `${ac.id}#${i}`, ac, from: l.from, to: l.to, dep, arr: dep + bm, seats: spec.seats, blockH: bm / 60, distKm: distanceKm(A.lat, A.lon, B.lat, B.lon) });
    });
  }
  return out;
}

export function simulate(plan: Plan): NetworkResult {
  const flights = buildFlights(plan);
  const byFrom = new Map<string, Flight[]>();
  for (const f of flights) byFrom.set(f.from, [...(byFrom.get(f.from) ?? []), f]);

  // Itineraries per directed market: nonstops, plus one-stop connections on the player's own flights.
  const itins = new Map<string, Itinerary[]>(); // `${o}>${d}`
  const add = (o: string, d: string, it: Itinerary) => {
    const k = `${o}>${d}`;
    itins.set(k, [...(itins.get(k) ?? []), it]);
  };
  for (const f1 of flights) {
    add(f1.from, f1.to, { flights: [f1], weight: timeOfDayQuality(localMinutes(f1.from, f1.dep)) });
    for (const f2 of byFrom.get(f1.to) ?? []) {
      if (AIRPORT_BY_CODE[f2.to].metro === AIRPORT_BY_CODE[f1.from].metro) continue;
      const wait = mod(f2.dep - f1.arr, DAY);
      if (wait < MIN_CONNECT || wait > MAX_CONNECT) continue;
      const m = marketBetween(f1.from, f2.to);
      if (!m) continue;
      // Extra time versus flying nonstop, valued in the same units as fares.
      const total = (f1.arr - f1.dep + wait + (f2.arr - f2.dep)) / 60;
      const direct = m.distKm / 820 + 0.5;
      const penalty = Math.exp(-THETA * VALUE_OF_TIME * (total - direct + CONNECTION_PENALTY_H));
      add(f1.from, f2.to, { flights: [f1, f2], weight: timeOfDayQuality(localMinutes(f1.from, f1.dep)) * penalty });
    }
  }

  // Demand per itinerary (daily).
  const demand = new Map<Itinerary, number>();
  const marketInfo = new Map<string, { airTotal: number; fare: number }>();
  for (const [k, list] of itins) {
    const [o, d] = k.split('>');
    const m = marketBetween(o, d);
    if (!m) continue;
    const fare = Math.round(m.refFare * (plan.fares[pairKey(o, d)] ?? 1));
    const wSum = list.reduce((s, it) => s + it.weight, 0);
    const air = airChoice([{ freq: 7 * wSum, fare }, { freq: m.rivalFreq, fare: m.refFare }], m.distKm);
    const uAir = Math.exp(air.utility);
    const uGround = m.ground ? Math.exp(groundUtility(m.ground)) : 0;
    const uNone = Math.exp(noTravelUtility(m.refFare, m.distKm));
    const airTotal = (m.potential * uAir) / (uAir + uGround + uNone);
    const mine = (airTotal * air.shares[0]) / 7;
    for (const it of list) demand.set(it, (mine * it.weight) / wSum);
    marketInfo.set(k, { airTotal, fare });
  }

  // Capacity: scale itineraries down where a flight is oversold.
  const carried = new Map(demand);
  for (let pass = 0; pass < 3; pass++) {
    const load = new Map<Flight, number>();
    for (const [it, n] of carried) for (const f of it.flights) load.set(f, (load.get(f) ?? 0) + n);
    for (const [it, n] of carried) {
      const factor = Math.min(1, ...it.flights.map((f) => f.seats / (load.get(f) || 1)));
      carried.set(it, n * factor);
    }
  }

  // Tally per flight.
  const flightPax = new Map<Flight, number>();
  const flightRevenue = new Map<Flight, number>();
  const flightSpill = new Map<Flight, number>();
  let tripsDaily = 0, connectingDaily = 0, revenueDaily = 0;
  for (const [k, list] of itins) {
    const info = marketInfo.get(k);
    if (!info) continue;
    for (const it of list) {
      const n = carried.get(it) ?? 0;
      const want = demand.get(it) ?? 0;
      tripsDaily += n;
      if (it.flights.length > 1) connectingDaily += n;
      revenueDaily += n * info.fare;
      const dist = it.flights.reduce((s, f) => s + f.distKm, 0);
      for (const f of it.flights) {
        flightPax.set(f, (flightPax.get(f) ?? 0) + n);
        flightRevenue.set(f, (flightRevenue.get(f) ?? 0) + (n * info.fare * f.distKm) / dist);
        flightSpill.set(f, (flightSpill.get(f) ?? 0) + (want - n) / it.flights.length);
      }
    }
  }

  const routes: Record<string, RouteResult> = {};
  for (const f of flights) {
    const key = pairKey(f.from, f.to);
    const spec = AIRCRAFT[f.ac.type];
    let r = routes[key];
    if (!r) {
      const m = marketBetween(f.from, f.to);
      const [a, b] = key.split('-');
      let localPax = 0, airTotal = 0;
      for (const lk of [`${a}>${b}`, `${b}>${a}`]) {
        for (const it of itins.get(lk) ?? []) if (it.flights.length === 1) localPax += 7 * (carried.get(it) ?? 0);
        airTotal += 7 * (marketInfo.get(lk)?.airTotal ?? 0);
      }
      r = routes[key] = {
        key, a, b, distKm: f.distKm, flightsPerWeek: 0, seats: 0, pax: 0, localPax, spill: 0, loadFactor: 0,
        marketShare: airTotal > 0 ? localPax / airTotal : 0, revenue: 0, flyingCost: 0,
        fare: Math.round((m?.refFare ?? 0) * (plan.fares[key] ?? 1)), rivalFreq: m?.rivalFreq ?? 0, groundName: m?.ground?.name,
      };
    }
    r.flightsPerWeek += 7;
    r.seats += 7 * f.seats;
    r.pax += 7 * (flightPax.get(f) ?? 0);
    r.spill += 7 * (flightSpill.get(f) ?? 0);
    r.revenue += 7 * (flightRevenue.get(f) ?? 0);
    r.flyingCost += 7 * (f.blockH * spec.costPerBlockHour + spec.costPerDeparture);
  }
  for (const r of Object.values(routes)) r.loadFactor = r.seats ? r.pax / r.seats : 0;

  const aircraft: Record<string, AircraftResult> = {};
  for (const ac of plan.fleet) {
    const info = rotationInfo(ac);
    aircraft[ac.id] = { id: ac.id, blockHoursPerDay: info.blockMin / 60, utilisation: info.utilisation, pax: 0, seats: 0, revenue: 0, flyingCost: 0, ownershipCost: AIRCRAFT[ac.type].ownershipPerWeek };
  }
  for (const f of flights) {
    const a = aircraft[f.ac.id];
    const spec = AIRCRAFT[f.ac.type];
    a.pax += 7 * (flightPax.get(f) ?? 0);
    a.seats += 7 * f.seats;
    a.revenue += 7 * (flightRevenue.get(f) ?? 0);
    a.flyingCost += 7 * (f.blockH * spec.costPerBlockHour + spec.costPerDeparture);
  }

  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const acs = Object.values(aircraft);
  const flyingCost = sum(acs.map((a) => a.flyingCost));
  const ownershipCost = sum(acs.map((a) => a.ownershipCost));
  const seats = sum(acs.map((a) => a.seats));
  const onboard = sum(acs.map((a) => a.pax));
  const revenue = revenueDaily * 7;
  const cost = flyingCost + ownershipCost;
  return {
    routes,
    aircraft,
    pax: tripsDaily * 7,
    connectingPax: connectingDaily * 7,
    seats,
    revenue,
    flyingCost,
    ownershipCost,
    cost,
    costRecovery: cost > 0 ? revenue / cost : 0,
    loadFactor: seats > 0 ? onboard / seats : 0,
    fleet: plan.fleet.length,
    flights: flights.length * 7,
    avgUtilisation: acs.length ? sum(acs.map((a) => a.utilisation)) / acs.length : 0,
  };
}

// ---------- Plan editing helpers ----------

const PREFERRED: AircraftModel[] = ['A20N', 'E190', 'ATR72', 'B789'];
export const defaultAircraft = (a: string, b: string) => PREFERRED.find((c) => !routeProblem(a, b, c)) ?? null;

let idCounter = 0;
export function newAircraft(plan: Plan, type: AircraftModel): Aircraft {
  const n = plan.fleet.reduce((m, a) => Math.max(m, Number(a.reg.slice(3)) || 0), 0) + 1;
  return { id: `ac-${Date.now().toString(36)}-${idCounter++}`, reg: `WP-${String(n).padStart(3, '0')}`, type, legs: [] };
}

/** Append one leg from the aircraft's current position, at its next free time. */
export function withLeg(ac: Aircraft, from: string, to: string): Aircraft {
  return { ...ac, legs: [...ac.legs, { from, to, dep: nextDeparture(ac, from) }] };
}

/** Append a round trip a→b→a to an aircraft, starting at its next free time. */
export function withRoundTrip(ac: Aircraft, a: string, b: string): Aircraft {
  const out = withLeg(ac, a, b);
  return withLeg(out, b, a);
}

/** Would adding a round trip keep this aircraft's day within 24 hours? */
export function canAddRoundTrip(ac: Aircraft, a: string, b: string): boolean {
  const last = ac.legs[ac.legs.length - 1];
  if (last && last.to !== a) return false;
  if (routeProblem(a, b, ac.type)) return false;
  return rotationInfo(withRoundTrip(ac, a, b)).fits;
}

/** Plan with one more daily round trip on a↔b: on an aircraft that has room, otherwise on a newly leased one. */
export function addRoundTrip(plan: Plan, a: string, b: string, type?: AircraftModel): { plan: Plan; aircraftId: string } | { error: string } {
  const t = type ?? defaultAircraft(a, b);
  if (!t) return { error: routeProblem(a, b, 'B77W') ?? '無法開航' };
  const problem = routeProblem(a, b, t);
  if (problem) return { error: problem };
  for (const c of [a, b]) if (weeklyDepartures(plan, c) + 7 > AIRPORT_BY_CODE[c].slotCap) return { error: `${AIRPORT_BY_CODE[c].name}時間帶已滿` };
  // Reuse an aircraft of this type that ends its day at either end and still has time.
  for (const ac of plan.fleet) {
    if (ac.type !== t || !ac.legs.length) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      if (canAddRoundTrip(ac, from, to)) {
        const updated = withRoundTrip(ac, from, to);
        return { plan: { ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? updated : x)) }, aircraftId: ac.id };
      }
    }
  }
  // Otherwise lease one, based at the end that is the player's base (or the bigger airport).
  const size = (c: string) => AIRPORT_BY_CODE[c].catchment;
  const [from, to] = b === plan.base || (a !== plan.base && size(b) > size(a)) ? [b, a] : [a, b];
  const fresh = withRoundTrip(newAircraft(plan, t), from, to);
  return { plan: { ...plan, fleet: [...plan.fleet, fresh] }, aircraftId: fresh.id };
}

/** Distinct airport pairs the plan flies, for drawing routes. */
export function routePairs(plan: Plan): { key: string; a: string; b: string; flightsPerDay: number }[] {
  const m = new Map<string, { key: string; a: string; b: string; flightsPerDay: number }>();
  for (const ac of plan.fleet) for (const l of ac.legs) {
    const key = pairKey(l.from, l.to);
    const [a, b] = key.split('-');
    const r = m.get(key) ?? { key, a, b, flightsPerDay: 0 };
    r.flightsPerDay++;
    m.set(key, r);
  }
  return [...m.values()];
}

/** All flights on a route, for its timetable. */
export function flightsOn(plan: Plan, key: string) {
  const out: { ac: Aircraft; index: number; leg: Leg }[] = [];
  for (const ac of plan.fleet) ac.legs.forEach((leg, index) => { if (pairKey(leg.from, leg.to) === key) out.push({ ac, index, leg }); });
  return out.sort((x, y) => localMinutes(x.leg.from, x.leg.dep) - localMinutes(y.leg.from, y.leg.dep));
}

/** Biggest markets from an airport, with whether the plan already flies them nonstop. */
export function topMarketsFrom(code: string, plan: Plan, limit = 8) {
  const served = new Set(routePairs(plan).filter((r) => r.a === code || r.b === code).map((r) => (r.a === code ? r.b : r.a)));
  const list: { to: string; airDemand: number; distKm: number; served: boolean }[] = [];
  for (const other of Object.keys(AIRPORT_BY_CODE)) {
    if (other === code) continue;
    const m = marketBetween(code, other);
    if (m) list.push({ to: other, airDemand: m.airDemand, distKm: m.distKm, served: served.has(other) });
  }
  return list.sort((x, y) => y.airDemand - x.airDemand).slice(0, limit);
}
