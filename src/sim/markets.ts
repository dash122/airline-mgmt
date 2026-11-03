// Market model: weekly travel demand between every pair of airports, scaled from catchment population,
// travel propensity, tourism pull and distance, then calibrated to a few national air-travel totals.
// Deterministic: same data in, same markets out.
import { AIRPORTS, AIRPORT_BY_CODE, type Airport } from '../data/airports';
import {
  AIR_TARGETS_M, COUNTRY_GROUPS, DEFAULT_PROPENSITY, DEFAULT_TARGET_M, DISTANCE_EXPONENT, DOMESTIC_COUNTRIES, GROUND, WORLD_DISTANCE_EXPONENT, ISLAND_PROPENSITY, MASS_EXPONENT, TRAVEL_PROPENSITY, WORLD_MASS_EXPONENT,
} from '../data/calibration';
import scaleData from '../data/scales.json';
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
/** Other airlines fly bigger aircraft on long routes. */
const seatsPerRivalFlight = (distKm: number) => (distKm > 3500 ? 260 : distKm > 1800 ? 180 : 150) * 0.8;
const MIN_RIVAL_FREQ = 3;

/** Average one-way fare across all cabins and booking classes, NT$. */
export const refFare = (distKm: number) => Math.max(1800, Math.round((1500 + 2.6 * distKm) / 10) * 10);
export const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
/** Calibration group of a pair: country pair for the hand-kept places, domestic for big countries, else world-region pair. */
export const groupOf = (a: Airport, b: Airport) => {
  if (COUNTRY_GROUPS.includes(a.country) && COUNTRY_GROUPS.includes(b.country)) return [a.country, b.country].sort().join('-');
  if (a.country === b.country && DOMESTIC_COUNTRIES.includes(a.country)) return `${a.country}-${a.country}`;
  return [a.world, b.world].sort().join('-');
};

export const isIsland = (a: Airport) => a.island;

/** Nearest mainland airport within ferry range of an island airport (a stand-in for the ferry port). */
const ferryCache = new Map<string, { port: Airport; km: number } | null>();
function ferryPort(isl: Airport) {
  if (!ferryCache.has(isl.code)) {
    let best: { port: Airport; km: number } | null = null;
    for (const p of AIRPORTS) {
      if (p.country !== isl.country || isIsland(p) || Math.abs(p.lat - isl.lat) > 2 || Math.abs(p.lon - isl.lon) > 2.5) continue;
      const km = distanceKm(isl.lat, isl.lon, p.lat, p.lon);
      if (km <= GROUND.ferry.maxKm && (!best || km < best.km)) best = { port: p, km };
    }
    ferryCache.set(isl.code, best);
  }
  return ferryCache.get(isl.code)!;
}

/** Beyond this, nobody takes the train or bus instead of flying. */
const MAX_GROUND_KM = 1600;

