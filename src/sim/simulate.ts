// Weekly network simulation over the player's fleet and daily schedules.
// Pure and deterministic: the same plan always gives the same result.
import { AIRCRAFT, classRank, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../data/airports';
import { airChoice, airUtility, type AirOffer, departureQuality, FARE_SENSITIVITY, fareResponse, groundUtility, noTravelUtility, stayHomeUtility, THETA, timeOfDayQuality, VALUE_OF_TIME } from './choice';
import { rivalsFrom, type RivalService } from './competitors';
import { marketBetween, marketsAt, MIN_MARKET_KM, pairKey, type Market } from './markets';
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
  /** Rotation, in order. It repeats every `cycleDays` days (1 = daily). */
  legs: Leg[];
  /** Days to fly the rotation once. Long-haul aircraft need 2 or 3: a round trip across an ocean takes more than a day. */
  cycleDays?: number;
}

export const MAX_CYCLE_DAYS = 3;
export const cycleOf = (ac: Aircraft) => ac.cycleDays ?? 1;
/** Departures a week of each flight in the rotation. */
export const perWeekOf = (ac: Aircraft) => 7 / cycleOf(ac);

export interface Plan {
  version: 2;
  base: string;
  fleet: Aircraft[];
  /** Fare multiple per market (pairKey), 0.7 to 1.4. Default 1. */
  fares: Record<string, number>;
  /** Optional transfer hub: shorter minimum connections there, for a weekly fee. */
  hub?: string;
}

export const emptyPlan = (base: string): Plan => ({ version: 2, base, fleet: [], fares: {} });

// ---------- Time helpers ----------

export const utcOffsetMin = (a: Airport) => a.utcOffset;
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
export { timeOfDayQuality };

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
  blockMin: number; // per day, averaged over the cycle
  dutyMin: number; // first departure to last arrival + turn
  closed: boolean; // ends where it starts, so it can repeat
  fits: boolean; // fits in the cycle (24 hours x cycleDays)
  utilisation: number; // block hours / hours in the cycle
  cycleDays: number;
}

export function rotationInfo(ac: Aircraft): RotationInfo {
  const cycle = cycleOf(ac);
  if (!ac.legs.length) return { blockMin: 0, dutyMin: 0, closed: true, fits: true, utilisation: 0, cycleDays: cycle };
  let block = 0;
  for (const l of ac.legs) block += blockMinutes(l.from, l.to, ac.type);
  const last = ac.legs[ac.legs.length - 1];
  const end = last.dep + blockMinutes(last.from, last.to, ac.type) + AIRCRAFT[ac.type].turnMin;
  const duty = end - ac.legs[0].dep;
  return { blockMin: block / cycle, dutyMin: duty, closed: last.to === ac.legs[0].from, fits: duty <= cycle * DAY, utilisation: block / (cycle * DAY), cycleDays: cycle };
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
  for (const ac of plan.fleet) for (const l of ac.legs) if (l.from === code) n += perWeekOf(ac);
  return n;
}

// ---------- Simulation ----------

/** How attractive a player flight's times are to travellers (departure, and on long-haul also arrival). */
const flightTimeQuality = (f: Flight) => departureQuality(localMinutes(f.from, f.dep), localMinutes(f.to, f.arr), f.distKm);

interface Flight {
  key: string; // `${acId}#${index}`
  idx: number; // position in the aircraft's rotation
  ac: Aircraft;
  from: string;
  to: string;
  dep: number; // UTC minutes mod DAY
  perWeek: number; // departures a week (7 for a daily rotation)
  arr: number; // dep + block (may exceed DAY)
  seats: number;
  blockH: number;
  distKm: number;
}

