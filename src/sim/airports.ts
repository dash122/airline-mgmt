// Per-airport views of the player's network: spokes, departure boards, connection banks and gaps.
// Reads the plan (and a simulation result when given). Never loops over all airports, only the player's flights.
import { AIRCRAFT } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, marketsAt, pairKey } from './markets';
import {
  blockMinutes, codeshareFlights, competitionFor, CONNECT_FARE_SHARE, connectionWeight, todaySplit, DAY, fareMultOf, respondingAirTotal, defaultAircraft, detourOk, HUB_COST_PER_WEEK, layoverKind, localMinutes, LONG_LAYOVER_MIN, minConnect,
  topMarketsFrom, utcOffsetMin, weeklyDepartures, type Aircraft, type Leg, type NetworkResult, type Plan, type TransferFlow,
} from './simulate';
import { airChoice } from './choice';
import { typicalFlightHours } from './flighttime';
import { distanceKm } from './geo';

export interface BoardFlight {
  ac: Aircraft;
  index: number;
  leg: Leg;
  from: string;
  to: string;
  depUtc: number;
  arrUtc: number;
  /** A codeshare partner's flight (its airline id); travellers can connect between it and your own flights only. */
  partner?: string;
}

const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Every scheduled flight in the plan, in no particular order. */
export function allFlights(plan: Plan): BoardFlight[] {
  const out: BoardFlight[] = [];
  for (const ac of plan.fleet) {
    ac.legs.forEach((leg, index) => {
      out.push({ ac, index, leg, from: leg.from, to: leg.to, depUtc: leg.dep, arrUtc: leg.dep + blockMinutes(leg.from, leg.to, ac.type) });
    });
  }
  return out;
}

/** Your flights plus the codeshare partners' flights you sell, for connections. */
export function connectingFlights(plan: Plan): BoardFlight[] {
  const out = allFlights(plan);
  codeshareFlights(plan).forEach((p, i) => {
    const ac: Aircraft = { id: `cs:${p.airline}|${p.key}#${i}`, reg: '', type: p.type, legs: [] };
    out.push({ ac, index: -1, leg: { from: p.from, to: p.to, dep: p.dep }, from: p.from, to: p.to, depUtc: p.dep, arrUtc: p.dep + p.block, partner: p.airline });
  });
  return out;
}

export type ClockBasis = 'local' | 'base';

/** Minutes after midnight at `code` (or at the base when the basis is 'base'). */
export const clockAt = (plan: Plan, basis: ClockBasis, code: string, utc: number) =>
  localMinutes(basis === 'base' ? plan.base : code, utc);

const dateOf = (code: string, utc: number) => Math.floor((utc + utcOffsetMin(AIRPORT_BY_CODE[code])) / DAY);

/**
 * How many calendar days after departure the flight lands, as read on the clocks of the chosen basis:
 * at each airport's own clock ('local') or all at the base's clock ('base'). Negative when it lands on an earlier date
 * (flying east across the date line). Uses only localMinutes/utcOffsetMin so it follows whatever zones the airports carry.
 */
export function dayShift(plan: Plan, basis: ClockBasis, f: { from: string; to: string; depUtc: number; arrUtc: number }): number {
  return basis === 'base' ? dayShiftBetween(plan.base, plan.base, f.depUtc, f.arrUtc) : dayShiftBetween(f.from, f.to, f.depUtc, f.arrUtc);
}

/** Calendar days between leaving `from` and landing at `to`, each read on its own airport's clock. */
export const dayShiftBetween = (from: string, to: string, depUtc: number, arrUtc: number) => dateOf(to, arrUtc) - dateOf(from, depUtc);

/** Clock difference between two airports, in hours (arrival airport minus departure airport). */
export const zoneDiffHours = (from: string, to: string) => (utcOffsetMin(AIRPORT_BY_CODE[to]) - utcOffsetMin(AIRPORT_BY_CODE[from])) / 60;

/** "+1" or "-1" for an arrival on another date, '' for the same date. */
export const dayMark = (n: number) => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);

/**
 * Every departure (or arrival) in the plan as one chronological list. Times are the clock time at the
 * airport the row is about, or at the base.
 */