function landOption(a: Airport, b: Airport, distKm: number): GroundOption | undefined {
  if (a.landmass !== b.landmass || distKm > MAX_GROUND_KM) return undefined;
  // Landmasses ignore borders, so only allow crossing them where roads and rail really connect (not East Asia, where the borders are closed or seas intervene).
  if (a.country !== b.country && (a.world !== b.world || a.world === 'EA') && a.landmass !== 'prd') return undefined;
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

/** Air share and rival frequency for a market of given size, with only other airlines flying. `groundWeight` = exp(ground utility), 0 if none. */
function baseline(potential: number, fare: number, distKm: number, groundWeight: number) {
  const uNone = Math.exp(noTravelUtility(fare, distKm));
  let freq = 7;
  let air = 0;
  for (let i = 0; i < 8; i++) {
    const uAir = Math.exp(airUtility(fare, distKm, freq));
    air = (potential * uAir) / (uAir + groundWeight + uNone);
    const next = air / seatsPerRivalFlight(distKm);
    if (next < MIN_RIVAL_FREQ) return { air: 0, freq: 0 };
    freq = next;
  }
  return { air, freq: Math.round(freq) };
}

/** Intercontinental traffic piles up at big hubs and thins out at small airports. */
const HUB_BOOST = { hub: 1.5, major: 1.2, large: 1, medium: 0.85, small: 0.7 } as const;

/** Gravity "mass" of an airport: its catchment, travel propensity, tourism pull and island effect. */
const massOf = (a: Airport) =>
  Math.pow(a.catchment * (TRAVEL_PROPENSITY[a.country] ?? DEFAULT_PROPENSITY) * a.tourism * (isIsland(a) ? ISLAND_PROPENSITY : 1), COUNTRY_GROUPS.includes(a.country) ? MASS_EXPONENT : WORLD_MASS_EXPONENT) * HUB_BOOST[a.size];
/** Gravity between two airports. The four hand-kept places use the tuned exponent; elsewhere trips fall off more slowly with
 *  distance and beyond LONG_HAUL_KM extra distance counts for a third, so ocean-crossing routes between big cities still exist. */
const LONG_HAUL_KM = 3500;
const gravity = (ma: number, mb: number, distKm: number, curated: boolean) => {
  const d = distKm <= LONG_HAUL_KM ? distKm : LONG_HAUL_KM + (distKm - LONG_HAUL_KM) * 0.33;
  return (ma * mb) / Math.pow(Math.max(d, 150) / 100, curated ? DISTANCE_EXPONENT : WORLD_DISTANCE_EXPONENT);
};
const bothCurated = (a: Airport, b: Airport) => COUNTRY_GROUPS.includes(a.country) && COUNTRY_GROUPS.includes(b.country);
const groundWeightOf = (g?: GroundOption) => (g ? Math.exp(groundUtility(g)) : 0);

/**
 * Solves one scale per calibration group so that modelled air travel matches AIR_TARGETS_M.
 * Slow (every pair of airports); run offline with `npm run calibrate`, which writes src/data/scales.json.
 */
export function calibrate(iterations = 40): Record<string, number> {
  const n = AIRPORTS.length;
  const mass = AIRPORTS.map(massOf);
  const groups: string[] = [];
  const gi = new Map<string, number>();
  const G: number[] = [], D: number[] = [], U: number[] = [], K: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = AIRPORTS[i], b = AIRPORTS[j];
      if (a.metro === b.metro) continue;
      const distKm = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (distKm < MIN_MARKET_KM) continue;
      const g = groupOf(a, b);
      if (!gi.has(g)) { gi.set(g, groups.length); groups.push(g); }
      G.push(gravity(mass[i], mass[j], distKm, bothCurated(a, b)));
      D.push(distKm);
      U.push(groundWeightOf(groundOption(a, b, distKm)));
      K.push(gi.get(g)!);
    }
  }
  const totalGravity = new Array(groups.length).fill(0);
  for (let k = 0; k < G.length; k++) totalGravity[K[k]] += G[k];
  const target = groups.map((g) => ((AIR_TARGETS_M[g] ?? DEFAULT_TARGET_M) * 1e6) / 52 / 2);
  const scale = groups.map((_, g) => (target[g] * 3) / totalGravity[g]);
  for (let iter = 0; iter < iterations; iter++) {
    const air = new Array(groups.length).fill(0);
    for (let k = 0; k < G.length; k++) air[K[k]] += baseline(G[k] * scale[K[k]], refFare(D[k]), D[k], U[k]).air;
    // A group whose pairs are all below the minimum service has no air travel yet: grow its scale gradually.
    for (let g = 0; g < groups.length; g++) scale[g] *= Math.max(0.25, Math.min(3, Math.pow(target[g] / Math.max(air[g], 1), 0.7)));
  }
  return Object.fromEntries(groups.map((g, i) => [g, scale[i]]));
}

const scales = scaleData as Record<string, number>;
const massCache = new Map<string, number>();
const mass = (a: Airport) => {
  let m = massCache.get(a.code);
  if (m === undefined) massCache.set(a.code, (m = massOf(a)));
  return m;
};

function buildMarket(a: Airport, b: Airport): Market | undefined {
  if (a.metro === b.metro) return undefined;
  const distKm = distanceKm(a.lat, a.lon, b.lat, b.lon);
  if (distKm < MIN_MARKET_KM) return undefined;
  const group = groupOf(a, b);
  const ground = groundOption(a, b, distKm);
  const potential = gravity(mass(a), mass(b), distKm, bothCurated(a, b)) * (scales[group] ?? 0);
  const fare = refFare(distKm);
  const r = baseline(potential, fare, distKm, groundWeightOf(ground));
  const [x, y] = a.code < b.code ? [a, b] : [b, a];
  return { a: x.code, b: y.code, distKm, group, potential, airDemand: r.air, refFare: fare, rivalFreq: r.freq, ground };
}

// Markets are worked out on demand: there are about a million airport pairs in the world.
const cache = new Map<string, Market | null>();

/** Every market. Slow with the whole world loaded: for tests and calibration checks only. */
export function markets(): Map<string, Market> {
  const out = new Map<string, Market>();
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const m = marketBetween(AIRPORTS[i].code, AIRPORTS[j].code);
      if (m) out.set(pairKey(m.a, m.b), m);
    }
  }
  return out;
}

export function marketBetween(a: string, b: string): Market | undefined {
  const key = pairKey(a, b);
  let m = cache.get(key);
  if (m === undefined) {
    const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
    m = A && B && A.code !== B.code ? buildMarket(A, B) ?? null : null;
    cache.set(key, m);
  }
  return m ?? undefined;
}

/** Markets from one airport to every other, biggest first (worked out once per airport). */
const fromCache = new Map<string, Market[]>();
export function marketsFrom(code: string): Market[] {
  let list = fromCache.get(code);
  if (!list) {
    list = [];
    for (const o of AIRPORTS) {
      const m = o.code === code ? undefined : marketBetween(code, o.code);
      if (m) list.push(m);
    }
    list.sort((x, y) => y.airDemand - x.airDemand);
    fromCache.set(code, list);
  }
  return list;
}

/** Modelled annual air passengers at an airport today (both directions). */
export function modelledAnnualPax(code: string): number {
  let weekly = 0;
  for (const m of marketsFrom(code)) weekly += 2 * m.airDemand;
  return weekly * 52;
}
