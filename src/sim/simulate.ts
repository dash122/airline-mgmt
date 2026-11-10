// Weekly network simulation over the player's fleet and daily schedules.
// Pure and deterministic: the same plan always gives the same result.
import { AIRCRAFT, classRank, type AircraftModel, type AircraftSpec } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../data/airports';
import { airChoice, airUtility, type AirOffer, departureQuality, FARE_SENSITIVITY, fareResponse, groundUtility, noTravelUtility, stayHomeUtility, THETA, timeOfDayQuality, VALUE_OF_TIME } from './choice';
import { airlines, rivalsAt, rivalsBetween, rivalsFrom, type Airline, type RivalService } from './competitors';
import { marketBetween, marketsAt, MIN_MARKET_KM, pairKey, refFare, type Market } from './markets';
import { distanceKm } from './geo';
import { flightMinutes, typicalFlightHours } from './flighttime';
import { airlineNetwork } from './networks';

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
  /** Competitor routes the player sells seats on, as connections with its own flights. */
  codeshares?: Codeshare[];
  /** The player's own routes that a partner sells, as connections with the partner's own network (key = player route). */
  hosted?: Codeshare[];
}

/** A codeshare on one competitor route (both directions): the player sells seats on it to connect with its own flights. */
export interface Codeshare {
  /** The partner airline's id. */
  airline: string;
  /** The route, as pairKey. */
  key: string;
  /** Share of each partner flight's seats the player may sell (one of CODESHARE_SHARES). Default CODESHARE_SEAT_SHARE. */
  seatShare?: number;
}

// ---------- Codeshare terms ----------
// Kept simple: the partner gives the player a block of seats on every flight of the route, and the player sells them
// only as part of a trip that also flies one of its own flights (feed). The ticket is split in proportion to the two
// flights' own reference fares: the player keeps its own flight's part and the partner gets its flight's part. The player
// pays a flat weekly fee per codeshare route (sales, IT, ground handling agreements).

/** Share of each partner flight's seats the player may sell, unless the codeshare sets its own. */
export const CODESHARE_SEAT_SHARE = 0.2;
/** Seat blocks the player can ask for. */
export const CODESHARE_SHARES = [0.1, 0.2, 0.3, 0.4] as const;
/**
 * What one codeshare route costs per week, NT$: a fixed part (sales, IT, ground handling agreements) plus a part that
 * grows with the seat block. A bigger block costs more but less per seat.
 */
export const codeshareFee = (share: number) => Math.round(60_000 + 450_000 * share);
/** The fee for the default block. */
export const CODESHARE_FEE_PER_WEEK = codeshareFee(CODESHARE_SEAT_SHARE);
export const shareOf = (cs: Pick<Codeshare, 'seatShare'>) => cs.seatShare ?? CODESHARE_SEAT_SHARE;
/** Low-cost airlines don't sell connections, and so don't codeshare. */
export const canCodeshare = (a: Airline) => a.kind !== 'low' && a.id !== 'other';

/** One partner departure the player can sell seats on. Times in UTC minutes mod DAY. */
export interface PartnerFlight {
  /** The codeshare's route (pairKey). */
  key: string;
  airline: string;
  from: string;
  to: string;
  dep: number;
  block: number;
  /** Departures a week at this time. */
  perWeek: number;
  /** Seats the player may sell on each departure. */
  seats: number;
  type: AircraftModel;
  /** Set on a partner's own flight that feeds a player route the partner sells (that route's pairKey). */
  hosted?: string;
}

const codeshareIndex = new Map<string, PartnerFlight[]>();
/** The partner flights of one codeshare, both directions. Empty when the airline doesn't fly the route (or can't codeshare). */
export function partnerFlights(cs: Codeshare): PartnerFlight[] {
  const share = shareOf(cs);
  const k = `${cs.airline}|${cs.key}|${share}`;
  let list = codeshareIndex.get(k);
  if (!list) {
    list = [];
    const [a, b] = cs.key.split('-');
    if (AIRPORT_BY_CODE[a] && AIRPORT_BY_CODE[b]) {
      for (const s of rivalsBetween(a, b)) {
        if (s.airline.id !== cs.airline || !canCodeshare(s.airline) || !s.times.length) continue;
        const perWeek = Math.min(7, s.freq / s.times.length);
        const seats = Math.round(AIRCRAFT[s.type].seats * share);
        for (const t of s.times) {
          list.push({ key: cs.key, airline: s.airline.id, from: s.from, to: s.to, dep: mod(utcFromLocal(s.from, t), DAY), block: blockMinutes(s.from, s.to, s.type), perWeek, seats, type: s.type });
        }
      }
    }
    codeshareIndex.set(k, list);
  }
  return list;
}

// ---------- Partners selling the player's routes ----------
// The other way round: a partner sells a block of seats on one of the player's routes to its own travellers, who
// connect to or from any of the partner's flights at either end. The ticket is split the same way (by the legs'
// reference fares); the player books its own leg. The player pays a small weekly handling cost per route and partner.

/** Weekly handling cost (check-in, transfers, settlement) for one partner selling one of the player's routes, NT$. */
export const HOSTED_FEE_PER_WEEK = 50_000;

const hostedIndex = new Map<string, PartnerFlight[]>();
/**
 * The partner's flights that can feed a player route it sells: every flight of the partner to or from either end of
 * the route (not the route itself). Seats are the partner's whole plane; the limit is the block on the player's flight.
 */
export function feederFlights(cs: Codeshare): PartnerFlight[] {
  const k = `${cs.airline}|${cs.key}`;
  let list = hostedIndex.get(k);
  if (!list) {
    list = [];
    const [a, b] = cs.key.split('-');
    const airline = airlines().find((x) => x.id === cs.airline);
    if (AIRPORT_BY_CODE[a] && AIRPORT_BY_CODE[b] && airline && canCodeshare(airline)) {
      for (const end of [a, b]) {
        for (const other of rivalAirports(cs.airline, end)) {
          if (pairKey(end, other) === cs.key) continue;
          for (const s of rivalsBetween(end, other)) {
            if (s.airline.id !== cs.airline || !s.times.length) continue;
            const perWeek = Math.min(7, s.freq / s.times.length);
            for (const t of s.times) {
              list.push({ key: pairKey(s.from, s.to), airline: cs.airline, from: s.from, to: s.to, dep: mod(utcFromLocal(s.from, t), DAY), block: blockMinutes(s.from, s.to, s.type), perWeek, seats: AIRCRAFT[s.type].seats, type: s.type, hosted: cs.key });
            }
          }
        }
      }
    }
    hostedIndex.set(k, list);
  }
  return list;
}
/** Airports one airline flies to from `code`. */
function rivalAirports(airlineId: string, code: string): string[] {
  const net = airlineNetwork(airlineId);
  if (!net) return [];
  return net.routes.filter((r) => r.a === code || r.b === code).map((r) => (r.a === code ? r.b : r.a));
}
export const isHosted = (plan: Plan, airline: string, key: string) => !!plan.hosted?.some((c) => c.airline === airline && c.key === key);
export const hostedShare = (plan: Plan, airline: string, key: string) => {
  const c = plan.hosted?.find((x) => x.airline === airline && x.key === key);
  return c ? shareOf(c) : null;
};
export function toggleHosted(plan: Plan, airline: string, key: string): Plan {
  const list = plan.hosted ?? [];
  return { ...plan, hosted: isHosted(plan, airline, key) ? list.filter((c) => c.airline !== airline || c.key !== key) : [...list, { airline, key }] };
}
/** Lets the partner sell this block of each flight on the route (starting it if needed). */
export function setHostedShare(plan: Plan, airline: string, key: string, share: number): Plan {
  const cs: Codeshare = share === CODESHARE_SEAT_SHARE ? { airline, key } : { airline, key, seatShare: share };
  const list = plan.hosted ?? [];
  return { ...plan, hosted: isHosted(plan, airline, key) ? list.map((c) => (c.airline === airline && c.key === key ? cs : c)) : [...list, cs] };
}