export function timeline(plan: Plan, opts: { mode: 'dep' | 'arr'; basis: ClockBasis; airport?: string }) {
  const rows = allFlights(plan)
    .filter((f) => !opts.airport || (opts.mode === 'dep' ? f.from : f.to) === opts.airport)
    .map((f) => {
      const at = opts.mode === 'dep' ? f.from : f.to;
      return { ...f, at, shift: dayShift(plan, opts.basis, f), durMin: f.arrUtc - f.depUtc, zone: zoneDiffHours(f.from, f.to), time: clockAt(plan, opts.basis, at, opts.mode === 'dep' ? f.depUtc : f.arrUtc), other: clockAt(plan, opts.basis, opts.mode === 'dep' ? f.to : f.from, opts.mode === 'dep' ? f.arrUtc : f.depUtc) };
    });
  return rows.sort((x, y) => x.time - y.time || x.at.localeCompare(y.at));
}

/** Flights grouped by airport, each group sorted by time. Busiest airports first unless sorted by code. */
export function byAirport(plan: Plan, opts: { mode: 'dep' | 'arr'; basis: ClockBasis; order: 'busy' | 'code' }) {
  const groups = new Map<string, ReturnType<typeof timeline>>();
  for (const r of timeline(plan, opts)) groups.set(r.at, [...(groups.get(r.at) ?? []), r]);
  const list = [...groups.entries()].map(([code, rows]) => ({ code, rows }));
  return list.sort((x, y) => (opts.order === 'code' ? x.code.localeCompare(y.code) : y.rows.length - x.rows.length || x.code.localeCompare(y.code)));
}

export interface Spoke {
  key: string;
  other: string;
  distKm: number;
  bearing: number; // degrees clockwise from north
  flightsPerDay: number; // each way
  pax: number; // weekly, both directions
  loadFactor: number | null;
  profit: number | null; // weekly route profit, before aircraft lease
}