interface Itinerary {
  flights: Flight[];
  weight: number; // relative attractiveness (time of day, connection penalty)
  fareShare: number; // of the nonstop fare that this itinerary's travellers pay
  perWeek: number; // departures a week of the itinerary (the rarer of its flights)
  fareMult: number; // the player's fare setting: the route's own, or for a connection the distance-weighted mix of its legs
  wait?: number; // layover minutes, for connections
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
  /** Weekly travellers who wanted this route's flights (onboard + spill), both directions. */
  demand: number;
  spill: number; // weekly travellers who wanted a seat but found the flight full
  loadFactor: number;
  marketShare: number; // of local air travellers
  airTotal: number; // weekly air travellers in this market, all airlines, both directions
  /** Weekly local travellers who chose the player's nonstops, before seats ran out (carried = localPax). */
  localDemand: number;
  /** Weekly travellers who connect on other airlines, where nobody flies these two cities nonstop. */
  connectingPax: number;
  revenue: number; // weekly, prorated from itineraries
  flyingCost: number; // weekly
  /** Where the route's weekly revenue and flying cost come from (they add up to revenue and flyingCost). */
  money: RouteMoney;
  /** Flights a week that were full, with travellers turned away. */
  fullFlights: number;
  fare: number; // one-way local fare
  rivalFreq: number;
  /** Competitor airlines on this route, both directions, weekly. */
  rivals: RouteRival[];
  groundName?: string;
}

export interface RouteMoney {
  /** Fares of travellers flying only this route. */
  localRevenue: number;
  /** This route's part of connecting travellers' fares (split by distance). */
  connectingRevenue: number;
  /** Fuel, crew and maintenance: per block hour. */
  blockCost: number;
  /** Landing, handling and navigation fees: per departure. */
  departureCost: number;
  /** Catering, check-in and airport passenger fees: per traveller. */
  paxCost: number;
  /** Sales, distribution and card fees: a share of fares. */
  salesCost: number;
}