/** Every partner flight in the plan's codeshares. */
export const codeshareFlights = (plan: Plan): PartnerFlight[] => (plan.codeshares ?? []).flatMap(partnerFlights);
export const hasCodeshare = (plan: Plan, airline: string, key: string) => !!plan.codeshares?.some((c) => c.airline === airline && c.key === key);
export function toggleCodeshare(plan: Plan, airline: string, key: string): Plan {
  const list = plan.codeshares ?? [];
  const next = hasCodeshare(plan, airline, key) ? list.filter((c) => c.airline !== airline || c.key !== key) : [...list, { airline, key }];
  return { ...plan, codeshares: next };
}
/** The codeshare's seat block, or null when it isn't in the plan. */
export const codeshareShare = (plan: Plan, airline: string, key: string) => {
  const c = plan.codeshares?.find((x) => x.airline === airline && x.key === key);
  return c ? shareOf(c) : null;
};
/** Starts the codeshare (if needed) with this seat block. The default block isn't stored. */
export function setCodeshareShare(plan: Plan, airline: string, key: string, share: number): Plan {
  const cs: Codeshare = share === CODESHARE_SEAT_SHARE ? { airline, key } : { airline, key, seatShare: share };
  const list = plan.codeshares ?? [];
  return { ...plan, codeshares: hasCodeshare(plan, airline, key) ? list.map((c) => (c.airline === airline && c.key === key ? cs : c)) : [...list, cs] };
}
/** The partner airline's name. */
export const airlineName = (id: string) => airlines().find((a) => a.id === id)?.name ?? id;

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
  // Taxiing, climb and descent, airways a little longer than the great circle, and the jet stream (flighttime.ts).
  return flightMinutes(AIRPORT_BY_CODE[a], AIRPORT_BY_CODE[b], AIRCRAFT[type].speedKmh);
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
  if (spec.minRunwayM && Math.min(A.runwayM, B.runwayM) < spec.minRunwayM) return '跑道太短，無法起降此機型';
  return null;
}

/** Whether an airport's runway is long enough for a type: its size class, then any extra length the type needs. */
export const runwayFits = (spec: AircraftSpec, airport: Airport) => classRank(spec.cls) <= classRank(airport.maxClass)
  && (spec.minRunwayM === undefined || airport.runwayM >= spec.minRunwayM);

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
  /** A codeshare partner's flight (not the player's own). */
  partner?: PartnerFlight;
  /** A partner's seat block on one of the player's flights (not a real flight; only limits the partner's sales). */
  blockOf?: Flight;
}

interface Itinerary {
  flights: Flight[];
  weight: number; // relative attractiveness (time of day, connection penalty)
  fareShare: number; // of the nonstop fare that this itinerary's travellers pay
  perWeek: number; // departures a week of the itinerary (the rarer of its flights)
  fareMult: number; // the player's fare setting: the route's own, or for a connection the distance-weighted mix of its legs
  wait?: number; // layover minutes, for connections
  /** Layover minutes at each stop, for trips with two stops (0 where the traveller stays on the same aircraft). */
  waits?: number[];
  /** The partner's seat block on the player's flight, for trips a partner sells. */
  block?: Flight;
  /** What the tally needs that depends only on the itinerary's flights, worked out the first time it is tallied. */
  fixed?: ItineraryFixed;
  /** Position in its structure, for the per-itinerary arrays of a simulation (set when the structure is built). */
  idx?: number;
  /** Its legs' (and seat block's) positions in the capacity arrays, worked out once per structure. */
  legSlots?: number[];
}

interface ItineraryFixed {
  dist: number;
  ownKm: number;
  partnerLeg: Flight | undefined;
  partnerShare: number;
  /** transferFlows keys, one per stop. */
  transferKeys: string[];
  journeyKey: string;
  journeyPath: string[];
}

function fixedOf(it: Itinerary): ItineraryFixed {
  if (it.fixed) return it.fixed;
  const fl = it.flights;
  let dist = 0, ownKm = 0, refSum = 0;
  let partnerLeg: Flight | undefined;
  for (const f of fl) { dist += f.distKm; refSum += refFare(f.distKm); if (f.partner) partnerLeg ??= f; else ownKm += f.distKm; }
  const origin = fl[0].from, dest = fl[fl.length - 1].to;
  const transferKeys: string[] = [];
  if (fl.length > 1) {
    const route = fl.length > 2 ? `|${[origin, ...fl.slice(0, -1).map((f) => f.to), dest].join('>')}` : '';
    for (let i = 0; i < fl.length - 1; i++) transferKeys.push(`${fl[i].to}|${origin}|${dest}${route}`);
  }
  const stops = [origin, ...fl.map((f) => f.to)];
  const fwd = stops.join('>'), back = [...stops].reverse().join('>');
  return (it.fixed = {
    dist, ownKm, partnerLeg, partnerShare: partnerLeg ? refFare(partnerLeg.distKm) / refSum : 0, transferKeys,
    journeyKey: fwd <= back ? fwd : back, journeyPath: fwd <= back ? stops : [...stops].reverse(),
  });
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
  /** Each scheduled flight on the route, both directions. */
  flights: FlightResult[];
}

/** One scheduled flight (one leg of one aircraft's rotation). Counts are per departure, not per week. */
export interface FlightResult {
  key: string; // `${acId}#${index}`
  acId: string;
  index: number; // leg index in the aircraft's rotation
  from: string;
  to: string;
  dep: number; // UTC minutes mod DAY
  perWeek: number; // departures a week
  seats: number;
  pax: number; // onboard, local + connecting
  localPax: number;
  connectingPax: number;
  /** Travellers who wanted this departure but found it full. */
  spill: number;
  loadFactor: number;
  revenue: number; // this flight's share of fares
  cost: number; // flying cost, without aircraft rent
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
  /** Per-flight results, by leg index in the rotation. */
  flights: FlightResult[];
}