function bearing(from: string, to: string) {
  const A = AIRPORT_BY_CODE[from], B = AIRPORT_BY_CODE[to];
  const p1 = (A.lat * Math.PI) / 180, p2 = (B.lat * Math.PI) / 180, dl = ((B.lon - A.lon) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return mod((Math.atan2(y, x) * 180) / Math.PI, 360);
}

/** The direct routes the player flies from this airport. */
export function spokes(plan: Plan, result: NetworkResult | null, code: string): Spoke[] {
  const seen = new Map<string, Spoke>();
  for (const f of allFlights(plan)) {
    if (f.from !== code && f.to !== code) continue;
    const other = f.from === code ? f.to : f.from;
    const key = pairKey(code, other);
    const s = seen.get(key) ?? (() => {
      const A = AIRPORT_BY_CODE[code], B = AIRPORT_BY_CODE[other];
      const res = result?.routes[key];
      return {
        key, other, distKm: distanceKm(A.lat, A.lon, B.lat, B.lon), bearing: bearing(code, other), flightsPerDay: 0,
        pax: res?.pax ?? 0, loadFactor: res ? res.loadFactor : null, profit: res ? res.revenue - res.flyingCost : null,
      };
    })();
    if (f.from === code) s.flightsPerDay++;
    seen.set(key, s);
  }
  return [...seen.values()].sort((x, y) => y.pax - x.pax || y.flightsPerDay - x.flightsPerDay);
}

/** Departures and arrivals per local hour of day at an airport. */
export function hourly(plan: Plan, code: string) {
  const dep = Array<number>(24).fill(0), arr = Array<number>(24).fill(0);
  for (const f of allFlights(plan)) {
    if (f.from === code) dep[Math.floor(localMinutes(code, f.depUtc) / 60)]++;
    if (f.to === code) arr[Math.floor(localMinutes(code, f.arrUtc) / 60)]++;
  }
  return { dep, arr };
}

export interface ConnectionGap {
  from: string; // where the traveller starts
  to: string; // where they want to go
  demand: number; // weekly air travellers in that market, one way
  /** Shortest wait among your flights (minutes), or null if none lines up at all. */
  bestWait: number | null;
  /** A local departure time (minutes after midnight) that would connect. */
  suggest: number;
  arriveLocal: number;
}

/**
 * Pairs of your flights through `code` that miss each other: someone could travel from `from` to `to`
 * via this airport, but the wait is too short, too long, or the flights are on the wrong side of the day.
 */
export function connectionGaps(plan: Plan, code: string, limit = 5): ConnectionGap[] {
  const flights = allFlights(plan);
  const arrivals = flights.filter((f) => f.to === code);
  const departures = flights.filter((f) => f.from === code);
  const best = new Map<string, ConnectionGap>();
  for (const a of arrivals) {
    for (const to of new Set(departures.map((d) => d.to))) {
      if (to === a.from || AIRPORT_BY_CODE[to].metro === AIRPORT_BY_CODE[a.from].metro) continue;
      const m = marketBetween(a.from, to);
      const hop1 = distanceKm(AIRPORT_BY_CODE[a.from].lat, AIRPORT_BY_CODE[a.from].lon, AIRPORT_BY_CODE[code].lat, AIRPORT_BY_CODE[code].lon);
      const hop2 = distanceKm(AIRPORT_BY_CODE[code].lat, AIRPORT_BY_CODE[code].lon, AIRPORT_BY_CODE[to].lat, AIRPORT_BY_CODE[to].lon);
      if (!m || !detourOk(m.distKm, hop1 + hop2)) continue;
      const mct = minConnect(code, a.from, to, plan.hub);
      const waits = departures.filter((d) => d.to === to).map((d) => mod(d.depUtc - a.arrUtc, DAY));
      const ok = waits.filter((w) => w >= mct && w <= LONG_LAYOVER_MIN);
      if (ok.length) continue; // already a good connection
      const key = `${a.from}>${to}`;
      const nearest = waits.length ? Math.min(...waits.filter((w) => w >= mct), Infinity) : Infinity;
      const gap: ConnectionGap = {
        from: a.from, to, demand: m.airDemand, bestWait: Number.isFinite(nearest) ? nearest : null,
        suggest: mod(Math.ceil((localMinutes(code, a.arrUtc) + mct + 15) / 5) * 5, DAY), arriveLocal: localMinutes(code, a.arrUtc),
      };
      const prev = best.get(key);
      if (!prev || (gap.bestWait ?? Infinity) < (prev.bestWait ?? Infinity)) best.set(key, gap);
    }
  }
  return [...best.values()].filter((g) => g.demand >= 20).sort((x, y) => y.demand - x.demand).slice(0, limit);
}

export type LinkStatus =
  | 'nonstop' // you already fly it nonstop
  | 'connected' // travellers change planes here within 3 hours
  | 'long' // both legs flown, but the best connection is a long layover or a stopover
  | 'timing' // both legs flown, but the flights do not connect at all
  | 'leg' // one or both legs are not flown yet
  | 'detour'; // going through this airport is too far out of the way

export interface Linkage {
  o: string;
  d: string;
  demand: number; // weekly air travellers between the two today, both directions, all airlines
  /** Weekly air travellers in the market today, both directions, all airlines (also where nobody flies it nonstop). */
  market: number;
  /**
   * Weekly travellers (both directions) you could carry through the hub with quick connections on every flight
   * you already fly on the two legs (at least one a day). Never below what you carry now.
   */
  potential: number;
  /** One of the two legs is (nearly) full, so seats rather than timing hold the connection back. */
  full: boolean;
  /** Weekly travellers (both directions) you could carry through the hub with one well-timed daily connection. */
  est: number;
  distKm: number;
  nonstopPax: number;
  viaPax: number; // weekly, changing planes at the hub
  lost: number; // demand you do not carry
  status: LinkStatus;
  /** Legs to open (the other end of each hub spoke that is missing). */
  missing: string[];
  /** How much longer than flying nonstop the trip through the hub is (0.9 = 90% longer). */
  detourPct: number;
  /** Both legs flown: the longest of the two directions' best layovers, in minutes (null = no connection). */
  wait: number | null;
  /** Both legs flown: the direction with the slower connection (the one to fix). */
  slow?: { from: string; to: string };
  /** Representative scheduled connection in the slower direction, in UTC minutes. */
  itinerary?: { from: string; to: string; firstDep: number; firstArr: number; secondDep: number; secondArr: number };
  /** A flight to add that would make a quick connection: by default out of the hub, or into it (`before` = the hub departure it feeds). */
  suggest?: { from: string; to: string; local: number; arriveLocal: number; bestWait: number | null; before?: number };
  nonstopFlown: boolean;
}

const km = (a: string, b: string) => {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  return distanceKm(A.lat, A.lon, B.lat, B.lon);
};

/**
 * Weekly travellers one way from `o` to `d` that the player would win with `dailyWeight` daily flights
 * (1 = one nonstop at an average time; a connection counts for less). Mirrors the demand step in simulate().
 */
function takeOneWay(plan: Plan, o: string, d: string, dailyWeight: number, fareMult = fareMultOf(plan, pairKey(o, d))): number {
  const m = marketBetween(o, d);
  if (!m || dailyWeight <= 0) return 0;
  const comp = competitionFor(o, d);
  const air = airChoice([{ freq: 7 * dailyWeight, fare: m.refFare * fareMult }, ...comp.offers], m.distKm, m.refFare);
  return respondingAirTotal(m, air.utility, comp) * air.shares[0];
}

/** Seats a week, both directions, on one daily round trip with the usual aircraft for the route (0 if none can fly it). */
export function dailySeats(a: string, b: string): number {
  const t = defaultAircraft(a, b);
  return t ? AIRCRAFT[t].seats * 14 : 0;
}

/** Weekly travellers (both directions) a daily nonstop between a and b would carry, before seat limits. */
export const estimateNonstop = (plan: Plan, a: string, b: string) => takeOneWay(plan, a, b, 1) + takeOneWay(plan, b, a, 1);

/** Weekly travellers (both directions) between o and d through `hub`, with `daily` well-timed connections each way. */
export function estimateVia(plan: Plan, o: string, hub: string, d: string, daily = 1): number {
  return estimateViaOneWay(plan, o, hub, d, daily) + estimateViaOneWay(plan, d, hub, o, daily);
}

/** Weekly travellers from o to d (one way) through `hub`, with `daily` well-timed connections a day. */
export function estimateViaOneWay(plan: Plan, o: string, hub: string, d: string, daily = 1): number {
  const m = marketBetween(o, d);
  if (!m || AIRPORT_BY_CODE[o].metro === AIRPORT_BY_CODE[d].metro) return 0;
  const l1 = km(o, hub), l2 = km(hub, d);
  if (!detourOk(m.distKm, l1 + l2)) return 0;
  const blockH = typicalFlightHours(l1) + typicalFlightHours(l2);
  const w = daily * connectionWeight(blockH, minConnect(hub, o, d, plan.hub) + 30, hub, m.distKm);
  const mult = (fareMultOf(plan, pairKey(o, hub)) * l1 + fareMultOf(plan, pairKey(hub, d)) * l2) / (l1 + l2);
  return takeOneWay(plan, o, d, w, mult * CONNECT_FARE_SHARE);
}

/** Shortest workable layover at `hub` from a flight arriving from `o` to one leaving for `d`. */
function bestWait(flights: BoardFlight[], plan: Plan, o: string, hub: string, d: string) {
  const mct = minConnect(hub, o, d, plan.hub);
  let best: { wait: number; arr: BoardFlight; departure: BoardFlight } | null = null;
  let anyArr: BoardFlight | null = null;
  for (const a of flights) {
    if (a.from !== o || a.to !== hub) continue;
    anyArr ??= a;
    for (const f of flights) {
      if (f.from !== hub || f.to !== d || (a.partner && f.partner)) continue;
      const through = f.ac === a.ac && f.index === a.index + 1;
      const wait = mod(f.depUtc - a.arrUtc, DAY);
      if (wait < (through ? 0 : mct)) continue;
      if (!best || wait < best.wait) best = { wait: through ? 0 : wait, arr: a, departure: f };
    }
  }
  return { best, arr: best?.arr ?? anyArr, mct };
}

interface PairContext {
  plan: Plan;
  result: NetworkResult | null;
  hub: string;
  flights: BoardFlight[];
  flownSet: Set<string>;
  /** Ends flown with your own aircraft (flownSet also has codeshare ends). */
  ownSet: Set<string>;
  flows: TransferFlow[];
  /** Airport pairs (either direction) flown with your own aircraft. */
  ownPairs: Set<string>;
  /** Flights a week per direction (`from>to`), codeshares included. */
  flightsByDir: Map<string, number>;
  /** Transfer travellers per unordered airport pair, and per direction (`from>to`), summed in the order of `flows`. */
  flowsByPair: Map<string, number>;
  flowsByDir: Map<string, number>;
}

function pairContext(plan: Plan, result: NetworkResult | null, hub: string): PairContext {
  const flights = connectingFlights(plan);
  const flownSet = new Set<string>(), ownSet = new Set<string>();
  for (const f of flights) {
    const end = f.from === hub ? f.to : f.to === hub ? f.from : null;
    if (!end) continue;
    flownSet.add(end);
    if (!f.partner) ownSet.add(end);
  }
  const flows = result?.transfers[hub]?.flows ?? [];
  // Lookups built once per context: the scans below run for every candidate market, so they must not walk the lists.
  const ownPairs = new Set<string>(), flightsByDir = new Map<string, number>();
  for (const f of flights) {
    const dir = `${f.from}>${f.to}`;
    flightsByDir.set(dir, (flightsByDir.get(dir) ?? 0) + 1);
    if (!f.partner) ownPairs.add(pairKey(f.from, f.to));
  }
  const flowsByPair = new Map<string, number>(), flowsByDir = new Map<string, number>();
  for (const f of flows) {
    const pk = pairKey(f.from, f.to), dir = `${f.from}>${f.to}`;
    flowsByPair.set(pk, (flowsByPair.get(pk) ?? 0) + f.pax);
    flowsByDir.set(dir, (flowsByDir.get(dir) ?? 0) + f.pax);
  }
  return { plan, result, hub, flights, flownSet, ownSet, flows, ownPairs, flightsByDir, flowsByPair, flowsByDir };
}

/** How the market o-d stands for travel through the hub. Null when it is not a market at all. */
function classify(c: PairContext, o: string, d: string): Linkage | null {
  const { plan, result, hub } = c;
  if (o === d || o === hub || d === hub || AIRPORT_BY_CODE[o].metro === AIRPORT_BY_CODE[d].metro) return null;
  const m = marketBetween(o, d);
  if (!m) return null;
  const demand = m.airDemand * 2;
  const legs = km(o, hub) + km(hub, d);
  const nonstopFlown = c.ownPairs.has(pairKey(o, d));
  const nonstopPax = result?.routes[pairKey(o, d)]?.localPax ?? 0;
  const viaPax = c.flowsByPair.get(pairKey(o, d)) ?? 0;
  // Two codeshare legs don't make a trip: one of them has to be your own flight.
  const missing = [o, d].filter((x) => !c.flownSet.has(x));
  if (!missing.length && !c.ownSet.has(o) && !c.ownSet.has(d)) missing.push(d);
  const ok = detourOk(m.distKm, legs);
  const est = ok ? estimateVia(plan, o, hub, d) : 0;
  // What quick connections could carry: per direction, the flights you fly on its two legs (at least one a day), and
  // never less than that direction carries now.
  const perDay = (a: string, b: string) => c.flightsByDir.get(`${a}>${b}`) ?? 0;
  const viaDir = (a: string, b: string) => c.flowsByDir.get(`${a}>${b}`) ?? 0;
  const reach = (a: string, b: string) => Math.max(viaDir(a, b), estimateViaOneWay(plan, a, hub, b, missing.length ? 1 : Math.max(1, Math.min(perDay(a, hub), perDay(hub, b)))));
  const potential = ok ? reach(o, d) + reach(d, o) : viaPax;
  const full = !missing.length && [pairKey(o, hub), pairKey(hub, d)].some((k) => (result?.routes[k]?.loadFactor ?? 0) >= FULL_LF);
  const market = todaySplit(o, d).total + todaySplit(d, o).total;
  let status: LinkStatus;
  let wait: number | null = null;
  let suggest: Linkage['suggest'];
  let slow: Linkage['slow'];
  let itinerary: Linkage['itinerary'];
  if (nonstopFlown && nonstopPax > 0) status = 'nonstop';
  else if (!ok) status = 'detour';
  else if (missing.length) status = 'leg';
  else {
    // Both legs flown: look at both directions and report the worse one, which is the one to fix.
    // A direction with no flight on one of its legs is skipped (one-way flying), unless neither direction has both.
    const dirs = [{ ...bestWait(c.flights, plan, o, hub, d), from: o, to: d }, { ...bestWait(c.flights, plan, d, hub, o), from: d, to: o }];
    const flownBoth = dirs.filter((x) => x.arr && c.flights.some((f) => f.from === hub && f.to === x.to));
    const worst = (flownBoth.length ? flownBoth : dirs).reduce((p, q) => ((q.best?.wait ?? Infinity) > (p.best?.wait ?? Infinity) ? q : p));
    wait = worst.best ? worst.best.wait : null;
    slow = { from: worst.from, to: worst.to };
    if (worst.best) {
      const { arr, departure } = worst.best;
      const secondDep = arr.arrUtc + mod(departure.depUtc - arr.arrUtc, DAY);
      itinerary = { from: worst.from, to: worst.to, firstDep: arr.depUtc, firstArr: arr.arrUtc, secondDep, secondArr: secondDep + departure.arrUtc - departure.depUtc };
    }
    status = wait === null ? 'timing' : layoverKind(wait) === 'quick' ? 'connected' : 'long';
    if (status !== 'connected' && worst.arr) {
      const arriveLocal = localMinutes(hub, worst.arr.arrUtc);
      suggest = { from: hub, to: worst.to, local: mod(Math.ceil((arriveLocal + worst.mct + 15) / 5) * 5, DAY), arriveLocal, bestWait: wait };
      // A connecting departure in the middle of the night sells badly: then suggest an earlier flight in instead.
      const night = (t: number) => t < 6 * 60 || t >= 22 * 60;
      const out = c.flights.find((f) => f.from === hub && f.to === worst.to && !night(localMinutes(hub, f.depUtc)));
      if (night(suggest.local) && out) {
        const block = blockMinutes(worst.from, hub, worst.arr.ac.type);
        const depUtc = Math.floor((out.depUtc - worst.mct - 15 - block) / 5) * 5;
        const local = localMinutes(worst.from, depUtc);
        if (!night(local)) suggest = { from: worst.from, to: hub, local, arriveLocal: localMinutes(hub, depUtc + block), bestWait: wait, before: localMinutes(hub, out.depUtc) };
      }
    }
  }
  return {
    o, d, demand, market, potential, full, est, distKm: m.distKm, nonstopPax, viaPax, lost: Math.max(0, Math.max(demand, est) - nonstopPax - viaPax), status, missing,
    detourPct: legs / m.distKm - 1, wait, suggest, slow, itinerary, nonstopFlown,
  };
}

/** A leg this full turns connecting travellers away. */
const FULL_LF = 0.95;

const LINK_RANK: Record<LinkStatus, number> = { timing: 0, long: 1, leg: 2, detour: 3, connected: 4, nonstop: 5 };

/**
 * City pairs a traveller could connect between through `hub`: the airports you fly there plus the hub's biggest
 * unserved markets. Shows how much of each market you carry (nonstop, via the hub), and what is missing.
 */
export function linkages(plan: Plan, result: NetworkResult | null, hub: string, limit = 12): Linkage[] {
  const c = pairContext(plan, result, hub);
  const pool = new Set<string>(c.flownSet);
  for (const m of topMarketsFrom(hub, plan, 12)) pool.add(m.to);
  const cands = [...pool];
  const out: Linkage[] = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const l = classify(c, cands[i], cands[j]);
      if (!l || Math.max(l.demand, l.est) < 10) continue;
      if (l.missing.length === 2) continue; // opening two legs at once is too big a step to suggest
      if (l.status === 'detour' && l.missing.length) continue; // only explain detours when both legs are already flown
      out.push(l);
    }
  }
  return out.sort((x, y) => LINK_RANK[x.status] - LINK_RANK[y.status] || y.lost - x.lost).slice(0, limit);
}

