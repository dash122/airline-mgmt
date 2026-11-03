// Competitor airlines. They are fictional and generated from the airport and market data, so they work
// for any set of airports. They fly fixed schedules and do not react to the player: each market's
// existing service (Market.rivalFreq) is split between the airlines that would plausibly fly it.
import { AIRCRAFT, classRank, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../data/airports';
import { timeOfDayQuality } from './choice';
import { marketBetween, marketsFrom, pairKey, type Market } from './markets';

export type AirlineKind = 'full' | 'low' | 'regional';

export interface Airline {
  id: string;
  name: string;
  kind: AirlineKind;
  country: string;
  color: string;
  /** Airports it runs flights from. The first is its main hub. */
  bases: string[];
  /** Its fares as a multiple of the market reference fare. */
  fareMult: number;
  /** How much travellers value its product, in NT$ per trip (service, seats, lounges, reliability). */
  quality: number;
}

/** One airline's service in one direction of a market. */
export interface RivalService {
  airline: Airline;
  from: string;
  to: string;
  /** Flights a week in this direction. */
  freq: number;
  /** Local departure times (minutes after midnight); with fewer than 7 flights a week, one time used on some days. */
  times: number[];
  /** Flights a week weighted by how attractive their departure times are. */
  effFreq: number;
  fare: number;
  type: AircraftModel;
}

export const KIND_NAMES: Record<AirlineKind, string> = { full: '全服務', low: '廉價', regional: '區域' };

const KIND_SETTINGS: Record<AirlineKind, { fareMult: number; quality: number; fleet: AircraftModel[]; maxKm: number }> = {
  full: { fareMult: 1.1, quality: 400, fleet: ['A20N', 'A21N', 'B789', 'A359', 'B77W'], maxKm: 15000 },
  low: { fareMult: 0.78, quality: -500, fleet: ['A20N', 'A21N'], maxKm: 4500 },
  regional: { fareMult: 1, quality: 0, fleet: ['ATR72', 'Q400', 'E190'], maxKm: 1200 },
};

// Fictional names. Kept clear of real airline names.
const FULL_NAMES = ['雲帆', '海燕', '晨曦', '青嵐', '長風', '銀翼', '紅鶴', '白鷺', '曙光', '朱鷺', '雪松', '南星', '碧海', '蒼穹', '晴空', '旭日', '玉蘭', '松濤', '琥珀', '月桂', '翠羽', '星河', '錦帆', '秋楓'];
const LOW_NAMES = ['樂翔', '輕羽', '跳島', '好旅', '嗨飛', '微風', '啾啾', '小步', '輕舟', '彩虹', '泡泡', '飛跳'];
const REGIONAL_NAMES = ['群島', '山海', '澄海', '海峽', '岬角', '環島', '列嶼', '溪谷'];
const COLORS = ['#c0392b', '#8e44ad', '#16a085', '#d35400', '#2c7be5', '#b8860b', '#6d4c41', '#00897b', '#c2185b', '#5e35b1', '#558b2f', '#0277bd', '#ef6c00', '#7b1fa2', '#2e7d32', '#ad1457'];

/** Small deterministic string hash. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pickName(pool: string[], key: string, used: Set<string>): string {
  const start = hash(key) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const n = pool[(start + i) % pool.length];
    if (!used.has(n)) { used.add(n); return n; }
  }
  // Every name is taken: number them.
  for (let n = used.size; ; n++) {
    const name = `${pool[start]}${n}`;
    if (!used.has(name)) { used.add(name); return name; }
  }
}

const SIZE_WEIGHT = { hub: 5, major: 4, large: 3, medium: 2, small: 1 } as const;
/** How busy an airport is, from its size tier and catchment. Cheap, so it works for any number of airports. */
const busyness = (a: Airport) => SIZE_WEIGHT[a.size] * 1e8 + a.catchment * a.tourism;

/** People in a country's airport catchments before it has a low-cost airline, and airports before it has a regional one. */
const LOW_COST_MIN_CATCHMENT = 10_000_000;
const REGIONAL_MIN_AIRPORTS = 4;

function buildAirlines(): Airline[] {
  const byCountry = new Map<string, Airport[]>();
  for (const a of AIRPORTS) byCountry.set(a.country, [...(byCountry.get(a.country) ?? []), a]);
  const countries = [...byCountry.keys()].sort();
  const used = new Set<string>();
  const out: Airline[] = [];
  const make = (country: string, kind: AirlineKind, bases: string[], name: string) => {
    const s = KIND_SETTINGS[kind];
    out.push({ id: `${country}-${kind}`, name, kind, country, color: COLORS[hash(`${country}${kind}`) % COLORS.length], bases, fareMult: s.fareMult, quality: s.quality });
  };
  for (const c of countries) {
    const list = [...byCountry.get(c)!].sort((x, y) => busyness(y) - busyness(x));
    // One airport per metro, busiest first.
    const metros: Airport[] = [];
    for (const a of list) if (!metros.some((m) => m.metro === a.metro)) metros.push(a);
    if (!metros.length) continue;
    const people = list.reduce((s, a) => s + a.catchment, 0);
    const top = metros[0], second = metros[1];
    // The main hub, other big airports in the same city, and a second city if it is nearly as big.
    const fullBases = [top.code, ...list.filter((a) => a.metro === top.metro && a.code !== top.code && a.size === top.size).map((a) => a.code)];
    if (second && second.size === top.size) fullBases.push(second.code);
    make(c, 'full', fullBases, `${pickName(FULL_NAMES, `${c}full`, used)}航空`);
    if (people > LOW_COST_MIN_CATCHMENT) {
      make(c, 'low', metros.slice(0, 3).map((a) => a.code), `${pickName(LOW_NAMES, `${c}low`, used)}航空`);
    }
    const small = list.filter((a) => a.size === 'medium' || a.size === 'small');
    if (small.length >= REGIONAL_MIN_AIRPORTS) {
      make(c, 'regional', list.map((a) => a.code), `${pickName(REGIONAL_NAMES, `${c}regional`, used)}航空`);
    }
  }
  return out;
}

/** How strongly an airline would want to fly this market (0 = never). */
function appeal(al: Airline, a: Airport, b: Airport, distKm: number): number {
  const s = KIND_SETTINGS[al.kind];
  if (distKm > s.maxKm) return 0;
  const atBase = al.bases.includes(a.code) || al.bases.includes(b.code);
  const home = al.country === a.country || al.country === b.country;
  if (!home) return 0;
  const hub = al.bases[0] === a.code || al.bases[0] === b.code;
  switch (al.kind) {
    case 'full':
      return hub ? 1 : atBase ? 0.6 : 0;
    case 'low':
      return atBase ? 0.7 : distKm < 2500 ? 0.2 : 0;
    case 'regional': {
      if (a.country !== b.country || a.country !== al.country) return 0;
      const thin = [a, b].some((x) => x.size === 'medium' || x.size === 'small');
      return thin ? 1.2 : 0.15;
    }
  }
}

function canFly(type: AircraftModel, a: Airport, b: Airport, distKm: number): boolean {
  const s = AIRCRAFT[type];
  return distKm <= s.rangeKm && classRank(s.cls) <= Math.min(classRank(a.maxClass), classRank(b.maxClass));
}

/** Smallest aircraft in the airline's fleet that carries the expected load, or the largest that can fly it. */
function pickType(al: Airline, a: Airport, b: Airport, distKm: number, seatsNeeded: number): AircraftModel | null {
  const fleet = KIND_SETTINGS[al.kind].fleet.filter((t) => canFly(t, a, b, distKm)).sort((x, y) => AIRCRAFT[x].seats - AIRCRAFT[y].seats);
  if (!fleet.length) return null;
  return fleet.find((t) => AIRCRAFT[t].seats >= seatsNeeded) ?? fleet[fleet.length - 1];
}


/** Departure times spread over the day, with a little jitter so airlines don't all leave together. */
function departureTimes(key: string, freq: number): number[] {
  const perDay = Math.max(1, Math.round(freq / 7));
  const first = 7 * 60, last = 21 * 60 + 30;
  const step = (last - first) / perDay;
  const out: number[] = [];
  for (let i = 0; i < perDay; i++) {
    const jitter = (hash(`${key}#${i}`) % 51) - 25;
    out.push(Math.round((first + step * (i + 0.5) + jitter) / 5) * 5);
  }
  return out;
}

const OTHER: Airline = { id: 'other', name: '其他航空', kind: 'full', country: '', color: '#8a9aa6', bases: [], fareMult: 1, quality: 0 };
const AVERAGE_LOAD = 0.8;

function buildServices(airlines: Airline[], m: Market): RivalService[] {
  {
    if (m.rivalFreq <= 0) return [];
    const A = AIRPORT_BY_CODE[m.a], B = AIRPORT_BY_CODE[m.b];
    let cands = airlines.map((al) => ({ al, w: appeal(al, A, B, m.distKm) })).filter((x) => x.w > 0);
    // Nobody based here: the home flag carriers fly it point to point.
    if (!cands.length) cands = airlines.filter((al) => al.kind === 'full' && (al.country === A.country || al.country === B.country)).map((al) => ({ al, w: 0.3 }));
    const W = cands.reduce((s, x) => s + x.w, 0);
    let alloc = cands.map((x) => ({ al: x.al, freq: (m.rivalFreq * x.w) / (W || 1) }));
    // Drop token service: an airline needs at least 3 flights a week to be in a market.
    if (alloc.length > 1) {
      const kept = alloc.filter((x) => x.freq >= 3);
      const keptSum = kept.reduce((s, x) => s + x.freq, 0);
      alloc = kept.length ? kept.map((x) => ({ al: x.al, freq: (x.freq * m.rivalFreq) / keptSum })) : [alloc.sort((x, y) => y.freq - x.freq)[0]];
      if (!kept.length) alloc[0].freq = m.rivalFreq;
    }
    if (!alloc.length) alloc = [{ al: OTHER, freq: m.rivalFreq }];
    const list: RivalService[] = [];
    for (const { al, freq } of alloc) {
      const n = Math.max(1, Math.round(freq));
      const seatsNeeded = (m.airDemand * (freq / m.rivalFreq)) / n / AVERAGE_LOAD;
      const type = pickType(al, A, B, m.distKm, seatsNeeded) ?? 'A20N';
      for (const [from, to] of [[m.a, m.b], [m.b, m.a]]) {
        const times = departureTimes(`${al.id}${from}${to}`, n);
        const avgQ = times.reduce((s, t) => s + timeOfDayQuality(t), 0) / times.length;
        list.push({ airline: al, from, to, freq: n, times, effFreq: n * avgQ, fare: Math.round(m.refFare * al.fareMult), type });
      }
    }
    return list;
  }
}

let airlineCache: Airline[] | null = null;
export const airlines = () => (airlineCache ??= buildAirlines());

const serviceCache = new Map<string, RivalService[]>();

/** Competitor services between two airports, both directions. */
export function rivalsBetween(a: string, b: string): RivalService[] {
  const key = pairKey(a, b);
  let list = serviceCache.get(key);
  if (!list) {
    const m = marketBetween(a, b);
    list = m ? buildServices(airlines(), m) : [];
    serviceCache.set(key, list);
  }
  return list;
}

/** Competitor services from one airport to another, one direction. */
export const rivalsFrom = (from: string, to: string): RivalService[] => rivalsBetween(from, to).filter((s) => s.from === from);

const marketsAt = (code: string): Market[] => marketsFrom(code);

/** Every competitor departure from an airport, grouped by destination, busiest first. */
export function rivalsAt(code: string): { to: string; services: RivalService[] }[] {
  const out: { to: string; services: RivalService[] }[] = [];
  for (const m of marketsAt(code)) {
    if (m.rivalFreq <= 0) continue;
    const to = m.a === code ? m.b : m.a;
    const services = rivalsFrom(code, to);
    if (services.length) out.push({ to, services });
  }
  return out.sort((x, y) => sumFreq(y.services) - sumFreq(x.services));
}

/** Airlines flying from an airport, with weekly departures and destinations. */
export function airlinesAt(code: string): { airline: Airline; flights: number; destinations: number }[] {
  const by = new Map<string, { airline: Airline; flights: number; destinations: number }>();
  for (const { services } of rivalsAt(code)) {
    for (const s of services) {
      const e = by.get(s.airline.id) ?? { airline: s.airline, flights: 0, destinations: 0 };
      e.flights += s.freq;
      e.destinations += 1;
      by.set(s.airline.id, e);
    }
  }
  return [...by.values()].sort((x, y) => y.flights - x.flights);
}

const sumFreq = (xs: RivalService[]) => xs.reduce((s, x) => s + x.freq, 0);
