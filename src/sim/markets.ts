// Market model: weekly travel demand between every pair of airports, scaled from catchment population,
// travel propensity, tourism pull and distance, then calibrated to a few national air-travel totals.
// Deterministic: same data in, same markets out.
import { AIRPORTS, AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { hasCompetitorRoute } from '../data/competitor-network';
import { ANNUAL_TRAFFIC_M } from '../data/airport-traffic';
import { AIR_TARGETS_M, DISTANCE_EXPONENT, GROUND, ISLAND_PROPENSITY, MASS_EXPONENT, TRAVEL_PROPENSITY } from '../data/calibration';
import { distanceKm } from './geo';
import { classRank, type AircraftClass } from '../data/aircraft';
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
/** Routes longer than this need a widebody and two big airports, and count against the long-haul budget. */
export const LONG_HAUL_KM = 4500;
/** Most nonstop destinations competitors serve from an airport, short and medium haul. */
export const DESTINATIONS = { hub: 100, major: 60, large: 30, medium: 12, small: 4 } as const;
/**
 * Most long-haul destinations, on top of DESTINATIONS: 0.8 per million annual passengers (Heathrow about 67,
 * Hong Kong 42, Taipei 36), or 8 for a major airport without a traffic figure. Only hubs and majors fly long-haul.
 */
export function longHaulDestinations(a: Airport): number {
  if (a.size !== 'hub' && a.size !== 'major') return 0;
  const traffic = ANNUAL_TRAFFIC_M[a.code];
  return traffic ? Math.max(5, Math.round(traffic * 0.8)) : 8;
}
const SEATS_PER_RIVAL_FLIGHT = 150 * 0.8;
const MIN_RIVAL_FREQ = 3;

/** Most travellers one competitor flight carries at the smaller end's biggest aircraft class (seats at about 80% full). */
const MAX_PAX_BY_CLASS: Record<AircraftClass, number> = { turboprop: 60, regional: 80, narrowbody: 175, widebody: 300 };

/**
 * Travellers on an average competitor flight. Airlines grow aircraft size as well as frequency on busy routes, so the
 * gauge rises with demand: about 110 a flight at 1,000 travellers a week, 230 at 20,000 (Hong Kong-Taipei) and the
 * widebody limit near 70,000 (Singapore-Kuala Lumpur). Long-haul needs a widebody whatever the demand.
 */
export function rivalPaxPerFlight(weeklyAir: number, distKm: number, maxPax = MAX_PAX_BY_CLASS.widebody): number {
  const gauge = 110 * Math.pow(Math.max(weeklyAir, 1) / 1000, 0.25);
  const floor = distKm > 4500 ? 230 : 50;
  return Math.min(maxPax, Math.max(floor, gauge));
}
/**
 * Long-haul flights from a hub also carry travellers connecting there (most of Hong Kong-London's seats, for one),
 * which this origin-destination model doesn't count, so they fly this much more often per hub end.
 */
export const LONG_HAUL_HUB_UPLIFT = 0.4;

/** What shapes competitor service between two airports: the biggest aircraft both take, and hub connecting traffic. */
const serviceBetween = (a: Airport, b: Airport, distKm: number) => ({
  maxPax: MAX_PAX_BY_CLASS[classRank(a.maxClass) < classRank(b.maxClass) ? a.maxClass : b.maxClass],
  uplift: distKm > LONG_HAUL_KM ? 1 + LONG_HAUL_HUB_UPLIFT * [a, b].filter(x => x.size === 'hub').length : 1,
});

/** Average one-way fare across all cabins and booking classes, NT$. */
export const refFare = (distKm: number) => Math.max(1800, Math.round((1500 + 2.6 * distKm) / 10) * 10);
export const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const groupOf = (a: Airport, b: Airport) => [a.country, b.country].sort().join('-');

/** Land links the coastline data misses: Xiamen and Zhuhai are joined to the mainland by bridges and tunnels. */
const LAND_LINKS: Record<string, string> = { 'ring-1016': 'main-0', 'isl-ZUH': 'main-0' };
/** The landmass an airport can reach by rail or road. */
export const landOf = (a: Airport) => LAND_LINKS[a.landmass] ?? a.landmass;
/** High-speed rail at this end. China's network reaches nearly every city with a big airport. */
export const hasHsr = (a: Airport) => a.hsr || a.country === 'CN';

export const isIsland = (a: Airport) => !['jp-main', 'tw-main', 'prd'].includes(a.landmass) && !landOf(a).startsWith('main-');

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

/** Hong Kong and Macau are tied to the mainland China rail network (Express Rail Link, Zhuhai), across a border. */
const isPrdMainlandLink = (a: Airport, b: Airport) => {
  const [prd, other] = a.landmass === 'prd' ? [a, b] : [b, a];
  return prd.landmass === 'prd' && other.landmass !== 'prd' && other.country === 'CN' && other.landmass.startsWith('main-');
};

function landOption(a: Airport, b: Airport, distKm: number): GroundOption | undefined {
  if (isPrdMainlandLink(a, b)) {
    const km = distKm * GROUND.detour, mode = GROUND.hsr;
    return { name: mode.name, hours: km / mode.speed + GROUND.accessHours, fare: km * mode.farePerKm, comfort: mode.comfort };
  }
  if (landOf(a) !== landOf(b)) return undefined;
  if (a.landmass === 'prd') return { name: GROUND.bridge.name, hours: GROUND.bridge.hours, fare: GROUND.bridge.fare, comfort: GROUND.bridge.comfort };
  const km = distKm * GROUND.detour;
  const mode = hasHsr(a) && hasHsr(b) ? GROUND.hsr : GROUND.conventional;
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
/**
 * Airlines stop flying where fast rail or a bridge does the trip in this many hours or less (Tokyo-Nagoya,
 * Taipei-Kaohsiung, Hong Kong-Guangzhou). Tokyo-Osaka, at about three hours, keeps its flights.
 */
export const RAIL_ONLY_HOURS = 2.5;

function baseline(potential: number, fare: number, distKm: number, ground: GroundOption | undefined, service: { maxPax: number; uplift: number }) {
  if (ground && ground.comfort > 0 && ground.hours <= RAIL_ONLY_HOURS) return { air: 0, freq: 0 };
  const uGround = ground ? Math.exp(groundUtility(ground)) : 0;
  const uNone = Math.exp(noTravelUtility(fare, distKm));
  let freq = 7;
  let air = 0;
  for (let i = 0; i < 8; i++) {
    const uAir = Math.exp(airUtility(fare, distKm, freq));
    air = (potential * uAir) / (uAir + uGround + uNone);
    // Too few travellers for a regular service (a few flights a week on a mid-sized jet).
    if (air < MIN_RIVAL_FREQ * SEATS_PER_RIVAL_FLIGHT) return { air: 0, freq: 0 };
    freq = Math.max(MIN_RIVAL_FREQ, (service.uplift * air) / rivalPaxPerFlight(air, distKm, service.maxPax));
  }
  return { air, freq: Math.round(freq) };
}

/**
 * Distance as the gravity model feels it. Past LONG_HAUL_FLAT_KM demand falls off much more slowly: nothing but a
 * flight makes the trip, and family, business and holiday ties between big cities don't fade with every extra
 * thousand kilometres. Without this, Hong Kong-London drew a third of Hong Kong-Tokyo's travellers.
 */
export const LONG_HAUL_FLAT_KM = 3000;
const gravityKm = (distKm: number) => {
  const d = Math.max(distKm, 150);
  return d <= LONG_HAUL_FLAT_KM ? d : LONG_HAUL_FLAT_KM + (d - LONG_HAUL_FLAT_KM) * 0.25;
};

/** Annual passengers assumed for an airport outside the home region with no traffic figure (small airports carry 0.3M to 1.1M). */
const NO_DATA_TRAFFIC_M = 0.6;

function buildMarkets(): Map<string, Market> {
  // Outside the calibrated home region an airport's size comes from its real traffic, which already counts how much
  // its people and visitors fly, so the island uplift only applies to population-based sizes. Counting it twice made
  // holiday islands such as Mallorca look like London to travellers from Asia.
  // An airport with no traffic figure is a small one (under about a million passengers a year), so it is sized like
  // one: by its people it drew as much as a 6-million-passenger airport, and tiny airports in Madagascar or Cambodia
  // topped Tokyo's transit markets.
  const mass = AIRPORTS.map((a) => {
    const curated = ['JP', 'TW', 'HK', 'MO'].includes(a.country);
    const size = curated ? a.catchment * (isIsland(a) ? ISLAND_PROPENSITY : 1)
      : ((ANNUAL_TRAFFIC_M[a.code] ?? Math.min(NO_DATA_TRAFFIC_M, (3 * a.catchment) / 1e6)) * 1e6) / 3;
    return Math.pow(size * (TRAVEL_PROPENSITY[a.country] ?? 1) * a.tourism, MASS_EXPONENT);
  });
  const raw: { i: number; j: number; distKm: number; gravity: number; group: string; ground?: GroundOption }[] = [];
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const a = AIRPORTS[i], b = AIRPORTS[j];
      if (a.metro === b.metro) continue;
      const distKm = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (distKm < MIN_MARKET_KM) continue;
      const gravity = (mass[i] * mass[j]) / Math.pow(gravityKm(distKm) / 100, DISTANCE_EXPONENT);
      raw.push({ i, j, distKm, gravity, group: groupOf(a, b), ground: groundOption(a, b, distKm) });
    }
  }
  // Calibrate one scale per group so modelled air travel matches the group's target.
  const scale: Record<string, number> = {};
  const totalGravity: Record<string, number> = {};
  for (const r of raw) totalGravity[r.group] = (totalGravity[r.group] ?? 0) + r.gravity;
  const targetWeekly = (g: string) => ((AIR_TARGETS_M[g] ?? 0.1) * 1e6) / 52 / 2;
  for (const g of Object.keys(totalGravity)) scale[g] = (targetWeekly(g) * 3) / totalGravity[g];
  // Calibration only uses regional pairs, not the entire global market collection.
  const calibrated = raw.filter(r => r.group in AIR_TARGETS_M && hasCompetitorRoute(AIRPORTS[r.i], AIRPORTS[r.j]))
    .map(r => ({ ...r, fare: refFare(r.distKm) }));
  for (let iter = 0; iter < 30; iter++) {
    const air: Record<string, number> = {};
    for (const r of calibrated) {
      const b = baseline(r.gravity * scale[r.group], r.fare, r.distKm, r.ground, serviceBetween(AIRPORTS[r.i], AIRPORTS[r.j], r.distKm));
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
      ? baseline(potential, fare, r.distKm, r.ground, serviceBetween(AIRPORTS[r.i], AIRPORTS[r.j], r.distKm))
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
  // Long-haul routes (over LONG_HAUL_KM) have their own budget. They carry fewer travellers than a hub's short-haul
  // routes, so in one shared budget the short-haul ones took every slot.
  const degree = new Map<string, number>();
  const longDegree = new Map<string, number>();
  const longOk = (m: Market) => m.distKm <= 15000
    && [m.a, m.b].every(c => { const x = AIRPORT_BY_CODE[c]; return (x.size === 'hub' || x.size === 'major') && x.maxClass === 'widebody'; });
  // Long-haul flows concentrate between big hubs, so hub-to-hub routes take long-haul slots first. In plain demand
  // order a hub's slots went to whichever secondary cities came first, and Hong Kong-London found London full.
  const hubEnds = (m: Market) => m.distKm > LONG_HAUL_KM ? [m.a, m.b].filter(c => AIRPORT_BY_CODE[c].size === 'hub').length : 0;
  const candidates = [...out.values()].filter(m => m.rivalFreq > 0)
    .sort((a, b) => hubEnds(b) - hubEnds(a) || b.airDemand - a.airDemand || pairKey(a.a, a.b).localeCompare(pairKey(b.a, b.b)));
  for (const m of candidates) {
    const a = AIRPORT_BY_CODE[m.a], b = AIRPORT_BY_CODE[m.b];
    const long = m.distKm > LONG_HAUL_KM;
    const deg = long ? longDegree : degree;
    const lim = long ? longHaulDestinations : (x: Airport) => DESTINATIONS[x.size];
    if ((deg.get(m.a) ?? 0) >= lim(a) || (deg.get(m.b) ?? 0) >= lim(b) || (long && !longOk(m))) {
      m.rivalFreq = 0;
      m.airDemand = 0;
    } else {
      deg.set(m.a, (deg.get(m.a) ?? 0) + 1);
      deg.set(m.b, (deg.get(m.b) ?? 0) + 1);
    }
  }
  // Preserve calibrated regional totals on the retained network.
  const retained = candidates.filter(m => m.rivalFreq > 0);
  // Fit global airport traffic budgets on the retained network. Regional markets
  // remain fixed; terminal totals guide simulated OD demand, not exact route counts.
  // Scaling potential too ensures player demand and competitor service agree.
  // Each airport's combined fit factor over all iterations: every retained market's potential ends up multiplied by
  // (fit[a] * fit[b]) ** 0.35.
  const fit: Record<string, number> = {};
  for (let iter = 0; iter < 40; iter++) {
    const totals: Record<string, number> = {};
    const fixed: Record<string, number> = {};
    for (const m of retained) for (const code of [m.a, m.b]) {
      const bucket = m.group in AIR_TARGETS_M ? fixed : totals;
      bucket[code] = (bucket[code] ?? 0) + m.airDemand * 104;
    }
    const factors: Record<string, number> = {};
    for (const [code, millions] of Object.entries(ANNUAL_TRAFFIC_M)) {
      factors[code] = Math.max(0.1, (millions * 1e6 - (fixed[code] ?? 0)) / Math.max(1, totals[code] ?? 0));
      fit[code] = (fit[code] ?? 1) * factors[code];
    }
    for (const m of retained) {
      if (m.group in AIR_TARGETS_M) continue;
      m.potential *= Math.pow((factors[m.a] ?? 1) * (factors[m.b] ?? 1), 0.35);
      const b = baseline(m.potential, m.refFare, m.distKm, m.ground, serviceBetween(AIRPORT_BY_CODE[m.a], AIRPORT_BY_CODE[m.b], m.distKm));
      m.airDemand = b.air;
      m.rivalFreq = b.freq;
    }
  }
  for (let iter = 0; iter < 20; iter++) {
    const totals: Record<string, number> = {};
    for (const m of retained) totals[m.group] = (totals[m.group] ?? 0) + m.airDemand;
    for (const m of retained) {
      if (!(m.group in AIR_TARGETS_M)) continue;
      m.potential *= Math.pow(targetWeekly(m.group) / Math.max(totals[m.group], 1), 0.7);
      const b = baseline(m.potential, m.refFare, m.distKm, m.ground, serviceBetween(AIRPORT_BY_CODE[m.a], AIRPORT_BY_CODE[m.b], m.distKm));
      m.airDemand = b.air;
      m.rivalFreq = b.freq;
    }
  }
  // Markets nobody flies nonstop today (Taipei-Mallorca, say) still carry travellers who connect, and the player can
  // win them through a hub. Where an airport's real traffic says raw gravity overstates its markets, scale its unserved
  // markets down the same way, so they stay in proportion with the served ones (Taipei-London). Only ever down: small
  // airports fit far upwards because all their traffic sits on a few routes, which says nothing about the others.
  const shrink: Record<string, number> = {};
  for (const m of retained) {
    if (m.group in AIR_TARGETS_M) continue;
    for (const c of [m.a, m.b]) shrink[c] = Math.min(1, Math.max(MIN_UNSERVED_FIT, fit[c] ?? 1));
  }
  // An airport with no fitted market of its own (Osaka Itami flies no international routes) follows the other
  // airports of its city, so its unserved markets don't outgrow the served ones next door.
  const byMetro = new Map<string, number>();
  for (const [c, f] of Object.entries(shrink)) {
    const k = AIRPORT_BY_CODE[c].metro;
    byMetro.set(k, Math.min(byMetro.get(k) ?? 1, f));
  }
  for (const a of AIRPORTS) if (!(a.code in shrink) && byMetro.has(a.metro)) shrink[a.code] = byMetro.get(a.metro)!;
  for (const m of out.values()) {
    if (m.rivalFreq > 0 || m.group in AIR_TARGETS_M) continue;
    m.potential *= Math.pow((shrink[m.a] ?? 1) * (shrink[m.b] ?? 1), 0.35);
  }
  return out;
}
/** Lowest airport fit factor carried over to its unserved markets. */
const MIN_UNSERVED_FIT = 0.01;

let cache: Map<string, Market> | null = null;
const airportMarkets = new Map<string, Market[]>();
const annualPax = new Map<string, number>();
export function markets(): Map<string, Market> {
  if (!cache) {
    cache = buildMarkets();
    for (const m of cache.values()) {
      for (const code of [m.a, m.b]) {
        let list = airportMarkets.get(code);
        if (!list) airportMarkets.set(code, list = []);
        list.push(m);
        annualPax.set(code, (annualPax.get(code) ?? 0) + 104 * m.airDemand);
      }
    }
  }
  return cache;
}

export function marketBetween(a: string, b: string): Market | undefined {
  return markets().get(pairKey(a, b));
}

/** Modelled annual air passengers at an airport today (both directions). */
export function modelledAnnualPax(code: string): number {
  markets();
  return annualPax.get(code) ?? 0;
}

/** Markets touching an airport, indexed once when the demand model is built. */
export function marketsAt(code: string): readonly Market[] {
  markets();
  return airportMarkets.get(code) ?? [];
}