export interface SpokeIdea {
  to: string;
  distKm: number;
  /** Weekly travellers (both directions) between the hub and `to` on a daily nonstop. */
  local: number;
  /** Weekly travellers (both directions) who could connect at the hub to or from your other routes. */
  via: number;
  markets: { d: string; est: number }[];
  /** Seats a week, both directions, on one daily round trip with the usual aircraft for the route. */
  seats: number;
}

/**
 * New routes from the hub ranked by what they would bring: their own travellers plus the travellers who
 * could change planes at the hub onto the routes you already fly.
 */
export function hubOpportunities(plan: Plan, hub: string, limit = 6): SpokeIdea[] {
  const c = pairContext(plan, null, hub);
  const flown = [...c.flownSet];
  const pool = new Set<string>();
  for (const m of topMarketsFrom(hub, plan, 25)) if (!m.served) pool.add(m.to);
  for (const y of flown) {
    const top = [...marketsAt(y)].sort((p, q) => q.airDemand - p.airDemand).slice(0, 10);
    for (const m of top) pool.add(m.a === y ? m.b : m.a);
  }
  const ideas: SpokeIdea[] = [];
  for (const x of pool) {
    if (x === hub || c.flownSet.has(x) || AIRPORT_BY_CODE[x].metro === AIRPORT_BY_CODE[hub].metro) continue;
    if (!defaultAircraft(hub, x)) continue;
    const markets: SpokeIdea['markets'] = [];
    for (const y of flown) {
      if (c.ownPairs.has(pairKey(x, y))) continue;
      const est = estimateVia(plan, x, hub, y);
      if (est >= 1) markets.push({ d: y, est });
    }
    markets.sort((p, q) => q.est - p.est);
    ideas.push({ to: x, distKm: km(hub, x), local: estimateNonstop(plan, hub, x), via: markets.reduce((s, m) => s + m.est, 0), markets, seats: dailySeats(hub, x) });
  }
  return ideas.sort((p, q) => q.local + q.via - (p.local + p.via)).slice(0, limit);
}

