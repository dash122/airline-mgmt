// Per-airport views of the player's network: spokes, departure boards, connection banks and gaps.
// Reads the plan (and a simulation result when given). Never loops over all airports, only the player's flights.
import { AIRCRAFT } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, marketsAt, pairKey } from './markets';
import {
  blockMinutes, competitionFor, connectionWeight, DAY, fareMultOf, respondingAirTotal, defaultAircraft, detourOk, HUB_COST_PER_WEEK, layoverKind, localMinutes, LONG_LAYOVER_MIN, minConnect,
  topMarketsFrom, utcOffsetMin, weeklyDepartures, type Aircraft, type Leg, type NetworkResult, type Plan, type TransferFlow,
} from './simulate';
import { airChoice, blockHours } from './choice';
import { distanceKm } from './geo';

export interface BoardFlight {
  ac: Aircraft;
  index: number;
  leg: Leg;
  from: string;
  to: string;
  depUtc: number;
  arrUtc: number;
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
  /** A departure from the hub that would make a quick connection. */
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

/** Weekly travellers (both directions) between o and d through `hub`, with one well-timed daily connection each way. */
export function estimateVia(plan: Plan, o: string, hub: string, d: string): number {
  const m = marketBetween(o, d);
  if (!m || AIRPORT_BY_CODE[o].metro === AIRPORT_BY_CODE[d].metro) return 0;
  const l1 = km(o, hub), l2 = km(hub, d);
  if (!detourOk(m.distKm, l1 + l2)) return 0;
  const blockH = blockHours(l1) + blockHours(l2);
  const w1 = connectionWeight(blockH, minConnect(hub, o, d, plan.hub) + 30, hub, m.distKm);
  const mult = (fareMultOf(plan, pairKey(o, hub)) * l1 + fareMultOf(plan, pairKey(hub, d)) * l2) / (l1 + l2);
  return takeOneWay(plan, o, d, w1, mult) + takeOneWay(plan, d, o, w1, mult);
}

/** Shortest workable layover at `hub` from a flight arriving from `o` to one leaving for `d`. */
function bestWait(flights: BoardFlight[], plan: Plan, o: string, hub: string, d: string) {
  const mct = minConnect(hub, o, d, plan.hub);
  let best: { wait: number; arr: BoardFlight } | null = null;
  let anyArr: BoardFlight | null = null;
  for (const a of flights) {
    if (a.from !== o || a.to !== hub) continue;
    anyArr ??= a;
    for (const f of flights) {
      if (f.from !== hub || f.to !== d) continue;
      const through = f.ac === a.ac && f.index === a.index + 1;
      const wait = mod(f.depUtc - a.arrUtc, DAY);
      if (wait < (through ? 0 : mct)) continue;
      if (!best || wait < best.wait) best = { wait: through ? 0 : wait, arr: a };
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
  flows: TransferFlow[];
}

function pairContext(plan: Plan, result: NetworkResult | null, hub: string): PairContext {
  const flights = allFlights(plan);
  const flownSet = new Set<string>();
  for (const f of flights) { if (f.from === hub) flownSet.add(f.to); if (f.to === hub) flownSet.add(f.from); }
  return { plan, result, hub, flights, flownSet, flows: result?.transfers[hub]?.flows ?? [] };
}

/** How the market o-d stands for travel through the hub. Null when it is not a market at all. */
function classify(c: PairContext, o: string, d: string): Linkage | null {
  const { plan, result, hub } = c;
  if (o === d || o === hub || d === hub || AIRPORT_BY_CODE[o].metro === AIRPORT_BY_CODE[d].metro) return null;
  const m = marketBetween(o, d);
  if (!m) return null;
  const demand = m.airDemand * 2;
  const legs = km(o, hub) + km(hub, d);
  const nonstopFlown = c.flights.some((f) => pairKey(f.from, f.to) === pairKey(o, d));
  const nonstopPax = result?.routes[pairKey(o, d)]?.localPax ?? 0;
  const viaPax = c.flows.filter((f) => (f.from === o && f.to === d) || (f.from === d && f.to === o)).reduce((s, f) => s + f.pax, 0);
  const missing = [o, d].filter((x) => !c.flownSet.has(x));
  const ok = detourOk(m.distKm, legs);
  const est = ok ? estimateVia(plan, o, hub, d) : 0;
  let status: LinkStatus;
  let wait: number | null = null;
  let suggest: Linkage['suggest'];
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
    o, d, demand, est, distKm: m.distKm, nonstopPax, viaPax, lost: Math.max(0, Math.max(demand, est) - nonstopPax - viaPax), status, missing,
    detourPct: legs / m.distKm - 1, wait, suggest, nonstopFlown,
  };
}

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
      if (c.flights.some((f) => pairKey(f.from, f.to) === pairKey(x, y))) continue;
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
  rows: Linkage[];
}

/**
 * Another airport seen from the hub: where its travellers could go by changing planes at the hub,
 * what is already carried, and which legs are missing.
 */
export function viewFromHub(plan: Plan, result: NetworkResult | null, hub: string, code: string, limit = 10): HubView {
  const c = pairContext(plan, result, hub);
  const pool = new Set<string>(c.flownSet);
  for (const m of [...marketsAt(code)].sort((p, q) => q.airDemand - p.airDemand).slice(0, 20)) pool.add(m.a === code ? m.b : m.a);
  const rows: Linkage[] = [];
  for (const d of pool) {
    const l = code === hub ? null : classify(c, code, d);
    if (!l || l.status === 'detour' || Math.max(l.est, l.viaPax) < 1) continue;
    rows.push(l);
  }
  const unlocking = rows.filter((l) => l.missing.length === 1 && l.missing[0] === code && l.status === 'leg');
  rows.sort((x, y) => Number(x.status === 'nonstop') - Number(y.status === 'nonstop') || x.missing.length - y.missing.length || y.est - x.est);
  return {
    hub, code, legFlown: c.flownSet.has(code), local: code === hub ? 0 : estimateNonstop(plan, code, hub),
    unlock: unlocking.reduce((s, l) => s + l.est, 0), unlockCount: unlocking.length, seats: code === hub ? 0 : dailySeats(code, hub), rows: rows.slice(0, limit),
  };
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

export { HUB_COST_PER_WEEK };