export interface TransferFlow {
  from: string;
  to: string;
  /** For a trip with two stops: every airport it stops at, origin and destination included. */
  stops?: string[];
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

/** One direction of a market the player serves (nonstop or by connecting on its own flights), weekly. */
export interface MarketResult {
  /** Air travellers in this direction, all airlines. */
  airTotal: number;
  /** Travellers connecting on other airlines. */
  connecting: number;
  /** Per competitor service, in the order of competitionFor(o, d).services. */
  rivals: { id: string; pax: number }[];
  /** Per competitor connection, in the order of competitionFor(o, d).connections. */
  rivalVia: { id: string; via: string; pax: number }[];
  /** Travellers carried on the player's nonstops. */
  nonstop: number;
  /** Travellers carried on the player's connections, per transfer airport. */
  via: Record<string, number>;
  /** Travellers who chose the player (before seats ran out). */
  wanted: number;
}

/** One codeshare route, weekly, both directions. */
export interface CodeshareResult {
  key: string;
  airline: string;
  /** Flights a week, both directions. */
  flights: number;
  /** Seats a week the player may sell. */
  seats: number;
  /** The player's travellers on the partner's flights. */
  pax: number;
  /** Fares those travellers paid for the player's own flights (the player keeps these). */
  feedRevenue: number;
  /** Fares paid for the partner's flights (the partner keeps these). */
  partnerRevenue: number;
  fee: number;
  /** Travellers who wanted these seats, before the seat block ran out (pax ≤ wanted). */
  wanted: number;
  /** Biggest city pairs it connects, weekly travellers both directions. */
  markets: { o: string; d: string; via: string; pax: number }[];
  /**
   * The biggest whole journeys that use the partner's flight, weekly travellers both directions. `path` is every airport
   * from start to finish (both directions are one journey, read it either way). The partner's flight is the leg that
   * matches `key`; the other legs are the player's own flights.
   */
  journeys: { path: string[]; pax: number }[];
  /** The player's own routes these travellers also fly, with how many (weekly, both directions) and the fares they paid for them. */
  feeds: { key: string; pax: number; revenue: number }[];
  /** Seat block in use (share of each partner flight). */
  share: number;
  /** Each partner departure, in time order per direction. */
  departures: CodeshareDeparture[];
}

/** A partner selling one of the player's routes, weekly, both directions. */
export interface HostedResult {
  key: string;
  airline: string;
  share: number;
  /** Seats a week in the partner's block on your flights. */
  seats: number;
  /** The partner's travellers on your flights. */
  pax: number;
  /** Travellers who wanted these seats (before the block or your flight ran out). */
  wanted: number;
  /** Your part of their fares. */
  revenue: number;
  /** The partner's part. */
  partnerRevenue: number;
  fee: number;
  markets: { o: string; d: string; via: string; pax: number }[];
  /** The partner's routes that bring them, weekly travellers. */
  sources: { key: string; pax: number }[];
}

/** One partner departure of a codeshare. Times in UTC minutes; pax, wanted and seats per departure. */
export interface CodeshareDeparture {
  from: string;
  to: string;
  dep: number;
  arr: number;
  perWeek: number;
  seats: number;
  pax: number;
  wanted: number;
  /** How many of the player's own flights connect with it (before or after). Zero: nobody can use it. */
  links: number;
  /** The own flight that brings it the most travellers: from, to and departure (UTC). */
  top?: { from: string; to: string; dep: number; pax: number };
}

export interface NetworkResult {
  routes: Record<string, RouteResult>;
  /** The plan's codeshares, by `${airline}|${key}`. */
  codeshares: Record<string, CodeshareResult>;
  /** Weekly fees for all codeshares, both ways (partner routes you sell and your routes partners sell). */
  codeshareCost: number;
  /** Your routes that partners sell, by `${airline}|${key}`. */
  hosted: Record<string, HostedResult>;
  /** Markets the player serves, per direction (`${o}>${d}`). */
  markets: Record<string, MarketResult>;
  /** Every scheduled flight, by `${acId}#${legIndex}`. */
  byFlight: Record<string, FlightResult>;
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

export const MIN_CONNECT = 35;
/** Minimum connection when the trip crosses a border at the transfer airport. */
export const MIN_CONNECT_INTL = 55;
/** Extra minutes needed at the biggest hubs (long walks, many terminals). */
export const BIG_AIRPORT_EXTRA = 10;
/** Minutes a transfer hub setting takes off the minimum connection. */
export const HUB_MCT_CUT = 15;
/** What the hub setting costs per week, NT$. */
export const HUB_COST_PER_WEEK = 1_200_000;
/** The bother of changing planes, in hours, on top of the wait itself. */
const CONNECTION_PENALTY_H = 0.6;
/** Staying on the same aircraft is nearly as good as flying nonstop. */
const THROUGH_PENALTY_H = 0.3;
/** One-stop travellers pay this share of the nonstop fare for the same trip, with a layover of up to LONG_LAYOVER_MIN. */
export const CONNECT_FARE_SHARE = 0.85;
/** Up to here a layover is an ordinary connection. */
export const LONG_LAYOVER_MIN = 240;
/** Waiting counts in full only up to here; later hours feel half as long (travellers plan around them). */
export const FULL_WAIT_MIN = 120;
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
 * Hours of waiting a traveller feels at a layover of `waitMin` at `at`. The first 2 hours count in full, later
 * hours count half (people plan around long waits), up to MAX_LAYOVER_COST_H. From STOPOVER_MIN the traveller
 * leaves the airport, so the wait stops growing and the city's appeal makes up part of it.
 */
export function layoverCostHours(waitMin: number, at: string): number {
  const h = waitMin / 60;
  if (waitMin <= FULL_WAIT_MIN) return h;
  if (waitMin < STOPOVER_MIN) return Math.min(MAX_LAYOVER_COST_H, FULL_WAIT_MIN / 60 + 0.5 * (h - FULL_WAIT_MIN / 60));
  return Math.max(2, MAX_LAYOVER_COST_H - stopoverAppealHours(at));
}

/**
 * Any layover is allowed. Up to 4 hours travellers pay 85% of the nonstop fare; long layovers only sell at a
 * discount; stopovers sell close to a normal connection, because travellers pick them for the extra city.
 */
export function connectFareShare(layoverMin: number): number {
  const kind = layoverKind(layoverMin);
  if (kind === 'stopover') return STOPOVER_FARE_SHARE;
  const extraH = Math.max(0, layoverMin - LONG_LAYOVER_MIN) / 60;
  return Math.max(MIN_CONNECT_FARE_SHARE, CONNECT_FARE_SHARE - LAYOVER_DISCOUNT_PER_HOUR * extraH);
}

/** Up to this fare (about 1,350 km) an extra hour on a connection costs its full value of time. */
export const CONNECT_TIME_FULL_FARE = 5000;
/** How fast that falls on pricier trips: 0.75 of it at NT$8,000 (Taipei-Bangkok), 0.65 at NT$27,000 (Taipei-London). */
const CONNECT_TIME_EXP = 0.25;

/**
 * Log weight a connection loses per extra hour versus flying nonstop. On short trips an hour is a big part of the
 * journey; on long, expensive trips travellers mind it less next to what they pay, so connections through a hub win
 * a real slice of long-haul markets (Taipei-London via Hong Kong or Dubai), as they do in reality.
 */
export function connectionHourCost(directKm: number): number {
  return THETA * VALUE_OF_TIME * Math.min(1, (CONNECT_TIME_FULL_FARE / refFare(directKm)) ** CONNECT_TIME_EXP);
}

/**
 * Relative attractiveness of a one-stop trip compared with a nonstop at the same time of day and fare (1 = as
 * good). `blockH` is the hours in the air on both flights together. Connections also sell cheaper
 * (connectFareShare), which wins back part of this in the market.
 */
export function connectionWeight(blockH: number, waitMin: number, via: string, directKm: number, through = false): number {
  return tripWeight(blockH, [{ waitMin, via, through }], directKm);
}

/**
 * The same weight for a trip with any number of stops: every layover costs what it would on a one-stop trip, and each
 * extra stop costs the bother of changing planes again.
 */
export function tripWeight(blockH: number, layovers: { waitMin: number; via: string; through: boolean }[], directKm: number): number {
  let felt = blockH, bother = 0;
  for (const l of layovers) {
    felt += l.through ? l.waitMin / 60 : layoverCostHours(l.waitMin, l.via);
    bother += l.through ? THROUGH_PENALTY_H : CONNECTION_PENALTY_H;
  }
  return Math.exp(-connectionHourCost(directKm) * (felt - typicalFlightHours(directKm) + bother));
}

/** A second stop sells this much less of the nonstop fare than a one-stop trip with the same layover. */
export const TWO_STOP_FARE_DISCOUNT = 0.05;

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

/**
 * The connection between two flights of one trip: the layover, and whether the traveller stays on the same aircraft.
 * Null when the second flight leaves too soon after the first lands.
 */
function connectionAt(f1: Flight, f2: Flight, hub?: string): { wait: number; through: boolean } | null {
  const through = f2.ac === f1.ac && f2.idx === f1.idx + 1;
  const wait = mod(f2.dep - f1.arr, DAY);
  if (wait < (through ? 0 : minConnect(f1.to, f1.from, f2.to, hub))) return null;
  return { wait, through };
}

/** Per passenger on each flight: check-in, catering and airport passenger fees, NT$. */
export const PAX_COST_PER_SEGMENT = 250;
/** Share of ticket revenue that goes on sales, distribution and card fees. */
export const SALES_COST_SHARE = 0.12;

/** The player's fare multiple on a route (0.7 to 1.4, default 1). */
export const fareMultOf = (plan: Plan, key: string) => plan.fares[key] ?? 1;

/** The plan's codeshare flights, as flights the player can sell connections on. */
function buildPartnerFlights(plan: Plan): Flight[] {
  // A partner flight the player already sells (codeshare) isn't fed twice through the partner selling a player route.
  const sold = new Set((plan.codeshares ?? []).map((c) => `${c.airline}|${c.key}`));
  const feeders = (plan.hosted ?? []).flatMap(feederFlights).filter((p) => !sold.has(`${p.airline}|${p.key}`));
  return [...codeshareFlights(plan), ...feeders].map((p, i) => {
    const A = AIRPORT_BY_CODE[p.from], B = AIRPORT_BY_CODE[p.to];
    const ac: Aircraft = { id: `${p.hosted ? 'hs' : 'cs'}:${p.airline}|${p.key}#${i}`, reg: '', type: p.type, legs: [] };
    return { key: ac.id, idx: -1, ac, from: p.from, to: p.to, dep: p.dep, perWeek: p.perWeek, arr: p.dep + p.block, seats: p.seats, blockH: p.block / 60, distKm: distanceKm(A.lat, A.lon, B.lat, B.lon), partner: p };
  });
}

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
  // Today's service: competitors' nonstops and connections, or else flights from other airports in the same cities and
  // connections, or else one daily flight. With the player gone, the market is back to today's travellers.
  const uBase = Math.exp(comp.offers.length ? airChoice(comp.offers, m.distKm, m.refFare).utility
    : m.airDemand > 0 ? airUtility(m.refFare, m.distKm, m.rivalFreq) : airUtility(m.refFare, m.distKm, 7));
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
 * Where nobody flies two cities nonstop, travellers still change planes somewhere: competitors' connections through
 * their hubs where there are any, and other airlines' trips topping those up to this many flights a week, NT$
 * CONNECTING_PENALTY worse than a nonstop (a layover of about 2.5 hours).
 */
export const CONNECTING_FREQ = 56;
export const CONNECTING_PENALTY = 1500;

/** One competitor's one-stop trip through its own hub, one direction. */
export interface RivalConnection {
  airline: Airline;
  /** Where travellers change planes: one of the airline's hubs or bases. */
  via: string;
  /** Weekly flights on the thinner of the two legs. */
  freq: number;
  /** Flights a week that connect well, weighted by how attractive their times are. */
  effFreq: number;
  fare: number;
  /** Product quality less the extra time and bother of changing planes, NT$ per trip. */
  quality: number;
}

/** Most one-stop routings travellers consider via competitor hubs (Hong Kong-London via Dubai, Doha, Istanbul...). */
const MAX_RIVAL_CONNECTIONS = 6;
/** Airlines sell connections that stay close to the straight line: at most this much longer than nonstop. */
export const RIVAL_CONNECT_DETOUR = 1.5;
/** Layover a competitor's hub banks usually give, minutes. */
const RIVAL_CONNECT_WAIT_MIN = 120;
/** Share of a leg's flights that meet one on the other leg within a sensible layover. */
const RIVAL_CONNECT_SHARE = 0.7;
/** Routings with less than this share of the best one's pull are left out. */
const MIN_CONNECTION_PULL = 0.03;

/**
 * Competitors' one-stop trips from `o` to `d`: an airline that flies both legs through one of its own hubs or bases
 * (low-cost airlines don't sell connections). Long-haul markets get the hub carriers of the Gulf and Asia, as real
 * Europe-Asia travellers do.
 */
export function rivalConnections(o: string, d: string): RivalConnection[] {
  const m = marketBetween(o, d);
  if (!m) return [];
  const O = AIRPORT_BY_CODE[o], D = AIRPORT_BY_CODE[d];
  const out: (RivalConnection & { pull: number })[] = [];
  for (const { to: h, services } of rivalsAt(o)) {
    const H = AIRPORT_BY_CODE[h];
    if (h === d || H.metro === O.metro || H.metro === D.metro) continue;
    const first = marketBetween(o, h), second = marketBetween(h, d);
    if (!first || !second || first.distKm + second.distKm > m.distKm * RIVAL_CONNECT_DETOUR) continue;
    // Only a hub carrier can sell this connection. Avoid generating the
    // onward market's whole timetable when no incoming carrier qualifies.
    const feeders = services.filter(s => s.airline.kind !== 'low' && s.airline.bases.includes(h));
    if (!feeders.length) continue;
    const onward = rivalsFrom(h, d);
    if (!onward.length) continue;
    for (const s1 of feeders) {
      const s2 = onward.find((x) => x.airline.id === s1.airline.id);
      if (!s2) continue;
      const w = connectionWeight(typicalFlightHours(first.distKm) + typicalFlightHours(second.distKm), RIVAL_CONNECT_WAIT_MIN, h, m.distKm);
      const quality = s1.airline.quality + Math.log(w) / THETA;
      const effFreq = Math.min(s1.effFreq, s2.effFreq) * RIVAL_CONNECT_SHARE;
      const fare = Math.round(m.refFare * s1.airline.fareMult * CONNECT_FARE_SHARE);
      out.push({ airline: s1.airline, via: h, freq: Math.min(s1.freq, s2.freq), effFreq, fare, quality, pull: effFreq * Math.exp(THETA * quality) });
    }
  }
  out.sort((x, y) => y.pull - x.pull || x.via.localeCompare(y.via));
  const best = out[0]?.pull ?? 0;
  return out.filter((c) => c.pull >= best * MIN_CONNECTION_PULL).slice(0, MAX_RIVAL_CONNECTIONS).map(({ pull: _, ...c }) => c);
}

export interface Competition {
  /** Competitor flights; `offers` starts with these in the same order. */
  services: RivalService[];
  /** Competitors' one-stop trips through their hubs; in `offers` right after the services. */
  connections: RivalConnection[];
  /** What travellers can choose besides the player: the services, the connections, then any other connecting option. */
  offers: AirOffer[];
  /** True when nobody flies these two airports and the competition is other airports in the same cities. */
  otherAirports: boolean;
}

const competitionCache = new Map<string, Competition>();
/**
 * Competitor flights travellers in a market can choose from: nonstops, and one-stop trips through competitors' hubs.
 * Where no airline flies these two airports, travellers fly from other airports in the same cities (e.g. Taipei to
 * Osaka via Kansai when nobody flies to Itami), at a cost for the less convenient airport.
 */
export function competitionFor(o: string, d: string): Competition {
  const k = `${o}>${d}`;
  let c = competitionCache.get(k);
  if (!c) {
    const direct = rivalsFrom(o, d);
    const connections = rivalConnections(o, d);
    const offer = (r: RivalService) => ({
      freq: r.effFreq, fare: r.fare,
      quality: r.airline.quality - OTHER_AIRPORT_PENALTY * ((r.from !== o ? 1 : 0) + (r.to !== d ? 1 : 0)),
    });
    const connecting = connections.map((x) => ({ freq: x.effFreq, fare: x.fare, quality: x.quality }));
    if (direct.length) c = { services: direct, connections, offers: [...direct.map(offer), ...connecting], otherAirports: false };
    else {
      const services: RivalService[] = [];
      for (const x of metroAirports(o)) for (const y of metroAirports(d)) if (x !== o || y !== d) services.push(...rivalsFrom(x, y));
      const m = marketBetween(o, d);
      // Travellers can always change planes somewhere on other airlines, as well as fly from the other airports: the
      // named connections above, and other airlines' and interline trips up to CONNECTING_FREQ in all.
      const otherFreq = CONNECTING_FREQ - connections.reduce((sum, x) => sum + x.effFreq, 0);
      const other = m && otherFreq > 1 ? [{ freq: otherFreq, fare: m.refFare, quality: -CONNECTING_PENALTY }] : [];
      c = { services, connections, offers: [...services.map(offer), ...connecting, ...other], otherAirports: services.length > 0 };
    }
    competitionCache.set(k, c);
  }
  return c;
}

/**
 * Fills the competitor caches a simulation of these airports' network reads first: every competitor service at each
 * airport, then the competition in each market between them. Yields after each market, so it can run in short slices
 * in the background; the caches hold the same values whenever they are filled.
 */
export function* warmCompetition(codes: readonly string[]): Generator<void, void> {
  for (const code of codes) {
    for (const m of marketsAt(code)) {
      if (m.rivalFreq <= 0) continue;
      rivalsBetween(m.a, m.b);
      yield;
    }
    rivalsAt(code);
  }
  for (const o of codes) for (const d of codes) {
    if (o === d || !marketBetween(o, d)) continue;
    competitionFor(o, d);
    yield;
  }
}

/**
 * How one direction of a market splits today, without the player: weekly travellers per competitor service
 * (same order as `competitionFor(o, d).services`), per competitor connection (`.connections`), and on all connections
 * via other airlines together.
 */
export function todaySplit(o: string, d: string): { total: number; rivals: number[]; via: number[]; connecting: number } {
  const m = marketBetween(o, d);
  const comp = competitionFor(o, d);
  if (!m || !comp.offers.length) return { total: 0, rivals: comp.services.map(() => 0), via: comp.connections.map(() => 0), connecting: 0 };
  const ch = airChoice(comp.offers, m.distKm, m.refFare);
  // Where nobody flies these two airports, today's travellers are the ones using other airports or connections.
  const total = m.airDemand > 0 ? m.airDemand : respondingAirTotal(m, ch.utility, comp);
  const rivals = comp.services.map((_, i) => total * ch.shares[i]);
  const via = comp.connections.map((_, i) => total * ch.shares[comp.services.length + i]);
  const connecting = total * ch.shares.slice(comp.services.length).reduce((s, x) => s + x, 0);
  return { total, rivals, via, connecting };
}

/**
 * The last few results by plan content. The calculation worker asks for the same plan again and again (the fare curve
 * at today's fare, "what if" baselines, every codeshare deal's "without"), and a week's simulation is the expensive part.
 */
const recent = new Map<string, NetworkResult>();
const RECENT_MAX = 8;
export function simulate(plan: Plan): NetworkResult {
  const key = JSON.stringify(plan);
  let result = recent.get(key);
  if (result) { recent.delete(key); } else result = simulateUncached(plan, false);
  recent.set(key, result);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
  return result;
}

/**
 * The same totals (revenue, cost, every route and flight) without the per-deal detail (journeys, feeds, markets,
 * departures) of codeshares and hosted deals. For the "without it" side of a deal's impact, which only reads totals,
 * and which is run once per deal: with hundreds of deals the detail is most of the work.
 */
export function simulateLean(plan: Plan): NetworkResult {
  const full = recent.get(JSON.stringify(plan));
  return full ?? simulateUncached(plan, true);
}

/** Everything about a plan's flights and the itineraries over them that doesn't depend on its fares. */
interface Structure {
  flights: Flight[];
  partners: Flight[];
  every: Flight[];
  itins: Map<string, Itinerary[]>;
  blocks: Map<string, Flight>;
  partnerLinks: Map<Flight, Set<Flight>>;
  /** Number of itineraries (each one's idx is below this). */
  count: number;
}

function buildStructure(plan: Plan): Structure {
  const flights = buildFlights(plan);
  // Codeshare flights only carry the player's travellers as one leg of a connection with its own flights.
  const partners = buildPartnerFlights(plan);
  const every = [...flights, ...partners];
  const byFrom = new Map<string, Flight[]>();
  for (const f of every) { const l = byFrom.get(f.from); if (l) l.push(f); else byFrom.set(f.from, [f]); }
  const ownFrom = new Map<string, Flight[]>();
  for (const f of flights) { const l = ownFrom.get(f.from); if (l) l.push(f); else ownFrom.set(f.from, [f]); }
  // Partners selling the player's routes: the seat block each may use, per player flight.
  const hostedBy = new Map<string, Codeshare[]>(); // player route -> partners selling it
  for (const h of plan.hosted ?? []) hostedBy.set(h.key, [...(hostedBy.get(h.key) ?? []), h]);
  const blocks = new Map<string, Flight>();
  const blockFor = (airline: string, f: Flight) => {
    const k = `${airline}|${f.key}`;
    let b = blocks.get(k);
    if (!b) {
      const h = hostedBy.get(pairKey(f.from, f.to))!.find((x) => x.airline === airline)!;
      blocks.set(k, (b = { ...f, key: `hb:${k}`, seats: Math.round(f.seats * shareOf(h)), blockOf: f }));
    }
    return b;
  };

  // Itineraries per directed market: nonstops, plus one-stop connections on the player's own flights.
  const itins = new Map<string, Itinerary[]>(); // `${o}>${d}`
  let count = 0;
  const add = (o: string, d: string, it: Itinerary) => {
    it.idx = count++;
    const k = `${o}>${d}`;
    const l = itins.get(k);
    if (l) l.push(it); else itins.set(k, [it]);
  };
  // The partner's part of a ticket follows the market's reference fare (the player sets fares on its own flights).
  const multOf = (f: Flight) => (f.partner ? 1 : fareMultOf(plan, pairKey(f.from, f.to)));
  // Which of the player's flights each partner flight connects with, and how many travellers each pairing carries.
  const partnerLinks = new Map<Flight, Set<Flight>>();
  const linkOf = (f: Flight) => { let set = partnerLinks.get(f); if (!set) partnerLinks.set(f, (set = new Set())); return set; };
  for (const f1 of every) {
    const mult1 = multOf(f1);
    if (!f1.partner) add(f1.from, f1.to, { flights: [f1], weight: flightTimeQuality(f1), fareShare: 1, fareMult: mult1, perWeek: f1.perWeek });
    for (const f2 of (f1.partner ? ownFrom : byFrom).get(f1.to) ?? []) {
      if (f1.partner && f2.partner) continue;
      // A partner's feeder flight only connects with the player route that partner sells.
      const feeder = f1.partner?.hosted ? f1 : f2.partner?.hosted ? f2 : null;
      const own = feeder === f1 ? f2 : f1;
      if (feeder && feeder.partner!.hosted !== pairKey(own.from, own.to)) continue;
      if (AIRPORT_BY_CODE[f2.to].metro === AIRPORT_BY_CODE[f1.from].metro) continue;
      const through = f2.ac === f1.ac && f2.idx === f1.idx + 1;
      const wait = mod(f2.dep - f1.arr, DAY);
      if (wait < (through ? 0 : minConnect(f1.to, f1.from, f2.to, plan.hub))) continue;
      const m = marketBetween(f1.from, f2.to);
      if (!m || !detourOk(m.distKm, f1.distKm + f2.distKm)) continue;
      if (f1.partner && !feeder) linkOf(f1).add(f2);
      if (f2.partner && !feeder) linkOf(f2).add(f1);
      // Extra time versus flying nonstop, valued in the same units as fares. Long waits and stopovers count less than in full.
      const penalty = connectionWeight(f1.blockH + f2.blockH, wait, f1.to, m.distKm, through);
      // Connecting fares follow the fares the player sets on the legs, weighted by distance.
      const mult = (mult1 * f1.distKm + multOf(f2) * f2.distKm) / (f1.distKm + f2.distKm);
      add(f1.from, f2.to, { flights: [f1, f2], weight: flightTimeQuality(f1) * penalty, fareShare: connectFareShare(through ? 0 : wait), fareMult: mult, wait: through ? 0 : wait, perWeek: Math.min(f1.perWeek, f2.perWeek), block: feeder ? blockFor(feeder.partner!.airline, own) : undefined });
    }
  }

  // Two-stop trips: the player's own flights to a hub and on to a second airport, then a codeshare flight to the
  // destination (or a codeshare flight out, then the player's own two). This is how a codeshare extends the player's
  // network: Guangzhou-Miami through Hong Kong and New York once the partner sells New York-Miami. Hosted feeders
  // are not chained, and the partner leg is always a flight the player sells seats on.
  const sellable = partners.filter((p) => !p.partner!.hosted);
  const sellableFrom = new Map<string, Flight[]>();
  for (const p of sellable) { const l = sellableFrom.get(p.from); if (l) l.push(p); else sellableFrom.set(p.from, [p]); }
  const addTwoStop = (legs: [Flight, Flight, Flight]) => {
    const [f1, f2, f3] = legs;
    const c1 = connectionAt(f1, f2, plan.hub), c2 = connectionAt(f2, f3, plan.hub);
    if (!c1 || !c2) return;
    const origin = f1.from, dest = f3.to;
    // Both stops must be in cities of their own: no doubling back to the origin's or the destination's city.
    const cities = [f1.to, f2.to].map((c) => AIRPORT_BY_CODE[c].metro);
    if (cities.some((metro) => metro === AIRPORT_BY_CODE[origin].metro || metro === AIRPORT_BY_CODE[dest].metro)) return;
    const m = marketBetween(origin, dest);
    const km = f1.distKm + f2.distKm + f3.distKm;
    if (!m || !detourOk(m.distKm, km)) return;
    const layovers = [{ waitMin: c1.wait, via: f1.to, through: c1.through }, { waitMin: c2.wait, via: f2.to, through: c2.through }];
    // The player's own flight that connects with the partner's leg is always the middle one.
    const partnerLeg = legs.find((f) => f.partner)!;
    linkOf(partnerLeg).add(f2);
    const longest = Math.max(0, ...layovers.map((l) => (l.through ? 0 : l.waitMin)));
    add(origin, dest, {
      flights: legs,
      weight: flightTimeQuality(f1) * tripWeight(f1.blockH + f2.blockH + f3.blockH, layovers, m.distKm),
      fareShare: Math.max(MIN_CONNECT_FARE_SHARE, connectFareShare(longest) - TWO_STOP_FARE_DISCOUNT),
      fareMult: legs.reduce((s, f) => s + multOf(f) * f.distKm, 0) / km,
      perWeek: Math.min(...legs.map((f) => f.perWeek)),
      waits: layovers.map((l) => (l.through ? 0 : l.waitMin)),
    });
  };
  for (const f1 of flights) for (const f2 of ownFrom.get(f1.to) ?? []) for (const p of sellableFrom.get(f2.to) ?? []) addTwoStop([f1, f2, p]);
  for (const p of sellable) for (const f2 of ownFrom.get(p.to) ?? []) for (const f3 of ownFrom.get(f2.to) ?? []) addTwoStop([p, f2, f3]);

  return { flights, partners, every, itins, blocks, partnerLinks, count };
}

/**
 * The structure of the last few plans, apart from fares: trying every fare on a route (the fare curve) then builds
 * the itineraries once and only redoes demand, capacity and the tally.
 */
const structures = new Map<string, Structure>();
const STRUCTURES_MAX = 3;
function structureOf(plan: Plan): Structure {
  const key = JSON.stringify({ ...plan, fares: null });
  const hit = structures.get(key);
  if (hit) {
    structures.delete(key);
    structures.set(key, hit);
    // The one thing fares change: what each itinerary's price follows (the same arithmetic as when it was built).
    const multOf = (f: Flight) => (f.partner ? 1 : fareMultOf(plan, pairKey(f.from, f.to)));
    for (const list of hit.itins.values()) {
      for (const it of list) {
        const legs = it.flights;
        it.fareMult = legs.length === 1 ? multOf(legs[0]) : legs.reduce((sum, f) => sum + multOf(f) * f.distKm, 0) / legs.reduce((sum, f) => sum + f.distKm, 0);
      }
    }
    return hit;
  }
  const built = buildStructure(plan);
  structures.set(key, built);
  if (structures.size > STRUCTURES_MAX) structures.delete(structures.keys().next().value!);
  return built;
}

function simulateUncached(plan: Plan, lean: boolean): NetworkResult {
  const { flights, partners, every, itins, blocks, partnerLinks, count } = structureOf(plan);
  const linkPax = new Map<Flight, Map<Flight, number>>();
  const partnerWanted = new Map<Flight, number>();
  // Demand per itinerary (daily), by itinerary idx; `has` marks itineraries in a market that exists.
  const demand = new Float64Array(count);
  const has = new Uint8Array(count);
  const pricedAt = new Float64Array(count);
  const marketInfo = new Map<string, { airTotal: number; refFare: number; mine: number; connecting: number; rivals: { id: string; pax: number }[]; rivalVia: MarketResult['rivalVia'] }>();
  for (const [k, list] of itins) {
    const [o, d] = k.split('>');
    const m = marketBetween(o, d);
    if (!m) continue;
    // An itinerary that runs less often than daily attracts proportionally fewer travellers.
    // Each itinerary's weight, after travellers' reaction to its price against the nonstop reference fare: connections
    // sell cheaper, so they also draw travellers who would otherwise fly nonstop.
    let wSum = 0, pSum = 0;
    for (const it of list) {
      const w = it.weight * (it.perWeek / 7);
      const p = w * Math.exp(-fareResponse(it.fareShare * it.fareMult * m.refFare, m.refFare));
      pricedAt[it.idx!] = p;
      wSum += w;
      pSum += p;
    }
    // One fare that has the same pull as the player's mix of itineraries and prices.
    const fare = m.refFare * (1 - Math.log(pSum / wSum) / FARE_SENSITIVITY);
    const comp = competitionFor(o, d);
    const rivals = comp.services;
    const air = airChoice([{ freq: 7 * wSum, fare }, ...comp.offers], m.distKm, m.refFare);
    const airTotal = respondingAirTotal(m, air.utility, comp);
    const mine = (airTotal * air.shares[0]) / 7;
    // Per departure: an itinerary flown every other day gets half the week's travellers on twice as few departures.
    for (const it of list) { demand[it.idx!] = (mine * 7 * pricedAt[it.idx!]) / pSum / it.perWeek; has[it.idx!] = 1; }
    const connecting = airTotal * air.shares.slice(rivals.length + 1).reduce((s, x) => s + x, 0);
    marketInfo.set(k, {
      airTotal, refFare: m.refFare, mine: mine * 7, connecting,
      rivals: rivals.map((r, i) => ({ id: r.airline.id, pax: airTotal * air.shares[i + 1] })),
      rivalVia: comp.connections.map((x, i) => ({ id: x.airline.id, via: x.via, pax: airTotal * air.shares[rivals.length + 1 + i] })),
    });
  }

  // Capacity: where a flight is oversold, everyone who wants it (local and connecting) loses seats in the same
  // proportion. Each flight accepts a share of the travellers who want it; a connection gets the smaller share of
  // its two flights, and seats a connection can't use on one flight go back to the others on the next pass.
  // A trip a partner sells also needs a seat in its block on the player's flight.
  const legsOf = (it: Itinerary) => (it.block ? [...it.flights, it.block] : it.flights);
  const limited = [...every, ...blocks.values()];
  // Typed arrays over flight and itinerary indices: this loop is most of a simulation's cost, and the legs of each
  // itinerary are looked up once instead of rebuilt on every pass.
  const slot = new Map<Flight, number>(limited.map((f, i) => [f, i]));
  const seatOf = Float64Array.from(limited, (f) => f.seats);
  const itList: Itinerary[] = [], wantList: number[] = [], legList: number[][] = [];
  for (const list of itins.values()) {
    for (const it of list) {
      if (!has[it.idx!]) continue;
      itList.push(it); wantList.push(demand[it.idx!]); legList.push(it.legSlots ??= legsOf(it).map((f) => slot.get(f)!));
    }
  }
  const acceptAt = new Float64Array(limited.length).fill(1);
  const carriedAt = new Float64Array(itList.length);
  const onboardAt = new Float64Array(limited.length);
  const load = () => {
    onboardAt.fill(0);
    for (let i = 0; i < itList.length; i++) {
      const legs = legList[i];
      let share = Infinity;
      for (let j = 0; j < legs.length; j++) share = Math.min(share, acceptAt[legs[j]]);
      const n = wantList[i] * share;
      carriedAt[i] = n;
      for (let j = 0; j < legs.length; j++) onboardAt[legs[j]] += n;
    }
  };
  for (let pass = 0; pass < 12; pass++) {
    load();
    let moved = false;
    for (let f = 0; f < limited.length; f++) {
      const n = onboardAt[f];
      if (n > 0) {
        const next = Math.min(1, (acceptAt[f] * seatOf[f]) / n);
        if (next !== acceptAt[f]) { acceptAt[f] = next; moved = true; }
      }
    }
    if (!moved) break; // nothing changes from here on
  }
  // Never more travellers than seats.
  load();
  const carried = new Float64Array(count);
  for (let i = 0; i < itList.length; i++) {
    const legs = legList[i];
    let fit = 1;
    for (let j = 0; j < legs.length; j++) fit = Math.min(fit, seatOf[legs[j]] / Math.max(onboardAt[legs[j]], seatOf[legs[j]]));
    carried[itList[i].idx!] = carriedAt[i] * fit;
  }
  const accept = new Map<Flight, number>(limited.map((f, i) => [f, acceptAt[i]]));

  // Tally per flight.
  const flightPax = new Map<Flight, number>();
  const flightRevenue = new Map<Flight, number>();
  const flightLocalRevenue = new Map<Flight, number>();
  const flightLocalPax = new Map<Flight, number>();
  const flightSpill = new Map<Flight, number>();
  let tripsWeekly = 0, connectingWeekly = 0, revenueWeekly = 0;
  const transferFlows = new Map<string, { pax: number; long: number; stopover: number }>(); // `${via}|${o}|${d}`, plus `|${stops}` for two-stop trips
  const partnersOfDeal = new Map<string, Flight[]>(); // `${airline}|${key}` -> that deal's partner flights
  for (const f of partners) { const id = `${f.partner!.airline}|${f.partner!.key}`; const l = partnersOfDeal.get(id); if (l) l.push(f); else partnersOfDeal.set(id, [f]); }
  const csResults = new Map<string, CodeshareResult & { marketMap: Map<string, CodeshareResult['markets'][number]>; feedMap: Map<string, CodeshareResult['feeds'][number]>; journeyMap: Map<string, CodeshareResult['journeys'][number]> }>();
  for (const cs of plan.codeshares ?? []) {
    const id = `${cs.airline}|${cs.key}`;
    const fl = partnersOfDeal.get(id) ?? [];
    if (!fl.length) continue;
    csResults.set(id, {
      key: cs.key, airline: cs.airline, flights: fl.reduce((s, f) => s + f.perWeek, 0), seats: fl.reduce((s, f) => s + f.perWeek * f.seats, 0),
      pax: 0, wanted: 0, feedRevenue: 0, partnerRevenue: 0, fee: codeshareFee(shareOf(cs)), markets: [], marketMap: new Map(), feeds: [], feedMap: new Map(), journeys: [], journeyMap: new Map(),
      share: shareOf(cs), departures: [],
    });
  }
  const csOf = (f: Flight) => csResults.get(`${f.partner!.airline}|${f.partner!.key}`)!;
  const hsResults = new Map<string, HostedResult & { marketMap: Map<string, HostedResult['markets'][number]>; sourceMap: Map<string, number> }>();
  for (const h of plan.hosted ?? []) {
    const own = flights.filter((f) => pairKey(f.from, f.to) === h.key);
    if (!own.length) continue;
    hsResults.set(`${h.airline}|${h.key}`, {
      key: h.key, airline: h.airline, share: shareOf(h), seats: own.reduce((s, f) => s + f.perWeek * Math.round(f.seats * shareOf(h)), 0),
      pax: 0, wanted: 0, revenue: 0, partnerRevenue: 0, fee: HOSTED_FEE_PER_WEEK, markets: [], marketMap: new Map(), sources: [], sourceMap: new Map(),
    });
  }
  const markets: Record<string, MarketResult> = {};
  for (const [k, list] of itins) {
    const info = marketInfo.get(k);
    if (!info) continue;
    const [mo, md] = k.split('>');
    const mk = mo < md ? `${mo}|${md}` : `${md}|${mo}`;
    const mr: MarketResult = markets[k] = { airTotal: info.airTotal, connecting: info.connecting, rivals: info.rivals, rivalVia: info.rivalVia, nonstop: 0, via: {}, wanted: info.mine };
    for (const it of list) {
      const n = carried[it.idx!];
      const want = demand[it.idx!];
      const fx = fixedOf(it);
      if (it.flights.length === 1) mr.nonstop += n * it.perWeek;
      else mr.via[it.flights[0].to] = (mr.via[it.flights[0].to] ?? 0) + n * it.perWeek;
      tripsWeekly += n * it.perWeek;
      const fare = Math.round(info.refFare * it.fareMult) * it.fareShare;
      if (it.flights.length > 1) {
        connectingWeekly += n * it.perWeek;
        // A trip counts at every airport where it changes planes. Two-stop trips also carry their full stop list.
        fx.transferKeys.forEach((tk, i) => {
          const tf = transferFlows.get(tk) ?? { pax: 0, long: 0, stopover: 0 };
          tf.pax += n * it.perWeek;
          const kind = layoverKind((it.waits ?? [it.wait ?? 0])[i]);
          if (kind !== 'quick') tf[kind] += n * it.perWeek;
          transferFlows.set(tk, tf);
        });
      }
      // The player's own part of a trip with a partner leg is split between its own flights by distance (ownKm).
      // The partner keeps its flight's part of the fare, in proportion to the two flights' own fares (a short
      // flight gets more than its share of the distance, as in airlines' prorate agreements); the player keeps the rest.
      const { dist, ownKm, partnerLeg, partnerShare } = fx;
      if (partnerLeg?.partner!.hosted) {
        const h = hsResults.get(`${partnerLeg.partner!.airline}|${partnerLeg.partner!.hosted}`)!;
        const toPartner = n * fare * it.perWeek * partnerShare;
        h.pax += n * it.perWeek;
        h.wanted += want * it.perWeek;
        h.partnerRevenue += toPartner;
        h.revenue += n * fare * it.perWeek - toPartner;
        if (lean) { revenueWeekly += n * fare * it.perWeek - toPartner; } else {
        h.sourceMap.set(partnerLeg.partner!.key, (h.sourceMap.get(partnerLeg.partner!.key) ?? 0) + n * it.perWeek);
        const row = h.marketMap.get(mk) ?? { o: mo, d: md, via: it.flights[0].to, pax: 0 };
        row.pax += n * it.perWeek;
        h.marketMap.set(mk, row);
        revenueWeekly += n * fare * it.perWeek - toPartner;
        }
      } else if (partnerLeg) {
        const cs = csOf(partnerLeg);
        const toPartner = n * fare * it.perWeek * partnerShare;
        cs.pax += n * it.perWeek;
        cs.wanted += want * it.perWeek;
        if (lean) { cs.feedRevenue += n * fare * it.perWeek - toPartner; revenueWeekly += n * fare * it.perWeek - toPartner; } else {
        partnerWanted.set(partnerLeg, (partnerWanted.get(partnerLeg) ?? 0) + want * it.perWeek / partnerLeg.perWeek);
        // The player's flight the partner's leg connects with: the one next to it.
        const at = it.flights.indexOf(partnerLeg);
        const own = [it.flights[at - 1], it.flights[at + 1]].find((f) => f && !f.partner)!;
        const lp = linkPax.get(partnerLeg) ?? new Map<Flight, number>();
        lp.set(own, (lp.get(own) ?? 0) + n * it.perWeek);
        linkPax.set(partnerLeg, lp);
        cs.partnerRevenue += toPartner;
        for (const f of it.flights) {
          if (f.partner) continue;
          const fk = pairKey(f.from, f.to);
          const feed = cs.feedMap.get(fk) ?? { key: fk, pax: 0, revenue: 0 };
          feed.pax += n * it.perWeek;
          feed.revenue += n * fare * it.perWeek * (1 - partnerShare) * (f.distKm / ownKm);
          cs.feedMap.set(fk, feed);
        }
        cs.feedRevenue += n * fare * it.perWeek - toPartner;
        const via = it.flights[0].to;
        const row = cs.marketMap.get(mk) ?? { o: mo, d: md, via, pax: 0 };
        row.pax += n * it.perWeek;
        cs.marketMap.set(mk, row);
        // The whole journey, stop by stop. The two directions are one journey: keep whichever way reads first.
        const jk = fx.journeyKey;
        const jr = cs.journeyMap.get(jk) ?? { path: fx.journeyPath, pax: 0 };
        jr.pax += n * it.perWeek;
        cs.journeyMap.set(jk, jr);
        revenueWeekly += n * fare * it.perWeek - toPartner;
        }
      } else revenueWeekly += n * fare * it.perWeek;
      for (const f of it.flights) {
        if (f.partner) { flightPax.set(f, (flightPax.get(f) ?? 0) + n); continue; }
        flightPax.set(f, (flightPax.get(f) ?? 0) + n);
        flightRevenue.set(f, (flightRevenue.get(f) ?? 0) + (partnerLeg ? (n * fare * (1 - partnerShare) * f.distKm) / ownKm : (n * fare * f.distKm) / dist));
        if (it.flights.length === 1) {
          flightLocalRevenue.set(f, (flightLocalRevenue.get(f) ?? 0) + n * fare);
          flightLocalPax.set(f, (flightLocalPax.get(f) ?? 0) + n);
        }
      }
      // Travellers turned away count against the flight that was full (both legs only if both were).
      if (want - n > 1e-12) {
        const fullLegs = it.flights.filter((f) => accept.get(f)! < 0.999 || (f === it.block?.blockOf && accept.get(it.block)! < 0.999));
        const blame = fullLegs.length ? fullLegs : it.flights;
        for (const f of blame) flightSpill.set(f, (flightSpill.get(f) ?? 0) + (want - n) / blame.length);
      }
    }
  }

  const flightCost = (f: Flight) => {
    const spec = AIRCRAFT[f.ac.type];
    return f.blockH * spec.costPerBlockHour + spec.costPerDeparture
      + (flightPax.get(f) ?? 0) * PAX_COST_PER_SEGMENT + (flightRevenue.get(f) ?? 0) * SALES_COST_SHARE;
  };

  const perFlight: Record<string, FlightResult> = {};
  for (const f of flights) {
    const pax = flightPax.get(f) ?? 0, localPax = flightLocalPax.get(f) ?? 0;
    perFlight[f.key] = {
      key: f.key, acId: f.ac.id, index: f.idx, from: f.from, to: f.to, dep: f.dep, perWeek: f.perWeek, seats: f.seats,
      pax, localPax, connectingPax: Math.max(0, pax - localPax), spill: Math.max(0, flightSpill.get(f) ?? 0),
      loadFactor: f.seats ? pax / f.seats : 0, revenue: flightRevenue.get(f) ?? 0, cost: flightCost(f),
    };
  }

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
        for (const it of itins.get(lk) ?? []) if (it.flights.length === 1) localPax += it.perWeek * carried[it.idx!];
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
        flights: [],
      };
    }
    r.flights.push(perFlight[f.key]);
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
    aircraft[ac.id] = { id: ac.id, blockHoursPerDay: info.blockMin / 60, utilisation: info.utilisation, pax: 0, seats: 0, revenue: 0, flyingCost: 0, ownershipCost: AIRCRAFT[ac.type].ownershipPerWeek, flights: [] };
  }
  for (const f of flights) {
    const a = aircraft[f.ac.id];
    a.pax += f.perWeek * (flightPax.get(f) ?? 0);
    a.seats += f.perWeek * f.seats;
    a.revenue += f.perWeek * (flightRevenue.get(f) ?? 0);
    a.flyingCost += f.perWeek * flightCost(f);
    a.flights[f.idx] = perFlight[f.key];
  }

  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const acs = Object.values(aircraft);
  const flyingCost = sum(acs.map((a) => a.flyingCost));
  const ownershipCost = sum(acs.map((a) => a.ownershipCost));
  const seats = sum(acs.map((a) => a.seats));
  const onboard = sum(acs.map((a) => a.pax));
  const revenue = revenueWeekly;
  const hubCost = plan.hub && AIRPORT_BY_CODE[plan.hub] ? HUB_COST_PER_WEEK : 0;
  const codeshares: Record<string, CodeshareResult> = {};
  for (const [id, { marketMap, feedMap, journeyMap, ...r }] of csResults) {
    const departures: CodeshareDeparture[] = (lean ? [] : partnersOfDeal.get(id) ?? []).map((f) => {
      const best = [...(linkPax.get(f) ?? new Map<Flight, number>())].sort((x, y) => y[1] - x[1])[0];
      return {
        from: f.from, to: f.to, dep: f.dep, arr: f.arr, perWeek: f.perWeek, seats: f.seats, pax: flightPax.get(f) ?? 0,
        wanted: partnerWanted.get(f) ?? 0, links: partnerLinks.get(f)?.size ?? 0,
        top: best && best[1] > 0.05 ? { from: best[0].from, to: best[0].to, dep: best[0].dep, pax: best[1] } : undefined,
      };
    }).sort((x, y) => x.from.localeCompare(y.from) || localMinutes(x.from, x.dep) - localMinutes(y.from, y.dep));
    codeshares[id] = { ...r, departures, markets: [...marketMap.values()].sort((x, y) => y.pax - x.pax).slice(0, 6), journeys: [...journeyMap.values()].filter((j) => j.pax >= 0.5).sort((x, y) => y.pax - x.pax).slice(0, 12), feeds: [...feedMap.values()].sort((x, y) => y.pax - x.pax) };
  }
  const hosted: Record<string, HostedResult> = {};
  for (const [id, { marketMap, sourceMap, ...r }] of hsResults) {
    hosted[id] = { ...r, markets: [...marketMap.values()].sort((x, y) => y.pax - x.pax).slice(0, 6), sources: [...sourceMap].map(([key, pax]) => ({ key, pax })).sort((x, y) => y.pax - x.pax) };
  }
  const codeshareCost = Object.values(codeshares).reduce((s, c) => s + c.fee, 0) + Object.values(hosted).reduce((s, c) => s + c.fee, 0);
  const cost = flyingCost + ownershipCost + hubCost + codeshareCost;
  const transfers: NetworkResult['transfers'] = {};
  for (const [k, tf] of transferFlows) {
    const [via, from, to, route] = k.split('|');
    const t = (transfers[via] ??= { pax: 0, long: 0, stopover: 0, flows: [] });
    t.pax += tf.pax;
    t.long += tf.long;
    t.stopover += tf.stopover;
    t.flows.push({ from, to, ...tf, ...(route ? { stops: route.split('>') } : {}) });
  }
  for (const t of Object.values(transfers)) t.flows.sort((x, y) => y.pax - x.pax);
  return {
    routes,
    codeshares,
    codeshareCost,
    hosted,
    markets,
    byFlight: perFlight,
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