export interface RouteRival {
  id: string;
  freq: number; // flights a week, both directions
  pax: number; // weekly travellers, both directions
  fare: number;
  /** Airport pairs it flies when they differ from this route's (same-city airports), e.g. "KIX-TPE". */
  airports: string[];
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

export interface TransferFlow {
  from: string;
  to: string;
  pax: number; // weekly
  long: number; // of which with a 3 to 8 hour layover
  stopover: number; // of which staying 8 hours or more
}

export interface TransferInfo {
  pax: number;
  long: number;
  stopover: number;
  flows: TransferFlow[];
}

export interface NetworkResult {
  routes: Record<string, RouteResult>;
  aircraft: Record<string, AircraftResult>;
  pax: number; // weekly trips (a connecting trip counts once)
  connectingPax: number;
  /** Weekly connecting travellers per transfer airport, with their origin→destination flows. */
  transfers: Record<string, TransferInfo>;
  hubCost: number;
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
/** Minimum connection when the trip crosses a border at the transfer airport. */
export const MIN_CONNECT_INTL = 70;
/** Extra minutes needed at the biggest hubs (long walks, many terminals). */
export const BIG_AIRPORT_EXTRA = 10;
/** Minutes a transfer hub setting takes off the minimum connection. */
export const HUB_MCT_CUT = 10;
/** What the hub setting costs per week, NT$. */
export const HUB_COST_PER_WEEK = 1_200_000;
const CONNECTION_PENALTY_H = 1;
/** Staying on the same aircraft is nearly as good as flying nonstop. */
const THROUGH_PENALTY_H = 0.3;
/** One-stop travellers pay this share of the nonstop fare for the same trip, with a layover of up to LONG_LAYOVER_MIN. */
export const CONNECT_FARE_SHARE = 0.85;
/** Up to here a layover is an ordinary connection. */
export const LONG_LAYOVER_MIN = 180;
/** From here travellers leave the airport and see the city: the trip becomes a stopover. */
export const STOPOVER_MIN = 480;
/** Each extra hour of a long layover (past LONG_LAYOVER_MIN, before a stopover) takes this much off the fare share. */
export const LAYOVER_DISCOUNT_PER_HOUR = 0.03;
export const MIN_CONNECT_FARE_SHARE = 0.7;
/** Stopover travellers pick the trip partly for the extra city, so they pay close to a normal connection. */
export const STOPOVER_FARE_SHARE = 0.8;
/** A long layover never feels worse than this many hours, and a stopover feels like this less the city's appeal. */
export const MAX_LAYOVER_COST_H = 5.5;

export type LayoverKind = 'quick' | 'long' | 'stopover';
export const layoverKind = (waitMin: number): LayoverKind =>
  waitMin <= LONG_LAYOVER_MIN ? 'quick' : waitMin < STOPOVER_MIN ? 'long' : 'stopover';

/** How many hours of the trip a stopover at this airport is worth to travellers: big, popular cities are worth more. */
export function stopoverAppealHours(code: string): number {
  const a = AIRPORT_BY_CODE[code];
  if (!a) return 0;
  const big = a.catchment >= 5e6 ? 1.5 : a.catchment >= 1e6 ? 1.1 : 0.7; // a city's size, not its airport's traffic
  return big * Math.min(2, Math.max(0.5, a.tourism));
}

/**
 * Hours of waiting a traveller feels at a layover of `waitMin` at `at`. The first 3 hours count in full, later
 * hours count half (people plan around long waits), up to MAX_LAYOVER_COST_H. From STOPOVER_MIN the traveller
 * leaves the airport, so the wait stops growing and the city's appeal makes up part of it.
 */
export function layoverCostHours(waitMin: number, at: string): number {
  const h = waitMin / 60;
  if (waitMin <= LONG_LAYOVER_MIN) return h;
  if (waitMin < STOPOVER_MIN) return Math.min(MAX_LAYOVER_COST_H, LONG_LAYOVER_MIN / 60 + 0.5 * (h - LONG_LAYOVER_MIN / 60));
  return Math.max(2, MAX_LAYOVER_COST_H - stopoverAppealHours(at));
}

/**
 * Any layover is allowed. Up to 3 hours travellers pay 85% of the nonstop fare; long layovers only sell at a
 * discount; stopovers sell close to a normal connection, because travellers pick them for the extra city.
 */
export function connectFareShare(layoverMin: number): number {
  const kind = layoverKind(layoverMin);
  if (kind === 'stopover') return STOPOVER_FARE_SHARE;
  const extraH = Math.max(0, layoverMin - LONG_LAYOVER_MIN) / 60;
  return Math.max(MIN_CONNECT_FARE_SHARE, CONNECT_FARE_SHARE - LAYOVER_DISCOUNT_PER_HOUR * extraH);
}

/**
 * Relative attractiveness of a one-stop trip compared with a nonstop at the same time of day (1 = as good).
 * `blockH` is the hours in the air on both flights together.
 */
export function connectionWeight(blockH: number, waitMin: number, via: string, directKm: number, through = false): number {
  const felt = blockH + (through ? waitMin / 60 : layoverCostHours(waitMin, via));
  const direct = directKm / 820 + 0.5;
  return Math.exp(-THETA * VALUE_OF_TIME * (felt - direct + (through ? THROUGH_PENALTY_H : CONNECTION_PENALTY_H)));
}
/**
 * A one-stop trip may be at most this much longer than the direct distance (3x under 800 km). Detours below this
 * are not forbidden: the extra flying time already costs the itinerary most of its travellers.
 */
export const MAX_DETOUR = 2.5;
export const MAX_DETOUR_SHORT = 3;

/** Shortest workable connection at `code` between a flight arriving from `from` and one leaving for `to`. */
export function minConnect(code: string, from: string, to: string, hub?: string): number {
  const X = AIRPORT_BY_CODE[code];
  const intl = AIRPORT_BY_CODE[from].country !== X.country || AIRPORT_BY_CODE[to].country !== X.country;
  let m = intl ? MIN_CONNECT_INTL : MIN_CONNECT;
  if (X.size === 'hub') m += BIG_AIRPORT_EXTRA;
  if (hub === code) m -= HUB_MCT_CUT;
  return m;
}

export function detourOk(distKm: number, legsKm: number): boolean {
  return legsKm <= distKm * (distKm < 800 ? MAX_DETOUR_SHORT : MAX_DETOUR);
}
/** Per passenger on each flight: check-in, catering and airport passenger fees, NT$. */
export const PAX_COST_PER_SEGMENT = 250;
/** Share of ticket revenue that goes on sales, distribution and card fees. */
export const SALES_COST_SHARE = 0.12;

/** The player's fare multiple on a route (0.7 to 1.4, default 1). */
export const fareMultOf = (plan: Plan, key: string) => plan.fares[key] ?? 1;

function buildFlights(plan: Plan): Flight[] {
  const out: Flight[] = [];
  for (const ac of plan.fleet) {
    const spec = AIRCRAFT[ac.type];
    ac.legs.forEach((l, i) => {
      const A = AIRPORT_BY_CODE[l.from], B = AIRPORT_BY_CODE[l.to];
      const bm = blockMinutes(l.from, l.to, ac.type);
      const dep = mod(l.dep, DAY);
      out.push({ key: `${ac.id}#${i}`, idx: i, ac, from: l.from, to: l.to, dep, perWeek: perWeekOf(ac), arr: dep + bm, seats: spec.seats, blockH: bm / 60, distKm: distanceKm(A.lat, A.lon, B.lat, B.lon) });
    });
  }
  return out;
}

/**
 * Weekly air travellers in one direction of a market, given the utility of everything flying in it. Starts from
 * today's calibrated traffic (other airlines at the reference fare, or one daily flight where nobody flies) and
 * scales it by how much more or less attractive flying has become, with staying home the same distance below
 * air service on every route. Never more than everyone who might travel.
 */
export function respondingAirTotal(m: Market, uAirNow: number, comp: Competition): number {
  const uGround = m.ground ? Math.exp(groundUtility(m.ground)) : 0;
  const share = (uAir: number, uNone: number) => uAir / (uAir + uGround + uNone);
  // Today's service: the market's own, or else flights from other airports in the same cities, or else one daily flight.
  const uBase = Math.exp(m.airDemand > 0 ? airUtility(m.refFare, m.distKm, m.rivalFreq)
    : comp.offers.length ? airChoice(comp.offers, m.distKm, m.refFare).utility : airUtility(m.refFare, m.distKm, 7));
  const today = m.airDemand > 0 ? m.airDemand : m.potential * share(uBase, Math.exp(noTravelUtility(m.refFare, m.distKm)));
  const uStay = Math.exp(stayHomeUtility(m.refFare, m.distKm));
  return Math.min(m.potential, (today * share(Math.exp(uAirNow), uStay)) / share(uBase, uStay));
}

/** Extra cost to travellers, NT$ per end, of flying from another airport in their city instead of this one. */
export const OTHER_AIRPORT_PENALTY = 800;

let metroIndex: Map<string, string[]> | null = null;
/** Airports in the same metro as `code`, including itself. */
export function metroAirports(code: string): string[] {
  if (!metroIndex) {
    metroIndex = new Map();
    for (const a of AIRPORTS) metroIndex.set(a.metro, [...(metroIndex.get(a.metro) ?? []), a.code]);
  }
  return metroIndex.get(AIRPORT_BY_CODE[code].metro) ?? [code];
}

/**
 * Where nobody flies between two cities at all, travellers today connect through a hub on other airlines:
 * modelled as this many flights a week, NT$ CONNECTING_PENALTY worse than a nonstop (a layover of about 2.5 hours).
 */
export const CONNECTING_FREQ = 56;
export const CONNECTING_PENALTY = 1500;

export interface Competition {
  /** Competitor flights; `offers` starts with these in the same order. */
  services: RivalService[];
  /** What travellers can choose besides the player: the services, then any connecting option. */
  offers: AirOffer[];
  /** True when nobody flies these two airports and the competition is other airports in the same cities. */
  otherAirports: boolean;
}

const competitionCache = new Map<string, Competition>();
/**
 * Competitor flights travellers in a market can choose from. Where no airline flies these two airports,
 * travellers fly from other airports in the same cities (e.g. Taipei to Osaka via Kansai when nobody flies
 * to Itami), at a cost for the less convenient airport.
 */
export function competitionFor(o: string, d: string): Competition {
  const k = `${o}>${d}`;
  let c = competitionCache.get(k);
  if (!c) {
    const direct = rivalsFrom(o, d);
    const offer = (r: RivalService) => ({
      freq: r.effFreq, fare: r.fare,
      quality: r.airline.quality - OTHER_AIRPORT_PENALTY * ((r.from !== o ? 1 : 0) + (r.to !== d ? 1 : 0)),
    });
    if (direct.length) c = { services: direct, offers: direct.map(offer), otherAirports: false };
    else {
      const services: RivalService[] = [];
      for (const x of metroAirports(o)) for (const y of metroAirports(d)) if (x !== o || y !== d) services.push(...rivalsFrom(x, y));
      const m = marketBetween(o, d);
      // Travellers can always change planes somewhere on other airlines, as well as fly from the other airports.
      const offers = [...services.map(offer), ...(m ? [{ freq: CONNECTING_FREQ, fare: m.refFare, quality: -CONNECTING_PENALTY }] : [])];
      c = { services, offers, otherAirports: services.length > 0 };
    }
    competitionCache.set(k, c);
  }
  return c;
}

/**
 * How one direction of a market splits today, without the player: weekly travellers per competitor service
 * (same order as `competitionFor(o, d).services`) and on connections via other airlines.
 */
export function todaySplit(o: string, d: string): { total: number; rivals: number[]; connecting: number } {
  const m = marketBetween(o, d);
  const comp = competitionFor(o, d);
  if (!m || !comp.offers.length) return { total: 0, rivals: comp.services.map(() => 0), connecting: 0 };
  const ch = airChoice(comp.offers, m.distKm, m.refFare);
  // Where nobody flies these two airports, today's travellers are the ones using other airports or connections.
  const total = m.airDemand > 0 ? m.airDemand : respondingAirTotal(m, ch.utility, comp);
  const rivals = comp.services.map((_, i) => total * ch.shares[i]);
  const connecting = total * ch.shares.slice(comp.services.length).reduce((s, x) => s + x, 0);
  return { total, rivals, connecting };
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
    const mult1 = fareMultOf(plan, pairKey(f1.from, f1.to));
    add(f1.from, f1.to, { flights: [f1], weight: flightTimeQuality(f1), fareShare: 1, fareMult: mult1, perWeek: f1.perWeek });
    for (const f2 of byFrom.get(f1.to) ?? []) {
      if (AIRPORT_BY_CODE[f2.to].metro === AIRPORT_BY_CODE[f1.from].metro) continue;
      const through = f2.ac === f1.ac && f2.idx === f1.idx + 1;
      const wait = mod(f2.dep - f1.arr, DAY);
      if (wait < (through ? 0 : minConnect(f1.to, f1.from, f2.to, plan.hub))) continue;
      const m = marketBetween(f1.from, f2.to);
      if (!m || !detourOk(m.distKm, f1.distKm + f2.distKm)) continue;
      // Extra time versus flying nonstop, valued in the same units as fares. Long waits and stopovers count less than in full.
      const penalty = connectionWeight(f1.blockH + f2.blockH, wait, f1.to, m.distKm, through);
      // Connecting fares follow the fares the player sets on the legs, weighted by distance.
      const mult = (mult1 * f1.distKm + fareMultOf(plan, pairKey(f2.from, f2.to)) * f2.distKm) / (f1.distKm + f2.distKm);
      add(f1.from, f2.to, { flights: [f1, f2], weight: flightTimeQuality(f1) * penalty, fareShare: connectFareShare(through ? 0 : wait), fareMult: mult, wait: through ? 0 : wait, perWeek: Math.min(f1.perWeek, f2.perWeek) });
    }
  }

