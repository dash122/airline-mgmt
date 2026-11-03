// Market model: weekly travel demand between every pair of airports, scaled from catchment population,
// travel propensity, tourism pull and distance, then calibrated to a few national air-travel totals.
// Deterministic: same data in, same markets out.
import { AIRPORTS, AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { hasCompetitorRoute } from '../data/competitor-network';
import { AIR_TARGETS_M, DISTANCE_EXPONENT, GROUND, ISLAND_PROPENSITY, MASS_EXPONENT, TRAVEL_PROPENSITY } from '../data/calibration';
import { distanceKm } from './geo';
import { airUtility, groundUtility, noTravelUtility, type GroundOption } from './choice';

export interface Market {
  a: string;
  b: string;
  distKm: number;
  group: string;
  /** Weekly travellers per direction who would consider the trip (all modes plus not travelling). */
  potential: number;
  /** Weekly air passengers per direction with today's service (other airlines only). */
  airDemand: number;
  /** Reference one-way fare, NT$. */
  refFare: number;
  /** Weekly flights per direction by other airlines (0 = no existing service). */
  rivalFreq: number;
  ground?: GroundOption;
}

export const MIN_MARKET_KM = 100;
const SEATS_PER_RIVAL_FLIGHT = 150 * 0.8;
const MIN_RIVAL_FREQ = 3;

/** Average one-way fare across all cabins and booking classes, NT$. */
export const refFare = (distKm: number) => Math.max(1800, Math.round((1500 + 2.6 * distKm) / 10) * 10);
export const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const groupOf = (a: Airport, b: Airport) => [a.country, b.country].sort().join('-');

export const isIsland = (a: Airport) => !['jp-main', 'tw-main', 'prd'].includes(a.landmass) && !a.landmass.startsWith('main-');

/** Nearest mainland airport within ferry range of an island airport (a stand-in for the ferry port). */
const ferryCache = new Map<string, { port: Airport; km: number } | null>();
function ferryPort(isl: Airport) {
  if (!ferryCache.has(isl.code)) {
    let best: { port: Airport; km: number } | null = null;
    for (const p of AIRPORTS) {
      if (p.country !== isl.country || isIsland(p)) continue;
      const km = distanceKm(isl.lat, isl.lon, p.lat, p.lon);
      if (km <= GROUND.ferry.maxKm && (!best || km < best.km)) best = { port: p, km };
    }
    ferryCache.set(isl.code, best);
  }
  return ferryCache.get(isl.code)!;
}

function landOption(a: Airport, b: Airport, distKm: number): GroundOption | undefined {
  if (a.landmass !== b.landmass) return undefined;
  if (a.landmass === 'prd') return { name: GROUND.bridge.name, hours: GROUND.bridge.hours, fare: GROUND.bridge.fare, comfort: GROUND.bridge.comfort };
  const km = distKm * GROUND.detour;
  const mode = a.hsr && b.hsr ? GROUND.hsr : GROUND.conventional;
  return { name: mode.name, hours: km / mode.speed + GROUND.accessHours, fare: km * mode.farePerKm, comfort: mode.comfort };
}

/** Best way to make the trip without flying: rail/road, a bridge, or a ferry then rail/road. */
export function groundOption(a: Airport, b: Airport, distKm: number): GroundOption | undefined {
  let opt = landOption(a, b, distKm);
  if (!opt && isIsland(a) !== isIsland(b)) {
    const [isl, other] = isIsland(a) ? [a, b] : [b, a];
    const f = ferryPort(isl);
    if (f) {
      const ferry = { name: GROUND.ferry.name, hours: (f.km * GROUND.detour) / GROUND.ferry.speed + 0.5, fare: f.km * GROUND.detour * GROUND.ferry.farePerKm, comfort: GROUND.ferry.comfort };
      if (other.metro === f.port.metro) opt = ferry;
      else {
        const onward = landOption(f.port, other, distanceKm(f.port.lat, f.port.lon, other.lat, other.lon));
        if (onward) opt = { name: `${ferry.name}+${onward.name}`, hours: ferry.hours + onward.hours, fare: ferry.fare + onward.fare, comfort: ferry.comfort };
      }
    }
  }
  return opt && { ...opt, hours: Math.round(opt.hours * 10) / 10, fare: Math.round(opt.fare / 10) * 10 };
}

/** Air share and rival frequency for a market of given size, with only other airlines flying. */
function baseline(potential: number, fare: number, distKm: number, ground?: GroundOption) {
  const uGround = ground ? Math.exp(groundUtility(ground)) : 0;
  const uNone = Math.exp(noTravelUtility(fare, distKm));
  let freq = 7;
  let air = 0;
  for (let i = 0; i < 8; i++) {
    const uAir = Math.exp(airUtility(fare, distKm, freq));
    air = (potential * uAir) / (uAir + uGround + uNone);
    const next = air / SEATS_PER_RIVAL_FLIGHT;
    if (next < MIN_RIVAL_FREQ) return { air: 0, freq: 0 };
    freq = next;
  }
  return { air, freq: Math.round(freq) };
}

function buildMarkets(): Map<string, Market> {
  const mass = AIRPORTS.map((a) =>
    Math.pow(a.catchment * (TRAVEL_PROPENSITY[a.country] ?? 1) * a.tourism * (isIsland(a) ? ISLAND_PROPENSITY : 1), MASS_EXPONENT),
  );
  const raw: { i: number; j: number; distKm: number; gravity: number; group: string; ground?: GroundOption }[] = [];
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const a = AIRPORTS[i], b = AIRPORTS[j];
      if (a.metro === b.metro) continue;
      const distKm = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (distKm < MIN_MARKET_KM) continue;
      const gravity = (mass[i] * mass[j]) / Math.pow(Math.max(distKm, 150) / 100, DISTANCE_EXPONENT);
      raw.push({ i, j, distKm, gravity, group: groupOf(a, b), ground: groundOption(a, b, distKm) });
    }
  }
  // Calibrate one scale per group so modelled air travel matches the group's target.
  const scale: Record<string, number> = {};
  const totalGravity: Record<string, number> = {};
  for (const r of raw) totalGravity[r.group] = (totalGravity[r.group] ?? 0) + r.gravity;
  const targetWeekly = (g: string) => ((AIR_TARGETS_M[g] ?? 0.1) * 1e6) / 52 / 2;
  for (const g of Object.keys(totalGravity)) scale[g] = (targetWeekly(g) * 3) / totalGravity[g];
  for (let iter = 0; iter < 30; iter++) {
    const air: Record<string, number> = {};
    for (const r of raw) {
      if (!(r.group in AIR_TARGETS_M) || !hasCompetitorRoute(AIRPORTS[r.i], AIRPORTS[r.j])) continue;
      const b = baseline(r.gravity * scale[r.group], refFare(r.distKm), r.distKm, r.ground);
      air[r.group] = (air[r.group] ?? 0) + b.air;
    }
    for (const g of Object.keys(scale).filter(g => g in AIR_TARGETS_M)) scale[g] *= Math.pow(targetWeekly(g) / Math.max(air[g] ?? 0, 1), 0.7);
  }

  // Uncalibrated global markets inherit the regional reference gravity scale.
  for (const g of Object.keys(scale)) if (!(g in AIR_TARGETS_M)) scale[g] = scale['JP-TW'];
  const out = new Map<string, Market>();
  for (const r of raw) {
    const potential = r.gravity * scale[r.group];
    const fare = refFare(r.distKm);
    const b = hasCompetitorRoute(AIRPORTS[r.i], AIRPORTS[r.j])
      ? baseline(potential, fare, r.distKm, r.ground)
      : { air: 0, freq: 0 };
    out.set(pairKey(AIRPORTS[r.i].code, AIRPORTS[r.j].code), {
      a: AIRPORTS[r.i].code,
      b: AIRPORTS[r.j].code,
      distKm: r.distKm,
      group: r.group,
      potential,
      airDemand: b.air,
      refFare: fare,
      rivalFreq: b.freq,
      ground: r.ground,
    });
  }
  // Simulated destination budgets keep potential demand separate from nonstop service.
  const limits = { hub: 100, major: 60, large: 30, medium: 12, small: 4 };
  const degree = new Map<string, number>();
  const candidates = [...out.values()].filter(m => m.rivalFreq > 0)
    .sort((a, b) => b.airDemand - a.airDemand || pairKey(a.a, a.b).localeCompare(pairKey(b.a, b.b)));
  for (const m of candidates) {
    const a = AIRPORT_BY_CODE[m.a], b = AIRPORT_BY_CODE[m.b];
    if ((degree.get(m.a) ?? 0) >= limits[a.size] || (degree.get(m.b) ?? 0) >= limits[b.size]
      || m.distKm > 15000
      || (m.distKm > 4500 && ![a, b].every(x => x.size === 'hub' || x.size === 'major'))) {
      m.rivalFreq = 0;
      m.airDemand = 0;
    } else {
      degree.set(m.a, (degree.get(m.a) ?? 0) + 1);
      degree.set(m.b, (degree.get(m.b) ?? 0) + 1);
    }
  }
  // Preserve calibrated regional totals on the retained network.
  const retained = candidates.filter(m => m.rivalFreq > 0);
  for (let iter = 0; iter < 20; iter++) {
    const totals: Record<string, number> = {};
    for (const m of retained) totals[m.group] = (totals[m.group] ?? 0) + m.airDemand;
    for (const m of retained) {
      if (!(m.group in AIR_TARGETS_M)) continue;
      m.potential *= Math.pow(targetWeekly(m.group) / Math.max(totals[m.group], 1), 0.7);
      const b = baseline(m.potential, m.refFare, m.distKm, m.ground);
      m.airDemand = b.air;
      m.rivalFreq = b.freq;
    }
  }
  return out;
}

let cache: Map<string, Market> | null = null;
export function markets(): Map<string, Market> {
  if (!cache) cache = buildMarkets();
  return cache;
}

export function marketBetween(a: string, b: string): Market | undefined {
  return markets().get(pairKey(a, b));
}

/** Modelled annual air passengers at an airport today (both directions). */
export function modelledAnnualPax(code: string): number {
  let weekly = 0;
  for (const m of markets().values()) if (m.a === code || m.b === code) weekly += 2 * m.airDemand;
  return weekly * 52;
}