export interface HubView {
  hub: string;
  code: string;
  legFlown: boolean;
  /** Weekly travellers (both directions) on a daily nonstop between this airport and the hub. */
  local: number;
  /** Weekly travellers who could connect at the hub once this airport is linked to it, on routes you already fly. */
  unlock: number;
  unlockCount: number;
  /** Seats a week, both directions, on one daily round trip between this airport and the hub. */
  seats: number;
  /** Every destination this airport's travellers could reach by changing planes at the hub, biggest first. */
  rows: Linkage[];
  /** Weekly travellers (both directions) from this airport who change planes at the hub on your flights today. */
  now: number;
}

/** Destinations with less weekly transit demand than this are left out of the list. */
const MIN_VIA_PAX = 5;

/** Which bucket a destination falls in, seen from the selected airport. */
export type ViaGroup = 'flown' | 'hubLeg' | 'nonstop';
export const viaGroup = (l: Linkage): ViaGroup =>
  l.status === 'nonstop' ? 'nonstop' : l.missing.some((m) => m !== l.o) ? 'hubLeg' : 'flown';

/**
 * Another airport seen from the hub: every place its travellers could reach by changing planes at the hub, on routes
 * you fly and routes you have not opened yet, with the transit demand of each and the legs that are missing.
 * Uses the same demand and connection rules as the simulation (see estimateVia).
 */
