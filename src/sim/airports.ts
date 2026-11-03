// Per-airport views of the player's network: spokes, departure boards, connection banks and gaps.
// Reads the plan (and a simulation result when given). Never loops over all airports, only the player's flights.
import { AIRPORT_BY_CODE } from '../data/airports';
import { marketBetween, pairKey } from './markets';
import {
  blockMinutes, DAY, detourOk, HUB_COST_PER_WEEK, localMinutes, minConnect, topMarketsFrom, utcOffsetMin, weeklyDepartures,
  type Aircraft, type Leg, type NetworkResult, type Plan,
} from './simulate';
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
      const ok = waits.filter((w) => w >= mct && w <= 150);
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
  | 'connected' // travellers already change planes at this airport
  | 'timing' // both legs flown, but the flights miss each other
  | 'leg' // one or both legs are not flown yet
  | 'detour'; // going through this airport is too far out of the way

export interface Linkage {
  o: string;
  d: string;
  demand: number; // weekly air travellers between the two, both directions, all airlines
  distKm: number;
  nonstopPax: number;
  viaPax: number; // weekly, changing planes at the hub
  lost: number; // demand you do not carry
  status: LinkStatus;
  /** Legs to open (the other end of each hub spoke that is missing). */
  missing: string[];
  /** For 'detour': how much longer than flying nonstop the trip through the hub is (0.9 = 90% longer). */
  detourPct: number;
  /** For 'timing': a departure from the hub that would connect. */
  suggest?: { from: string; to: string; local: number; arriveLocal: number; bestWait: number | null };
  nonstopFlown: boolean;
}

/**
 * City pairs a traveller could connect between through `hub`: the airports you fly there plus the hub's biggest
 * unserved markets. Shows how much of each market you carry (nonstop, via the hub), and what is missing.
 */
export function linkages(plan: Plan, result: NetworkResult | null, hub: string, limit = 12): Linkage[] {
  const flown = spokes(plan, result, hub);
  const flownSet = new Set(flown.map((s) => s.other));
  const pool = new Set<string>(flownSet);
  for (const m of topMarketsFrom(hub, plan, 12)) pool.add(m.to);
  const cands = [...pool];
  const gaps = connectionGaps(plan, hub, 200);
  const flows = result?.transfers[hub]?.flows ?? [];
  const H = AIRPORT_BY_CODE[hub];
  const out: Linkage[] = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const o = cands[i], d = cands[j];
      if (AIRPORT_BY_CODE[o].metro === AIRPORT_BY_CODE[d].metro) continue;
      const m = marketBetween(o, d);
      if (!m || m.airDemand < 10) continue;
      // The pair needs at least one leg you already fly, or be reachable by opening at most two legs.
      const demand = m.airDemand * 2;
      const legs = distanceKm(AIRPORT_BY_CODE[o].lat, AIRPORT_BY_CODE[o].lon, H.lat, H.lon) + distanceKm(H.lat, H.lon, AIRPORT_BY_CODE[d].lat, AIRPORT_BY_CODE[d].lon);
      const nonstop = result?.routes[pairKey(o, d)];
      const nonstopFlown = plan.fleet.some((ac) => ac.legs.some((l) => pairKey(l.from, l.to) === pairKey(o, d)));
      const nonstopPax = nonstop?.localPax ?? 0;
      const viaPax = flows.filter((f) => (f.from === o && f.to === d) || (f.from === d && f.to === o)).reduce((s, f) => s + f.pax, 0);
      const missing = [o, d].filter((c) => !flownSet.has(c));
      if (missing.length === 2) continue; // opening two legs at once is too big a step to suggest
      const ok = detourOk(m.distKm, legs);
      const gap = gaps.filter((g) => (g.from === o && g.to === d) || (g.from === d && g.to === o)).sort((x, y) => (x.bestWait ?? Infinity) - (y.bestWait ?? Infinity))[0];
      let status: LinkStatus;
      if (nonstopFlown && nonstopPax > 0) status = 'nonstop';
      else if (!ok) { if (missing.length) continue; status = 'detour'; } // only explain detours when both legs are already flown
      else if (missing.length === 0 && gap) status = 'timing'; // flown both ways, but no short connection (long layovers may still carry a few)
      else if (viaPax > 0.5) status = 'connected';
      else if (missing.length === 0) status = 'timing';
      else status = 'leg';
      out.push({
        o, d, demand, distKm: m.distKm, nonstopPax, viaPax, lost: Math.max(0, demand - nonstopPax - viaPax), status, missing, detourPct: legs / m.distKm - 1, nonstopFlown,
        suggest: status === 'timing' && gap ? { from: hub, to: gap.to, local: gap.suggest, arriveLocal: gap.arriveLocal, bestWait: gap.bestWait } : undefined,
      });
    }
  }
  const rank: Record<LinkStatus, number> = { timing: 0, leg: 1, detour: 2, connected: 3, nonstop: 4 };
  return out.sort((x, y) => rank[x.status] - rank[y.status] || y.lost - x.lost).slice(0, limit);
}

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
