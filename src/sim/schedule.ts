// Schedule editing helpers: group legs into round trips, move or remove any of them,
// and find where a new round trip fits in each aircraft's day.
import { AIRCRAFT, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from './markets';
import {
  blockMinutes, DAY, defaultAircraft, newAircraft, rotationInfo, routeProblem, utcFromLocal, weeklyDepartures,
  type Aircraft, type Leg, type Plan,
} from './simulate';

/** A run of legs in one aircraft's day: a round trip (A→B→A) or a single leg. */
export interface Unit {
  start: number;
  count: number;
}

const ready = (ac: Aircraft, l: Leg) => l.dep + blockMinutes(l.from, l.to, ac.type) + AIRCRAFT[ac.type].turnMin;
const round5 = (x: number) => Math.round(x / 5) * 5;

export function units(ac: Aircraft): Unit[] {
  const out: Unit[] = [];
  const L = ac.legs;
  for (let i = 0; i < L.length; ) {
    if (i + 1 < L.length && L[i + 1].from === L[i].to && L[i + 1].to === L[i].from) {
      out.push({ start: i, count: 2 });
      i += 2;
    } else {
      out.push({ start: i, count: 1 });
      i += 1;
    }
  }
  return out;
}

export const unitOf = (ac: Aircraft, legIndex: number): Unit =>
  units(ac).find((u) => legIndex >= u.start && legIndex < u.start + u.count) ?? { start: legIndex, count: 1 };

/** How many minutes a unit can move earlier (min, ≤ 0) or later (max, ≥ 0) without touching other flights or going past 24 hours. */
export function shiftWindow(ac: Aircraft, u: Unit): { min: number; max: number } {
  const L = ac.legs, n = L.length;
  const first = u.start, last = u.start + u.count - 1;
  if (first === 0 && last === n - 1) return { min: -12 * 60, max: 12 * 60 };
  let min = -DAY, max = DAY;
  if (first > 0) min = ready(ac, L[first - 1]) - L[first].dep;
  else min = ready(ac, L[n - 1]) - DAY - L[0].dep;
  if (last < n - 1) max = L[last + 1].dep - ready(ac, L[last]);
  else max = L[0].dep + DAY - ready(ac, L[last]);
  min = Math.ceil(min / 5) * 5;
  max = Math.floor(max / 5) * 5;
  return { min: Math.min(0, min), max: Math.max(0, max) };
}

export function shiftUnit(ac: Aircraft, u: Unit, delta: number): Aircraft {
  const w = shiftWindow(ac, u);
  const d = Math.max(w.min, Math.min(w.max, delta));
  if (!d) return ac;
  return { ...ac, legs: ac.legs.map((l, i) => (i >= u.start && i < u.start + u.count ? { ...l, dep: l.dep + d } : l)) };
}

export function removeUnit(ac: Aircraft, u: Unit): Aircraft {
  return { ...ac, legs: ac.legs.filter((_, i) => i < u.start || i >= u.start + u.count) };
}

/** Where the aircraft is before gap k (k = 0 is before its first flight). Null if it has no flights yet. */
export function stationAt(ac: Aircraft, k: number): string | null {
  if (!ac.legs.length) return null;
  return k > 0 ? ac.legs[k - 1].to : ac.legs[0].from;
}

/** Departure times (UTC minutes) at which a round trip from→to→from fits into gap k, or null. */
export function insertWindow(ac: Aircraft, k: number, from: string, to: string): { lo: number; hi: number } | null {
  const L = ac.legs, n = L.length, t = AIRCRAFT[ac.type].turnMin;
  const span = blockMinutes(from, to, ac.type) + t + blockMinutes(to, from, ac.type) + t;
  if (span > DAY) return null;
  let lo = -Infinity, hi = Infinity;
  if (k > 0) lo = ready(ac, L[k - 1]);
  if (k < n) hi = L[k].dep - span;
  if (n > 0 && k === 0) lo = Math.max(lo, ready(ac, L[n - 1]) - DAY);
  if (n > 0 && k === n) hi = Math.min(hi, L[0].dep + DAY - span);
  if (Number.isFinite(lo)) lo = Math.ceil(lo / 5) * 5;
  if (Number.isFinite(hi)) hi = Math.floor(hi / 5) * 5;
  return lo <= hi ? { lo, hi } : null;
}

/** The time in [lo, hi] nearest to `prefer`, treating `prefer` as a time of day. */
export function pickTime(w: { lo: number; hi: number }, prefer: number): number {
  let best = prefer, bestDist = Infinity;
  for (let m = -3; m <= 3; m++) {
    const t = prefer + m * DAY;
    const c = Math.max(w.lo, Math.min(w.hi, t));
    const d = Math.abs(c - t) + Math.abs(m) * 1e-3;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return round5(Math.max(w.lo, Math.min(w.hi, best)));
}

export function insertRoundTrip(ac: Aircraft, k: number, from: string, to: string, dep: number): Aircraft {
  const back = dep + blockMinutes(from, to, ac.type) + AIRCRAFT[ac.type].turnMin;
  const legs = [...ac.legs];
  legs.splice(k, 0, { from, to, dep }, { from: to, to: from, dep: back });
  return { ...ac, legs };
}

export interface Placement {
  acId: string;
  /** Null for a newly leased aircraft. */
  k: number;
  from: string;
  to: string;
  dep: number;
  lo: number;
  hi: number;
}

export interface PlacementOption {
  ac: Aircraft;
  placement: Placement | null;
  reason?: string;
  /** Utilisation before and after. */
  utilBefore: number;
  utilAfter: number;
}

const morning = (code: string) => utcFromLocal(code, 7 * 60);

/** Best placement of one round trip on a↔b on this aircraft, nearest to `prefer` if given. */
export function placeOn(ac: Aircraft, a: string, b: string, prefer?: number, base?: string): Placement | null {
  let best: Placement | null = null, bestScore = Infinity;
  const n = ac.legs.length;
  for (let k = 0; k <= n; k++) {
    const st = stationAt(ac, k);
    const dirs: [string, string][] = st === null ? (b === base ? [[b, a], [a, b]] : [[a, b], [b, a]]) : st === a ? [[a, b]] : st === b ? [[b, a]] : [];
    for (const [from, to] of dirs) {
      const w = insertWindow(ac, k, from, to);
      if (!w) continue;
      const target = prefer ?? (k === n && n > 0 ? w.lo : k === 0 && n > 0 ? w.hi : morning(from));
      const dep = pickTime(w, target);
      // Prefer the requested time; otherwise prefer adding at the end of the day.
      const score = prefer !== undefined ? Math.abs(dep - target) : (k === n ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = { acId: ac.id, k, from, to, dep, lo: w.lo, hi: w.hi }; }
      if (st === null) break;
    }
  }
  return best;
}

/** Slot problem for adding one more daily round trip on a↔b, if any. */
export function slotProblem(plan: Plan, a: string, b: string): string | null {
  for (const c of [a, b]) if (weeklyDepartures(plan, c) + 7 > AIRPORT_BY_CODE[c].slotCap) return `${AIRPORT_BY_CODE[c].name}時間帶已滿`;
  return null;
}

/** Every aircraft, with where a round trip on a↔b would fit (or why it can't). Best options first. */
export function placementOptions(plan: Plan, a: string, b: string, prefer?: number): PlacementOption[] {
  const out: PlacementOption[] = plan.fleet.map((ac) => {
    const utilBefore = rotationInfo(ac).utilisation;
    const problem = routeProblem(a, b, ac.type);
    if (problem) return { ac, placement: null, reason: problem, utilBefore, utilAfter: utilBefore };
    const p = placeOn(ac, a, b, prefer, plan.base);
    if (!p) {
      const here = ac.legs.length ? new Set(ac.legs.map((l) => l.from)) : null;
      const reason = here && !here.has(a) && !here.has(b) ? '不經過這兩個機場' : '當天沒有足夠空檔';
      return { ac, placement: null, reason, utilBefore, utilAfter: utilBefore };
    }
    const utilAfter = rotationInfo(insertRoundTrip(ac, p.k, p.from, p.to, p.dep)).utilisation;
    return { ac, placement: p, utilBefore, utilAfter };
  });
  return out.sort((x, y) => (x.placement ? 0 : 1) - (y.placement ? 0 : 1) || x.utilBefore - y.utilBefore);
}

export function applyPlacement(plan: Plan, p: Placement): Plan {
  return { ...plan, fleet: plan.fleet.map((ac) => (ac.id === p.acId ? insertRoundTrip(ac, p.k, p.from, p.to, p.dep) : ac)) };
}

/** Lease a new aircraft of `type` and give it one round trip on a↔b, starting from the base end if there is one. */
export function leaseFor(plan: Plan, a: string, b: string, type: AircraftModel, dep?: number): { plan: Plan; aircraftId: string } {
  const ac = newAircraft(plan, type);
  const [from, to] = b === plan.base ? [b, a] : [a, b];
  const d = dep ?? morning(from);
  const placed = insertRoundTrip(ac, 0, from, to, d);
  return { plan: { ...plan, fleet: [...plan.fleet, placed] }, aircraftId: ac.id };
}

/** Types that can fly a↔b, the route's current type first. */
export function typesFor(plan: Plan, a: string, b: string): AircraftModel[] {
  const key = pairKey(a, b);
  const used = plan.fleet.filter((ac) => ac.legs.some((l) => pairKey(l.from, l.to) === key)).map((ac) => ac.type);
  const all = (Object.keys(AIRCRAFT) as AircraftModel[]).filter((t) => !routeProblem(a, b, t));
  const first = used[0] ?? defaultAircraft(a, b) ?? all[0];
  return first ? [first, ...all.filter((t) => t !== first)] : all;
}

/** All round trips (and stray single legs) flown on a route. */
export function unitsOnRoute(plan: Plan, key: string): { ac: Aircraft; unit: Unit }[] {
  const out: { ac: Aircraft; unit: Unit }[] = [];
  for (const ac of plan.fleet) for (const u of units(ac)) if (pairKey(ac.legs[u.start].from, ac.legs[u.start].to) === key) out.push({ ac, unit: u });
  return out;
}

const withAircraft = (plan: Plan, ac: Aircraft): Plan => ({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) });

/** Remove the round trip on this route that leaves latest in the day. Null if the route has no round trips. */
export function removeOneRoundTrip(plan: Plan, key: string, localDep: (code: string, utc: number) => number): Plan | null {
  const trips = unitsOnRoute(plan, key).filter((x) => x.unit.count === 2);
  if (!trips.length) return null;
  const leg = (x: { ac: Aircraft; unit: Unit }) => x.ac.legs[x.unit.start];
  trips.sort((x, y) => localDep(leg(y).from, leg(y).dep) - localDep(leg(x).from, leg(x).dep));
  const { ac, unit } = trips[0];
  return withAircraft(plan, removeUnit(ac, unit));
}

/** Remove every flight on a route. */
export function closeRoute(plan: Plan, key: string): Plan {
  return {
    ...plan,
    fleet: plan.fleet.map((ac) => {
      const keep = ac.legs.filter((l) => pairKey(l.from, l.to) !== key);
      return keep.length === ac.legs.length ? ac : { ...ac, legs: keep };
    }),
    fares: Object.fromEntries(Object.entries(plan.fares).filter(([k]) => k !== key)),
  };
}

/** Move a round trip to another aircraft at the given placement. */
export function moveUnit(plan: Plan, fromAcId: string, u: Unit, p: Placement): Plan {
  const src = plan.fleet.find((x) => x.id === fromAcId)!;
  return applyPlacement(withAircraft(plan, removeUnit(src, u)), p);
}

/** Which gap of an aircraft's day a tap at UTC time t falls in, as the index of the next leg. */
export function gapAt(ac: Aircraft, t: number): number {
  if (!ac.legs.length) return 0;
  const first = ac.legs[0].dep;
  const tt = first + ((((t - first) % DAY) + DAY) % DAY);
  return ac.legs.filter((l) => l.dep < tt).length;
}