export function viewFromHub(plan: Plan, result: NetworkResult | null, hub: string, code: string): HubView {
  const c = pairContext(plan, result, hub);
  const pool = new Set<string>(c.flownSet);
  for (const m of marketsAt(hub)) pool.add(m.a === hub ? m.b : m.a);
  const rows: Linkage[] = [];
  if (code !== hub) {
    for (const d of pool) {
      const l = classify(c, code, d);
      if (!l || l.status === 'detour' || l.potential < MIN_VIA_PAX) continue;
      rows.push(l);
    }
  }
  rows.sort((x, y) => y.potential - x.potential);
  const unlocking = rows.filter((l) => l.missing.length === 1 && l.missing[0] === code && l.status === 'leg');
  return {
    hub, code, legFlown: c.flownSet.has(code), local: code === hub ? 0 : estimateNonstop(plan, code, hub),
    unlock: unlocking.reduce((s, l) => s + l.est, 0), unlockCount: unlocking.length, seats: code === hub ? 0 : dailySeats(code, hub),
    rows, now: rows.reduce((s, l) => s + l.viaPax, 0),
  };
}

/** Flights to add at or around the hub that would turn slow connections into quick ones, with the markets each one fixes. */
export interface TimingFix {
  suggest: NonNullable<Linkage['suggest']>;
  markets: Linkage[];
  /** Extra weekly travellers (both directions) over all those markets, roughly. */
  gain: number;
}