  // Demand per itinerary (daily).
  const demand = new Map<Itinerary, number>();
  const marketInfo = new Map<string, { airTotal: number; refFare: number; mine: number; connecting: number; rivals: { id: string; pax: number }[] }>();
  for (const [k, list] of itins) {
    const [o, d] = k.split('>');
    const m = marketBetween(o, d);
    if (!m) continue;
    // An itinerary that runs less often than daily attracts proportionally fewer travellers.
    // Each itinerary's weight, after travellers' reaction to its price versus that itinerary's usual price.
    const priced = new Map(list.map((it) => [it, it.weight * (it.perWeek / 7) * Math.exp(-it.fareShare * fareResponse(it.fareMult * m.refFare, m.refFare))]));
    const wSum = list.reduce((s, it) => s + it.weight * (it.perWeek / 7), 0);
    const pSum = [...priced.values()].reduce((s, w) => s + w, 0);
    // One fare that has the same pull as the player's mix of itineraries and prices.
    const fare = m.refFare * (1 - Math.log(pSum / wSum) / FARE_SENSITIVITY);
    const comp = competitionFor(o, d);
    const rivals = comp.services;
    const air = airChoice([{ freq: 7 * wSum, fare }, ...comp.offers], m.distKm, m.refFare);
    const airTotal = respondingAirTotal(m, air.utility, comp);
    const mine = (airTotal * air.shares[0]) / 7;
    for (const it of list) demand.set(it, (mine * priced.get(it)!) / pSum);
    const connecting = airTotal * air.shares.slice(rivals.length + 1).reduce((s, x) => s + x, 0);
    marketInfo.set(k, { airTotal, refFare: m.refFare, mine: mine * 7, connecting, rivals: rivals.map((r, i) => ({ id: r.airline.id, pax: airTotal * air.shares[i + 1] })) });
  }

