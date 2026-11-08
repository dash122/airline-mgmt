// Market model: weekly travel demand between every pair of airports, scaled from catchment population,
// travel propensity, tourism pull and distance, then calibrated to a few national air-travel totals.
// Deterministic: same data in, same markets out.
import { AIRPORTS, AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { hasCompetitorRoute } from '../data/competitor-network';
import { ANNUAL_TRAFFIC_M, COUNTRY_INTERNATIONAL_SHARE, INTERNATIONAL_M, transferShare } from '../data/airport-traffic';
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
/** Annual passengers per resident of the catchment above which an airport is mostly a holiday destination. */
const LEISURE_TRIPS_PER_RESIDENT = 20;
/**
 * A holiday airport: far more passengers than people living around it (Mallorca 35 a resident, Cancún 35, Phuket 39,
 * against about 10 for London Heathrow or Madrid). Its flights are holiday flights from its visitors' home cities.
 */
export function isLeisureAirport(a: Airport): boolean {
  const traffic = ANNUAL_TRAFFIC_M[a.code];
  // Hubs are left out: transfer hubs such as Denver and Charlotte also carry far more passengers than residents.
  return !!traffic && a.size !== 'hub' && a.catchment > 0 && (traffic * 1e6) / a.catchment > LEISURE_TRIPS_PER_RESIDENT;
}
/** Long-haul budget share kept by a holiday airport (Cancún's seasonal flights from Europe, a couple at Mallorca). */
const LEISURE_LONG_HAUL_SHARE = 0.25;
/** Annual passengers (millions) at which an airport has a full long-haul role; below it, long-haul slots fall away faster. */
const LONG_HAUL_GATEWAY_M = 60;

/**
 * Most long-haul destinations, on top of DESTINATIONS: 0.8 per million annual passengers at a 60-million gateway
 * (Heathrow about 67, Hong Kong 37, Taipei 27, Vienna 13), fewer at smaller and holiday airports, or 4 for a major
 * airport without a traffic figure. Only hubs and majors fly long-haul.
 */
export function longHaulDestinations(a: Airport): number {
  if (a.size !== 'hub' && a.size !== 'major') return 0;
  const traffic = ANNUAL_TRAFFIC_M[a.code];
  if (!traffic) return 4;
  const n = traffic * 0.8 * Math.min(1, traffic / LONG_HAUL_GATEWAY_M) * (isLeisureAirport(a) ? LEISURE_LONG_HAUL_SHARE : 1);
  return Math.max(isLeisureAirport(a) ? 0 : 3, Math.round(n));
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
  const floor = distKm > 4500 ? 260 : 50;
  return Math.min(maxPax, Math.max(floor, gauge));
}
/**
 * A hub's flights also carry travellers changing planes there (close to half of Hong Kong-London's seats), whom this
 * origin-destination model doesn't count as the city's own trips. Transfers gather on long-haul flights, which feed
 * a hub's short-haul network, so a long-haul flight's share of transfers is this many times the airports' shares.
 */
export const LONG_HAUL_TRANSFER_WEIGHT = 0.8;
const SHORT_HAUL_TRANSFER_WEIGHT = 0.5;
/** Most of one flight's seats that go to travellers changing planes at either end. */
const MAX_TRANSFER_SEAT_SHARE = 0.7;
/**
 * How much more often competitors fly a route than its own travellers need, for the transfers at both ends: Hong
 * Kong-London about 1.8 times, Dubai-London 2.6.
 */
export function transferUplift(a: string, b: string, distKm: number): number {
  const w = distKm > LONG_HAUL_KM ? LONG_HAUL_TRANSFER_WEIGHT : SHORT_HAUL_TRANSFER_WEIGHT;
  return 1 / (1 - Math.min(MAX_TRANSFER_SEAT_SHARE, (transferShare(a) + transferShare(b)) * w));
}

/** What shapes competitor service between two airports: the biggest aircraft both take, and transfers at the ends. */
const serviceBetween = (a: Airport, b: Airport, distKm: number) => ({
  maxPax: MAX_PAX_BY_CLASS[classRank(a.maxClass) < classRank(b.maxClass) ? a.maxClass : b.maxClass],
  uplift: transferUplift(a.code, b.code, distKm),
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

/** Fewest weekly air travellers for a regular competitor service. */
const MIN_RIVAL_AIR = MIN_RIVAL_FREQ * SEATS_PER_RIVAL_FLIGHT;
/**
 * Whether baseline() surely finds no service: air travel never exceeds the potential, so a potential below a regular
 * service's minimum always ends in no flights. Most of the world's ~700,000 airport pairs stop here, without the
 * utility maths or working out the service between the two airports.
 */
const tooSmallForService = (potential: number) => potential < MIN_RIVAL_AIR;

function baseline(potential: number, fare: number, distKm: number, ground: GroundOption | undefined, service: { maxPax: number; uplift: number }) {
  if (ground && ground.comfort > 0 && ground.hours <= RAIL_ONLY_HOURS) return { air: 0, freq: 0 };
  if (tooSmallForService(potential)) return { air: 0, freq: 0 };
  const uGround = ground ? Math.exp(groundUtility(ground)) : 0;
  const uNone = Math.exp(noTravelUtility(fare, distKm));
  let freq = 7;
  let air = 0;
  for (let i = 0; i < 8; i++) {
    const uAir = Math.exp(airUtility(fare, distKm, freq));
    air = (potential * uAir) / (uAir + uGround + uNone);
    // Too few travellers for a regular service (a few flights a week on a mid-sized jet).
    if (air < MIN_RIVAL_AIR) return { air: 0, freq: 0 };
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

/** Annual passengers (millions) from which an airport draws its full share of long-haul travel; below it, in proportion. */
const LONG_HAUL_HUB_M = 60;
const LONG_HAUL_SIZE_EXPONENT = 1;
/**
 * Long-haul travel between big cities beyond what distance alone predicts: migration, business and holiday ties
 * between global cities (Hong Kong and London, London and New York). Without it long-haul was 12% of Hong Kong's own
 * international travellers and Hong Kong-London a third of its real size.
 */
const LONG_HAUL_TIES = 1.6;

const isInternational = (m: Market) => AIRPORT_BY_CODE[m.a].country !== AIRPORT_BY_CODE[m.b].country;
/**
 * Airports with an international traffic figure fit their domestic and international markets separately (`code|d`,
 * `code|i`); the others fit all their markets together (`code`). Shenzhen and Guangzhou carry more passengers than
 * Hong Kong, but almost all of them domestic: fitted together, their international markets came out six times too big.
 */
// These keys depend only on reference airport data, not on a fit iteration.
const fitKeys = new Map<string, readonly [string, string]>();
const AIRPORT_INDEX = new Map(AIRPORTS.map((a, i) => [a.code, i]));
const fitKey = (code: string, intl: boolean) => {
  let keys = fitKeys.get(code);
  if (!keys) {
    keys = internationalM(code) !== undefined ? [`${code}|d`, `${code}|i`] : [code, code];
    fitKeys.set(code, keys);
  }
  return keys[intl ? 1 : 0];
};
/** International annual passengers at an airport, millions: its own figure, else its country's usual share. */
export function internationalM(code: string): number | undefined {
  const traffic = ANNUAL_TRAFFIC_M[code];
  if (code in INTERNATIONAL_M) return traffic === undefined ? INTERNATIONAL_M[code] : Math.min(traffic, INTERNATIONAL_M[code]);
  const share = COUNTRY_INTERNATIONAL_SHARE[AIRPORT_BY_CODE[code]?.country];
  return traffic !== undefined && share !== undefined ? traffic * share : undefined;
}
/** Each fit key's target: the airport's own travellers (annual passengers less transfers), millions. */
const fitTargets: [string, number][] = Object.entries(ANNUAL_TRAFFIC_M).filter(([code]) => AIRPORT_BY_CODE[code]).flatMap(([code, total]): [string, number][] => {
  const own = 1 - transferShare(code);
  const intl = internationalM(code);
  return intl === undefined ? [[code, total * own]] : [[`${code}|i`, intl * own], [`${code}|d`, Math.max(0, total - intl) * own]];
});

function* buildMarkets(): Generator<void, Map<string, Market>> {
  // Outside the calibrated home region an airport's size comes from its real traffic, which already counts how much
  // its people and visitors fly, so the island uplift only applies to population-based sizes. Counting it twice made
  // holiday islands such as Mallorca look like London to travellers from Asia.
  // Travellers changing planes are left out: Doha's 53 million passengers are mostly passing through, not Qatar's own.
  // An airport with no traffic figure is a small one (under about a million passengers a year), so it is sized like
  // one: by its people it drew as much as a 6-million-passenger airport, and tiny airports in Madagascar or Cambodia
  // topped Tokyo's transit markets.
  const sizes = AIRPORTS.map((a) => {
    const curated = ['JP', 'TW', 'HK', 'MO'].includes(a.country);
    const size = curated ? a.catchment * (isIsland(a) ? ISLAND_PROPENSITY : 1)
      : ((ANNUAL_TRAFFIC_M[a.code] ?? Math.min(NO_DATA_TRAFFIC_M, (3 * a.catchment) / 1e6)) * (1 - transferShare(a.code)) * 1e6) / 3;
    return size * (TRAVEL_PROPENSITY[a.country] ?? 1) * a.tourism;
  });
  const mass = sizes.map((x) => Math.pow(x, MASS_EXPONENT));
  // Long-haul travellers from a city with several airports go wherever the long-haul flights are: Londoners fly to
  // Asia from Heathrow, not from Stansted, whose traffic is short-haul low-cost flights. So on long-haul markets the
  // whole city's size is shared among its airports by the square of their long-haul reach (Heathrow about 74%,
  // Gatwick 20%, Stansted 6%). Before this, Guangzhou-Stansted drew half of Guangzhou-Heathrow's travellers.
  const metroSize = new Map<string, number>();
  const metroReach = new Map<string, number>();
  const reach = AIRPORTS.map((a) => longHaulDestinations(a) ** 2);
  AIRPORTS.forEach((a, i) => {
    metroSize.set(a.metro, (metroSize.get(a.metro) ?? 0) + sizes[i]);
    metroReach.set(a.metro, (metroReach.get(a.metro) ?? 0) + reach[i]);
  });
  // Long-haul flights also gather at the biggest airports: a 30-million airport (Mallorca, Vienna) has only a
  // small long-haul share next to Heathrow or Frankfurt, so long-haul draw grows faster than traffic below a hub.
  // A holiday airport's traffic is mostly short-haul visitors (Mallorca's from Germany and the UK), so it keeps the
  // same small share of long-haul draw as of long-haul slots.
  // Long-haul flights are international, so the draw follows international traffic where the airport has a figure:
  // Guangzhou's 76 million passengers are mostly domestic, and it has a quarter of Hong Kong's long-haul reach.
  const longShare = (a: Airport) => Math.min(1, (internationalM(a.code) ?? ANNUAL_TRAFFIC_M[a.code] ?? NO_DATA_TRAFFIC_M) / LONG_HAUL_HUB_M) ** LONG_HAUL_SIZE_EXPONENT
    * (isLeisureAirport(a) ? LEISURE_LONG_HAUL_SHARE : 1);
  const longMass = AIRPORTS.map((a, i) => {
    const total = metroReach.get(a.metro)!;
    const size = total > 0 ? (metroSize.get(a.metro)! * reach[i]) / total : sizes[i];
    return Math.pow(size * longShare(a), MASS_EXPONENT);
  });
  // Every pair of airports, kept in flat arrays (about 700,000 of them): one object per pair cost seconds of
  // allocation and garbage collection on a phone. Group names and fit keys are numbered once per airport or country.
  const N = AIRPORTS.length;
  const maxPairs = (N * (N - 1)) / 2;
  const pairI = new Uint16Array(maxPairs), pairJ = new Uint16Array(maxPairs);
  const pairDist = new Float64Array(maxPairs), pairGravity = new Float64Array(maxPairs);
  const pairGroup = new Uint16Array(maxPairs);
  const pairGround: (GroundOption | undefined)[] = [];
  const groupNames: string[] = [];
  const groupIds = new Map<string, number>();
  const groupIdOf = (a: Airport, b: Airport) => {
    const k = a.country < b.country ? `${a.country}|${b.country}` : `${b.country}|${a.country}`;
    let id = groupIds.get(k);
    if (id === undefined) { groupIds.set(k, (id = groupNames.length)); groupNames.push(groupOf(a, b)); }
    return id;
  };
  // groundOption() finds nothing unless both ends share a landmass, one end is an island (a ferry), or one is in the
  // Pearl River Delta (bridges and rail across the border).
  const land = AIRPORTS.map(landOf), island = AIRPORTS.map(isIsland), prd = AIRPORTS.map((a) => a.landmass === 'prd');
  let P = 0;
  for (let i = 0; i < N; i++) {
    const a = AIRPORTS[i];
    for (let j = i + 1; j < N; j++) {
      const b = AIRPORTS[j];
      if (a.metro === b.metro) continue;
      const distKm = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (distKm < MIN_MARKET_KM) continue;
      const long = distKm > LONG_HAUL_KM;
      const mi = long ? longMass[i] : mass[i], mj = long ? longMass[j] : mass[j];
      pairI[P] = i; pairJ[P] = j; pairDist[P] = distKm;
      pairGravity[P] = (long ? LONG_HAUL_TIES : 1) * (mi * mj) / Math.pow(gravityKm(distKm) / 100, DISTANCE_EXPONENT);
      pairGroup[P] = groupIdOf(a, b);
      if (land[i] === land[j] || island[i] !== island[j] || prd[i] || prd[j]) {
        const g = groundOption(a, b, distKm);
        if (g) pairGround[P] = g;
      }
      P++;
    }
    yield;
  }
  const competitor = new Uint8Array(P);
  for (let n = 0; n < P; n++) {
    competitor[n] = hasCompetitorRoute(AIRPORTS[pairI[n]], AIRPORTS[pairJ[n]]) ? 1 : 0;
    if (n % CHUNK === 0) yield;
  }
  const calibratedGroup = groupNames.map((g) => g in AIR_TARGETS_M);
  // Calibrate one scale per group so modelled air travel matches the group's target.
  const scale: Record<string, number> = {};
  const totalGravity: Record<string, number> = {};
  for (let n = 0; n < P; n++) { const g = groupNames[pairGroup[n]]; totalGravity[g] = (totalGravity[g] ?? 0) + pairGravity[n]; }
  const targetWeekly = (g: string) => ((AIR_TARGETS_M[g] ?? 0.1) * 1e6) / 52 / 2;
  for (const g of Object.keys(totalGravity)) scale[g] = (targetWeekly(g) * 3) / totalGravity[g];
  // Calibration only uses regional pairs, not the entire global market collection.
  const calibrated: { group: string; gravity: number; distKm: number; ground?: GroundOption; fare: number; service: ReturnType<typeof serviceBetween> }[] = [];
  for (let n = 0; n < P; n++) {
    if (!calibratedGroup[pairGroup[n]] || !competitor[n]) continue;
    calibrated.push({ group: groupNames[pairGroup[n]], gravity: pairGravity[n], distKm: pairDist[n], ground: pairGround[n], fare: refFare(pairDist[n]),
      service: serviceBetween(AIRPORTS[pairI[n]], AIRPORTS[pairJ[n]], pairDist[n]) });
    if (n % CHUNK === 0) yield;
  }
  for (let iter = 0; iter < 30; iter++) {
    const air: Record<string, number> = {};
    for (const r of calibrated) {
      const b = baseline(r.gravity * scale[r.group], r.fare, r.distKm, r.ground, r.service);
      air[r.group] = (air[r.group] ?? 0) + b.air;
    }
    for (const g of Object.keys(scale).filter(g => g in AIR_TARGETS_M)) scale[g] *= Math.pow(targetWeekly(g) / Math.max(air[g] ?? 0, 1), 0.7);
    yield;
  }

  // Uncalibrated global markets inherit the regional reference gravity scale.
  for (const g of Object.keys(scale)) if (!(g in AIR_TARGETS_M)) scale[g] = scale['JP-TW'];
  // A first, rough fit of every airport to its traffic, before choosing which markets have nonstop service. Raw
  // gravity undersizes thinly peopled regions (Australia, South America, Southern Africa) and oversizes crowded ones,
  // so without it few of Johannesburg's markets were big enough for a regular flight, and all of its traffic was then
  // fitted onto those few (Johannesburg-Hong Kong as busy as Hong Kong-Bangkok). Every market counts here with a
  // rough air share, served or not.
  // Fit keys as numbers: fitKeyIds[i] holds airport i's domestic and international key.
  const fitKeyNames: string[] = [];
  const fitKeyIndex = new Map<string, number>();
  const fitKeyId = (k: string) => {
    let id = fitKeyIndex.get(k);
    if (id === undefined) { fitKeyIndex.set(k, (id = fitKeyNames.length)); fitKeyNames.push(k); }
    return id;
  };
  const fitKeyIds = AIRPORTS.map((a) => [fitKeyId(fitKey(a.code, false)), fitKeyId(fitKey(a.code, true))] as const);
  const keyIdOf = (code: string, intl: boolean) => fitKeyIds[AIRPORT_INDEX.get(code)!][intl ? 1 : 0];
  const targets = fitTargets.map(([k, millions]) => ({ id: fitKeyId(k), millions, big: (ANNUAL_TRAFFIC_M[k.split('|')[0]] ?? 0) >= PRE_FIT_BIG_M }));
  const K = fitKeyNames.length;
  const pairKa = new Uint16Array(P), pairKb = new Uint16Array(P);
  for (let n = 0; n < P; n++) {
    const i = pairI[n], j = pairJ[n];
    const intl = AIRPORTS[i].country !== AIRPORTS[j].country ? 1 : 0;
    pairKa[n] = fitKeyIds[i][intl]; pairKb[n] = fitKeyIds[j][intl];
    if (n % CHUNK === 0) yield;
  }
  // A key never fitted keeps a factor of 1.
  const pre = new Float64Array(K).fill(1);
  const fitPairs: number[] = [];
  for (let n = 0; n < P; n++) {
    const ground = pairGround[n];
    if (!calibratedGroup[pairGroup[n]] && competitor[n] && !(ground && ground.comfort > 0 && ground.hours <= RAIL_ONLY_HOURS)) fitPairs.push(n);
  }
  const fitAir = new Float64Array(fitPairs.length);
  fitPairs.forEach((n, x) => { fitAir[x] = pairGravity[n] * scale[groupNames[pairGroup[n]]]; });
  const sums = new Float64Array(K);
  for (let iter = 0; iter < 12; iter++) {
    sums.fill(0);
    for (let x = 0; x < fitPairs.length; x++) {
      const ka = pairKa[fitPairs[x]], kb = pairKb[fitPairs[x]];
      const air = fitAir[x] * Math.sqrt(pre[ka] * pre[kb]) * PRE_FIT_AIR_SHARE * 104;
      sums[ka] += air;
      sums[kb] += air;
      if (x % CHUNK === 0) yield;
    }
    for (const t of targets) {
      const now = sums[t.id];
      if (!now) continue;
      const f = pre[t.id] * Math.sqrt((t.millions * 1e6) / now);
      pre[t.id] = Math.min(t.big ? PRE_FIT_MAX : PRE_FIT_MAX_SMALL, Math.max(PRE_FIT_MIN, f));
    }
  }
  const out = new Map<string, Market>();
  const scaleOf = groupNames.map((g) => scale[g]);
  for (let n = 0; n < P; n++) {
    const i = pairI[n], j = pairJ[n], g = pairGroup[n], distKm = pairDist[n], ground = pairGround[n];
    const potential = pairGravity[n] * scaleOf[g] * (calibratedGroup[g] ? 1 : Math.sqrt(pre[pairKa[n]] * pre[pairKb[n]]));
    const fare = refFare(distKm);
    const b = competitor[n] && !tooSmallForService(potential)
      ? baseline(potential, fare, distKm, ground, serviceBetween(AIRPORTS[i], AIRPORTS[j], distKm))
      : { air: 0, freq: 0 };
    const a = AIRPORTS[i].code, c = AIRPORTS[j].code;
    out.set(a < c ? `${a}-${c}` : `${c}-${a}`, {
      a,
      b: c,
      distKm,
      group: groupNames[g],
      potential,
      airDemand: b.air,
      refFare: fare,
      rivalFreq: b.freq,
      ground,
    });
    if (n % CHUNK === 0) yield;
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
  const fit = new Float64Array(K).fill(1);
  const retainedFixed = retained.map((m) => m.group in AIR_TARGETS_M);
  const retainedKa = retained.map((m) => keyIdOf(m.a, isInternational(m)));
  const retainedKb = retained.map((m) => keyIdOf(m.b, isInternational(m)));
  const retainedService = retained.map((m) => serviceBetween(AIRPORT_BY_CODE[m.a], AIRPORT_BY_CODE[m.b], m.distKm));
  const totals = new Float64Array(K), fixed = new Float64Array(K), factors = new Float64Array(K);
  for (let iter = 0; iter < 40; iter++) {
    totals.fill(0); fixed.fill(0); factors.fill(1);
    for (let x = 0; x < retained.length; x++) {
      const bucket = retainedFixed[x] ? fixed : totals, m = retained[x];
      bucket[retainedKa[x]] += m.airDemand * 104;
      bucket[retainedKb[x]] += m.airDemand * 104;
    }
    for (const t of targets) {
      const want = Math.max(0.1, (t.millions * 1e6 - fixed[t.id]) / Math.max(1, totals[t.id]));
      // Never more than MAX_FIT_UP above raw gravity overall: an airport whose other markets went to bigger airports
      // would otherwise pile all its traffic onto the few routes it kept (Zagreb's 3 million all on Frankfurt).
      const cap = t.big ? MAX_FIT_UP : MAX_FIT_UP_SMALL;
      factors[t.id] = Math.min(want, cap / fit[t.id]);
      fit[t.id] = fit[t.id] * factors[t.id];
    }
    for (let x = 0; x < retained.length; x++) {
      if (retainedFixed[x]) continue;
      const m = retained[x];
      m.potential *= Math.pow(factors[retainedKa[x]] * factors[retainedKb[x]], 0.35);
      const b = baseline(m.potential, m.refFare, m.distKm, m.ground, retainedService[x]);
      m.airDemand = b.air;
      m.rivalFreq = b.freq;
    }
    yield;
  }
  for (let iter = 0; iter < 20; iter++) {
    const totals: Record<string, number> = {};
    for (const m of retained) totals[m.group] = (totals[m.group] ?? 0) + m.airDemand;
    for (const [x, m] of retained.entries()) {
      if (!retainedFixed[x]) continue;
      m.potential *= Math.pow(targetWeekly(m.group) / Math.max(totals[m.group], 1), 0.7);
      const b = baseline(m.potential, m.refFare, m.distKm, m.ground, retainedService[x]);
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
    const intl = isInternational(m);
    for (const c of [m.a, m.b]) { const k = fitKey(c, intl); shrink[k] = Math.min(1, Math.max(MIN_UNSERVED_FIT, fit[fitKeyIndex.get(k)!])); }
  }
  // An airport with no fitted market of its own (Osaka Itami flies no international routes) follows the other
  // airports of its city, so its unserved markets don't outgrow the served ones next door.
  const byMetro = new Map<string, number>();
  for (const [k, f] of Object.entries(shrink)) {
    const [c, side] = k.split('|');
    const mk = `${AIRPORT_BY_CODE[c].metro}|${side ?? ''}`;
    byMetro.set(mk, Math.min(byMetro.get(mk) ?? 1, f));
  }
  const shrinkOf = (c: string, intl: boolean) => {
    const k = fitKey(c, intl);
    if (k in shrink) return shrink[k];
    const side = k.split('|')[1];
    return byMetro.get(`${AIRPORT_BY_CODE[c].metro}|${side ?? ''}`) ?? byMetro.get(`${AIRPORT_BY_CODE[c].metro}|`) ?? 1;
  };
  const airportShrink = new Map(AIRPORTS.map(a => [a.code, [shrinkOf(a.code, false), shrinkOf(a.code, true)] as const]));
  let n = 0;
  for (const m of out.values()) {
    if (++n % CHUNK === 0) yield;
    if (m.rivalFreq > 0 || m.group in AIR_TARGETS_M) continue;
    const intl = isInternational(m);
    // The first fit only ever scales unserved markets down too, as above.
    const up = Math.sqrt(pre[keyIdOf(m.a, intl)] * pre[keyIdOf(m.b, intl)]);
    const side = intl ? 1 : 0;
    m.potential *= Math.pow(airportShrink.get(m.a)![side] * airportShrink.get(m.b)![side], 0.35) / Math.max(1, up);
  }
  return out;
}
/** Rough share of a market's potential travellers who fly, for the first fit. */
const PRE_FIT_AIR_SHARE = 0.5;
/** Limits on the first fit of an airport's markets to its traffic. */
const PRE_FIT_MIN = 0.02, PRE_FIT_MAX = 30;
/**
 * Below this many annual passengers (millions) an airport's markets are scaled up at most PRE_FIT_MAX_SMALL times: a
 * small airport's traffic sits on a few routes to its country's hubs, which says little about its other markets
 * (Sihanoukville to Seoul).
 */
const PRE_FIT_BIG_M = 10, PRE_FIT_MAX_SMALL = 5;
/** Most an airport's markets are scaled up, in all, to match its traffic. */
const MAX_FIT_UP = 4, MAX_FIT_UP_SMALL = 2;
/** Lowest airport fit factor carried over to its unserved markets. */
const MIN_UNSERVED_FIT = 0.01;

/** Pairs of airports handled between pauses while the demand model is built in the background. */
const CHUNK = 16384;

interface MarketTable { all: Map<string, Market>; byAirport: Map<string, Market[]>; annualPax: Map<string, number> }

/** The demand model and its per-airport indexes, built in steps that pause now and then (see prepareMarkets). */
function* buildTable(): Generator<void, MarketTable> {
  const all = yield* buildMarkets();
  const byAirport = new Map<string, Market[]>();
  const annualPax = new Map<string, number>();
  const index = (code: string, m: Market) => {
    let list = byAirport.get(code);
    if (!list) byAirport.set(code, list = []);
    list.push(m);
    annualPax.set(code, (annualPax.get(code) ?? 0) + 104 * m.airDemand);
  };
  let n = 0;
  for (const m of all.values()) {
    index(m.a, m); index(m.b, m);
    if (++n % CHUNK === 0) yield;
  }
  return { all, byAirport, annualPax };
}

let table: MarketTable | null = null;
let building: Generator<void, MarketTable> | null = null;

/**
 * Builds the demand model a step at a time for about `budgetMs`, then returns whether it is ready. The model covers
 * every pair of the world's airports (about 700,000) and takes seconds on a phone, so the app builds it in short
 * slices while idle rather than all at once on the first tap that needs it. Any earlier need finishes the rest at once.
 * The steps are the same either way, so the markets are identical.
 */
export function prepareMarkets(budgetMs: number): boolean {
  if (table) return true;
  building ??= buildTable();
  const end = performance.now() + budgetMs;
  for (;;) {
    const step = building.next();
    if (step.done) { table = step.value; building = null; return true; }
    if (performance.now() >= end) return false;
  }
}

/** Whether the demand model is built, so the views that need it open without a wait. */
export const marketsReady = () => table !== null;

function marketTable(): MarketTable {
  if (!table) prepareMarkets(Infinity);
  return table!;
}

export function markets(): Map<string, Market> {
  return marketTable().all;
}

export function marketBetween(a: string, b: string): Market | undefined {
  return markets().get(pairKey(a, b));
}

/** Modelled annual travellers starting or ending their trip at an airport today (both directions). */
export function modelledLocalPax(code: string): number {
  return marketTable().annualPax.get(code) ?? 0;
}

/** Modelled annual terminal passengers at an airport today: its own travellers plus those changing planes there. */
export function modelledAnnualPax(code: string): number {
  return modelledLocalPax(code) / (1 - transferShare(code));
}

/** Markets touching an airport, indexed once when the demand model is built. */
export function marketsAt(code: string): readonly Market[] {
  return marketTable().byAirport.get(code) ?? [];
}