export interface HubTransit {
  /** Markets with travellers changing planes at the hub on your flights, most travellers first. */
  carried: Linkage[];
  /** One flight each, biggest gain first. */
  fixes: TimingFix[];
}

/**
 * The hub's own transit picture: which city pairs connect through it today and how close each is to what quick
 * connections could carry, and which flights would close the gap. Only pairs whose two legs you already fly.
 */
export function hubTransit(plan: Plan, result: NetworkResult | null, hub: string): HubTransit {
  const c = pairContext(plan, result, hub);
  const ends = [...c.flownSet];
  const rows: Linkage[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const l = classify(c, ends[i], ends[j]);
      if (l && l.status !== 'nonstop' && l.status !== 'detour' && Math.max(l.potential, l.viaPax) >= 1) rows.push(l);
    }
  }
  const carried = rows.filter((l) => l.viaPax >= 0.5).sort((x, y) => y.viaPax - x.viaPax);
  const fixes = new Map<string, TimingFix>();
  for (const l of rows) {
    if (!l.suggest || (l.status !== 'long' && l.status !== 'timing')) continue;
    const k = `${l.suggest.from}>${l.suggest.to}@${l.suggest.local}`;
    const f = fixes.get(k) ?? { suggest: l.suggest, markets: [], gain: 0 };
    f.markets.push(l);
    f.gain += Math.max(0, l.potential - l.viaPax);
    fixes.set(k, f);
  }
  return { carried, fixes: [...fixes.values()].filter((f) => f.gain >= 1).sort((x, y) => y.gain - x.gain) };
}

/** The airport the player builds connections around: the transfer hub when set, otherwise the base. */
export const hubOf = (plan: Plan) => plan.hub ?? plan.base;

export interface StationRow {
  code: string;
  departures: number; // weekly
  slotCap: number;
  routes: number;
  pax: number; // weekly travellers on flights from here
  transferPax: number; // weekly travellers changing planes here
  profit: number | null; // weekly: half of the profit of each route touching it, before lease
  isHub: boolean;
}