  // Capacity: where a flight is oversold, everyone who wants it (local and connecting) loses seats in the same
  // proportion. Each flight accepts a share of the travellers who want it; a connection gets the smaller share of
  // its two flights, and seats a connection can't use on one flight go back to the others on the next pass.
  const accept = new Map<Flight, number>(flights.map((f) => [f, 1]));
  const carried = new Map<Itinerary, number>();
  const load = () => {
    for (const [it, n] of demand) carried.set(it, n * Math.min(...it.flights.map((f) => accept.get(f)!)));
    const onboard = new Map<Flight, number>();
    for (const [it, n] of carried) for (const f of it.flights) onboard.set(f, (onboard.get(f) ?? 0) + n);
    return onboard;
  };
  for (let pass = 0; pass < 12; pass++) {
    const onboard = load();
    for (const f of flights) {
      const n = onboard.get(f) ?? 0;
      if (n > 0) accept.set(f, Math.min(1, (accept.get(f)! * f.seats) / n));
    }
  }
  // Never more travellers than seats.
  const finalLoad = load();
  for (const [it, n] of carried) carried.set(it, n * Math.min(1, ...it.flights.map((f) => f.seats / Math.max(finalLoad.get(f) ?? 0, f.seats))));

  // Tally per flight.
  const flightPax = new Map<Flight, number>();
  const flightRevenue = new Map<Flight, number>();
  const flightLocalRevenue = new Map<Flight, number>();
  const flightSpill = new Map<Flight, number>();
  let tripsWeekly = 0, connectingWeekly = 0, revenueWeekly = 0;
  const transferFlows = new Map<string, { pax: number; long: number; stopover: number }>(); // `${via}|${o}|${d}`
  for (const [k, list] of itins) {
    const info = marketInfo.get(k);
    if (!info) continue;
    for (const it of list) {
      const n = carried.get(it) ?? 0;
      const want = demand.get(it) ?? 0;
      tripsWeekly += n * it.perWeek;
      const fare = Math.round(info.refFare * it.fareMult) * it.fareShare;
      if (it.flights.length > 1) {
        connectingWeekly += n * it.perWeek;
        const tk = `${it.flights[0].to}|${it.flights[0].from}|${it.flights[1].to}`;
        const tf = transferFlows.get(tk) ?? { pax: 0, long: 0, stopover: 0 };
        tf.pax += n * it.perWeek;
        const kind = layoverKind(it.wait ?? 0);
        if (kind !== 'quick') tf[kind] += n * it.perWeek;
        transferFlows.set(tk, tf);
      }
      revenueWeekly += n * fare * it.perWeek;
      const dist = it.flights.reduce((s, f) => s + f.distKm, 0);
      for (const f of it.flights) {
        flightPax.set(f, (flightPax.get(f) ?? 0) + n);
        flightRevenue.set(f, (flightRevenue.get(f) ?? 0) + (n * fare * f.distKm) / dist);
        if (it.flights.length === 1) flightLocalRevenue.set(f, (flightLocalRevenue.get(f) ?? 0) + n * fare);
        flightSpill.set(f, (flightSpill.get(f) ?? 0) + (want - n) / it.flights.length);
      }
    }
  }