/** One row per airport the player flies to or from. */
export function stations(plan: Plan, result: NetworkResult | null): StationRow[] {
  const codes = new Set<string>();
  for (const ac of plan.fleet) for (const l of ac.legs) { codes.add(l.from); codes.add(l.to); }
  return [...codes].map((code) => {
    const sp = spokes(plan, result, code);
    return {
      code,
      departures: weeklyDepartures(plan, code),
      slotCap: AIRPORT_BY_CODE[code].slotCap,
      routes: sp.length,
      pax: sp.reduce((s, x) => s + x.pax / 2, 0),
      transferPax: result?.transfers[code]?.pax ?? 0,
      profit: result ? sp.reduce((s, x) => s + (x.profit ?? 0) / 2, 0) : null,
      isHub: plan.hub === code,
    };
  }).sort((x, y) => y.departures - x.departures || x.code.localeCompare(y.code));
}

/** One market from an airport: how many fly it, how many the player carries, and what an unflown one could bring. */
export interface MarketPotential {
  to: string;
  key: string;
  distKm: number;
  flown: boolean;
  /** Weekly air travellers, both directions, all airlines (with the player's flights when flown). */
  total: number;
  /** Weekly local travellers the player carries. */
  ours: number;
  /** Weekly local travellers who chose the player but found the flights full. */
  spill: number;
  /** Unflown markets: weekly travellers (both directions) one daily round trip would win, before seat limits. */
  estimate: number;
  /** Unflown markets: seats a week on one daily round trip with the usual aircraft (0 = nothing can fly it). */
  seats: number;
  /** Competitor flights a week, both directions (including same-city airports). */
  rivalFlights: number;
}

export interface AirportPotential {
  /** Weekly air travellers in all markets from this airport, both directions. */
  total: number;
  /** Of which the player carries (local travellers only). */
  ours: number;
  /** Weekly connecting travellers changing planes here on the player's flights. */
  transfer: number;
  rows: MarketPotential[];
}

/** Weekly air travellers in all markets from an airport (both directions), and how many fly the player's nonstops. */
export function airportTraffic(result: NetworkResult | null, code: string): { total: number; ours: number } {
  let total = 0, ours = 0;
  for (const m of marketsAt(code)) {
    const r = result?.routes[pairKey(m.a, m.b)];
    total += r ? r.airTotal : 2 * m.airDemand;
    ours += r ? r.localPax : 0;
  }
  return { total, ours };
}

/**
 * The airport's market potential: every market's air travellers against what the player carries, plus the
 * biggest unflown markets (by today's traffic, and by potential where nobody flies yet) with an estimate of
 * what one daily round trip would win.
 */
export function marketPotential(plan: Plan, result: NetworkResult | null, code: string, limit = 40): AirportPotential {
  const all = marketsAt(code);
  const { total, ours } = airportTraffic(result, code);
  const flown = new Set(spokes(plan, result, code).map((s) => s.other));
  const other = (m: { a: string; b: string }) => (m.a === code ? m.b : m.a);
  const byTraffic = [...all].sort((x, y) => y.airDemand - x.airDemand).slice(0, limit);
  const unserved = all.filter((m) => m.airDemand <= 0).sort((x, y) => y.potential - x.potential).slice(0, Math.ceil(limit / 3));
  const picked = new Map<string, (typeof all)[number]>();
  for (const m of [...byTraffic, ...unserved]) picked.set(other(m), m);
  for (const to of flown) { const m = marketBetween(code, to); if (m) picked.set(to, m); }
  const rows: MarketPotential[] = [...picked.entries()].map(([to, m]) => {
    const key = pairKey(code, to);
    const r = result?.routes[key];
    const rivalFlights = [competitionFor(code, to), competitionFor(to, code)].reduce((s, c) => s + c.services.reduce((t, x) => t + x.freq, 0), 0);
    if (r && flown.has(to)) {
      return { to, key, distKm: m.distKm, flown: true, total: r.airTotal, ours: r.localPax, spill: Math.max(0, r.localDemand - r.localPax), estimate: 0, seats: 0, rivalFlights };
    }
    return {
      to, key, distKm: m.distKm, flown: false, total: todaySplit(code, to).total + todaySplit(to, code).total, ours: 0, spill: 0,
      estimate: estimateNonstop(plan, code, to), seats: dailySeats(code, to), rivalFlights,
    };
  });
  const size = (x: MarketPotential) => Math.max(x.total, x.ours + x.spill, x.estimate);
  rows.sort((x, y) => size(y) - size(x) || x.to.localeCompare(y.to));
  return { total, ours, transfer: result?.transfers[code]?.pax ?? 0, rows: rows.filter((x) => size(x) >= 5) };
}

export { HUB_COST_PER_WEEK };