  const flightCost = (f: Flight) => {
    const spec = AIRCRAFT[f.ac.type];
    return f.blockH * spec.costPerBlockHour + spec.costPerDeparture
      + (flightPax.get(f) ?? 0) * PAX_COST_PER_SEGMENT + (flightRevenue.get(f) ?? 0) * SALES_COST_SHARE;
  };

  const routes: Record<string, RouteResult> = {};
  for (const f of flights) {
    const key = pairKey(f.from, f.to);
    let r = routes[key];
    if (!r) {
      const m = marketBetween(f.from, f.to);
      const [a, b] = key.split('-');
      let localPax = 0, airTotal = 0, localDemand = 0, connectingPax = 0;
      const rivals = new Map<string, RouteRival>();
      for (const lk of [`${a}>${b}`, `${b}>${a}`]) {
        for (const it of itins.get(lk) ?? []) if (it.flights.length === 1) localPax += it.perWeek * (carried.get(it) ?? 0);
        const info = marketInfo.get(lk);
        const [o, d] = lk.split('>');
        const comp = competitionFor(o, d);
        const services = comp.services;
        // A direction the player doesn't fly: competitors keep today's split.
        const today = info ? null : todaySplit(o, d);
        airTotal += info?.airTotal ?? today!.total; // weekly
        localDemand += info?.mine ?? 0;
        connectingPax += info?.connecting ?? today!.connecting;
        const paxOf = info ? (i: number) => info.rivals[i]?.pax ?? 0 : (i: number) => today!.rivals[i];
        services.forEach((sv, i) => {
          const rr = rivals.get(sv.airline.id) ?? { id: sv.airline.id, freq: 0, pax: 0, fare: sv.fare, airports: [] };
          rr.freq += sv.freq;
          rr.pax += paxOf(i);
          const pk = pairKey(sv.from, sv.to);
          if (pk !== key && !rr.airports.includes(pk)) rr.airports.push(pk);
          rivals.set(sv.airline.id, rr);
        });
      }
      r = routes[key] = {
        key, a, b, distKm: f.distKm, flightsPerWeek: 0, seats: 0, pax: 0, localPax, demand: 0, spill: 0, loadFactor: 0,
        marketShare: airTotal > 0 ? localPax / airTotal : 0, airTotal, localDemand, connectingPax, revenue: 0, flyingCost: 0,
        money: { localRevenue: 0, connectingRevenue: 0, blockCost: 0, departureCost: 0, paxCost: 0, salesCost: 0 }, fullFlights: 0,
        fare: Math.round((m?.refFare ?? 0) * fareMultOf(plan, key)), rivalFreq: m?.rivalFreq ?? 0, rivals: [...rivals.values()].sort((x, y) => y.pax - x.pax), groundName: m?.ground?.name,
      };
    }
    r.flightsPerWeek += f.perWeek;
    r.seats += f.perWeek * f.seats;
    r.pax += f.perWeek * (flightPax.get(f) ?? 0);
    r.spill += f.perWeek * (flightSpill.get(f) ?? 0);
    r.revenue += f.perWeek * (flightRevenue.get(f) ?? 0);
    r.flyingCost += f.perWeek * flightCost(f);
    const spec = AIRCRAFT[f.ac.type];
    const rev = flightRevenue.get(f) ?? 0, local = flightLocalRevenue.get(f) ?? 0;
    r.money.localRevenue += f.perWeek * local;
    r.money.connectingRevenue += f.perWeek * (rev - local);
    r.money.blockCost += f.perWeek * f.blockH * spec.costPerBlockHour;
    r.money.departureCost += f.perWeek * spec.costPerDeparture;
    r.money.paxCost += f.perWeek * (flightPax.get(f) ?? 0) * PAX_COST_PER_SEGMENT;
    r.money.salesCost += f.perWeek * rev * SALES_COST_SHARE;
    if ((flightSpill.get(f) ?? 0) > 0.5) r.fullFlights += f.perWeek;
  }
  for (const r of Object.values(routes)) {
    r.loadFactor = r.seats ? r.pax / r.seats : 0;
    r.demand = r.pax + r.spill;
  }

  const aircraft: Record<string, AircraftResult> = {};
  for (const ac of plan.fleet) {
    const info = rotationInfo(ac);
    aircraft[ac.id] = { id: ac.id, blockHoursPerDay: info.blockMin / 60, utilisation: info.utilisation, pax: 0, seats: 0, revenue: 0, flyingCost: 0, ownershipCost: AIRCRAFT[ac.type].ownershipPerWeek };
  }
  for (const f of flights) {
    const a = aircraft[f.ac.id];
    a.pax += f.perWeek * (flightPax.get(f) ?? 0);
    a.seats += f.perWeek * f.seats;
    a.revenue += f.perWeek * (flightRevenue.get(f) ?? 0);
    a.flyingCost += f.perWeek * flightCost(f);
  }

  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const acs = Object.values(aircraft);
  const flyingCost = sum(acs.map((a) => a.flyingCost));
  const ownershipCost = sum(acs.map((a) => a.ownershipCost));
  const seats = sum(acs.map((a) => a.seats));
  const onboard = sum(acs.map((a) => a.pax));
  const revenue = revenueWeekly;
  const hubCost = plan.hub && AIRPORT_BY_CODE[plan.hub] ? HUB_COST_PER_WEEK : 0;
  const cost = flyingCost + ownershipCost + hubCost;
  const transfers: NetworkResult['transfers'] = {};
  for (const [k, tf] of transferFlows) {
    const [via, from, to] = k.split('|');
    const t = (transfers[via] ??= { pax: 0, long: 0, stopover: 0, flows: [] });
    t.pax += tf.pax;
    t.long += tf.long;
    t.stopover += tf.stopover;
    t.flows.push({ from, to, ...tf });
  }
  for (const t of Object.values(transfers)) t.flows.sort((x, y) => y.pax - x.pax);
  return {
    routes,
    aircraft,
    pax: tripsWeekly,
    connectingPax: connectingWeekly,
    transfers,
    hubCost,
    seats,
    revenue,
    flyingCost,
    ownershipCost,
    cost,
    costRecovery: cost > 0 ? revenue / cost : 0,
    loadFactor: seats > 0 ? onboard / seats : 0,
    fleet: plan.fleet.length,
    flights: flights.reduce((n, f) => n + f.perWeek, 0),
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
  let fresh = withRoundTrip(newAircraft(plan, t), from, to);
  // A round trip that takes more than a day runs every second or third day instead.
  const duty = rotationInfo(fresh).dutyMin;
  if (duty > DAY) {
    if (duty > MAX_CYCLE_DAYS * DAY) return { error: '來回飛行時間超過三天' };
    fresh = { ...fresh, cycleDays: Math.ceil(duty / DAY) };
  }
  return { plan: { ...plan, fleet: [...plan.fleet, fresh] }, aircraftId: fresh.id };
}

/** Distinct airport pairs the plan flies, for drawing routes. */
export function routePairs(plan: Plan): { key: string; a: string; b: string; flightsPerDay: number }[] {
  const m = new Map<string, { key: string; a: string; b: string; flightsPerDay: number }>();
  for (const ac of plan.fleet) for (const l of ac.legs) {
    const key = pairKey(l.from, l.to);
    const [a, b] = key.split('-');
    const r = m.get(key) ?? { key, a, b, flightsPerDay: 0 };
    r.flightsPerDay += 1 / cycleOf(ac);
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
  for (const m of marketsAt(code)) {
    const other = m.a === code ? m.b : m.a;
    list.push({ to: other, airDemand: m.airDemand, distKm: m.distKm, served: served.has(other) });
  }
  return list.sort((x, y) => y.airDemand - x.airDemand).slice(0, limit);
}
