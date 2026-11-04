// Each competitor airline's whole network: its routes, hubs, fleet and timetable, built from the per-market
// services in competitors.ts. Used by the airline directory and the airline profile.
import { AIRCRAFT, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlines, nameAreaOf, rivalsBetween, type Airline, type NameArea, type RivalService } from './competitors';
import { markets, pairKey } from './markets';
import { blockMinutes, routePairs, type Plan } from './simulate';

/** One route an airline flies, both directions. `a` is the hub end when it has one. */
export interface AirlineRoute {
  key: string;
  a: string;
  b: string;
  distKm: number;
  /** Flights a week in each direction. */
  freq: number;
  type: AircraftModel;
  fare: number;
  /** Departure times, local, from a and from b. */
  out: RivalService;
  back: RivalService;
}

export interface AirlineHub {
  code: string;
  /** Weekly departures from this airport. */
  departures: number;
  destinations: number;
  /** This airport's share of the airline's departures. */
  share: number;
  main: boolean;
}

export interface FleetLine {
  type: AircraftModel;
  routes: number;
  /** Flights a week, both directions. */
  flights: number;
  /** Seats a week, both directions. */
  seats: number;
  /** Aircraft needed to fly these flights, at about 15 block-and-turn hours a day. */
  aircraft: number;
}

export interface AirlineNetwork {
  airline: Airline;
  routes: AirlineRoute[];
  /** Hubs, or with no clear hub (a point-to-point network) its busiest airports. */
  hubs: AirlineHub[];
  /** No airport has a big share of its flights: it flies point to point. */
  pointToPoint: boolean;
  /** Airports it flies to, including hubs. */
  airports: string[];
  countries: string[];
  /** Departures a week, all airports (= flights a week, counting each direction once). */
  flights: number;
  seats: number;
  fleet: FleetLine[];
  longestKm: number;
}

const HOURS_A_DAY = 15;
/** An airport is a hub when it has this share of the airline's departures, or a lower one if it is a declared base. */
const HUB_SHARE = 0.1;
const BASE_HUB_SHARE = 0.05;
const MAX_HUBS = 4;

let index: Map<string, { a: string; b: string; out: RivalService; back: RivalService }[]> | null = null;

/** Every competitor route, grouped by airline. Built once (about half a second for the whole world). */
function routeIndex() {
  if (index) return index;
  index = new Map();
  for (const m of markets().values()) {
    if (m.rivalFreq <= 0) continue;
    const list = rivalsBetween(m.a, m.b);
    const byAirline = new Map<string, RivalService[]>();
    for (const s of list) byAirline.set(s.airline.id, [...(byAirline.get(s.airline.id) ?? []), s]);
    for (const [id, ss] of byAirline) {
      const out = ss.find((s) => s.from === m.a), back = ss.find((s) => s.from === m.b);
      if (!out || !back) continue;
      const arr = index.get(id) ?? [];
      arr.push({ a: m.a, b: m.b, out, back });
      index.set(id, arr);
    }
  }
  return index;
}

const networkCache = new Map<string, AirlineNetwork>();

/** One airline's network, with hubs picked from where its flights actually leave. */
export function airlineNetwork(id: string): AirlineNetwork | null {
  const cached = networkCache.get(id);
  if (cached) return cached;
  const airline = airlines().find((x) => x.id === id);
  const raw = routeIndex().get(id);
  if (!airline || !raw?.length) return null;
  const deps = new Map<string, { departures: number; destinations: number }>();
  for (const r of raw) {
    for (const s of [r.out, r.back]) {
      const e = deps.get(s.from) ?? { departures: 0, destinations: 0 };
      e.departures += s.freq;
      e.destinations += 1;
      deps.set(s.from, e);
    }
  }
  const flights = [...deps.values()].reduce((s, x) => s + x.departures, 0);
  const ranked = [...deps.entries()].sort((x, y) => y[1].departures - x[1].departures);
  const share = (c: string) => (deps.get(c)?.departures ?? 0) / flights;
  const bases = new Set(airline.bases);
  let hubCodes = ranked.map(([c]) => c).filter((c) => share(c) >= (bases.has(c) ? BASE_HUB_SHARE : HUB_SHARE));
  const pointToPoint = !hubCodes.length;
  if (pointToPoint) hubCodes = ranked.slice(0, 3).map(([c]) => c);
  // The declared main base leads when it is a hub; otherwise the busiest airport does.
  const main = hubCodes.includes(airline.bases[0]) ? airline.bases[0] : hubCodes[0];
  hubCodes = [main, ...hubCodes.filter((c) => c !== main)].slice(0, MAX_HUBS);
  const hubs: AirlineHub[] = hubCodes.map((code) => ({ code, ...deps.get(code)!, share: share(code), main: code === main }));
  const hubRank = (c: string) => { const i = hubCodes.indexOf(c); return i < 0 ? 99 : i; };
  const routes: AirlineRoute[] = raw.map((r) => {
    // Put the hub end first, so lists read "HKG ⇄ TPE" from the hub's side.
    const flip = hubRank(r.b) < hubRank(r.a);
    const [a, b, out, back] = flip ? [r.b, r.a, r.back, r.out] : [r.a, r.b, r.out, r.back];
    return { key: pairKey(a, b), a, b, distKm: markets().get(pairKey(a, b))?.distKm ?? 0, freq: out.freq, type: out.type, fare: out.fare, out, back };
  }).sort((x, y) => y.freq - x.freq || x.key.localeCompare(y.key));
  const fleetBy = new Map<AircraftModel, FleetLine & { minutes: number }>();
  for (const r of routes) {
    const f = fleetBy.get(r.type) ?? { type: r.type, routes: 0, flights: 0, seats: 0, aircraft: 0, minutes: 0 };
    f.routes += 1;
    f.flights += 2 * r.freq;
    f.seats += 2 * r.freq * AIRCRAFT[r.type].seats;
    f.minutes += r.freq * (blockMinutes(r.a, r.b, r.type) + blockMinutes(r.b, r.a, r.type) + 2 * AIRCRAFT[r.type].turnMin);
    fleetBy.set(r.type, f);
  }
  const fleet = [...fleetBy.values()].map(({ minutes, ...f }) => ({ ...f, aircraft: Math.max(1, Math.ceil(minutes / (7 * HOURS_A_DAY * 60))) }))
    .sort((x, y) => y.aircraft - x.aircraft);
  const airports = [...deps.keys()];
  const net: AirlineNetwork = {
    airline, routes, hubs, pointToPoint, airports,
    countries: [...new Set(airports.map((c) => AIRPORT_BY_CODE[c].country))],
    flights, seats: fleet.reduce((s, f) => s + f.seats, 0), fleet,
    longestKm: Math.max(...routes.map((r) => r.distKm)),
  };
  networkCache.set(id, net);
  return net;
}

/** Airlines that fly at least one route, busiest first. */
export function airlineNetworks(): AirlineNetwork[] {
  return airlines().map((a) => airlineNetwork(a.id)).filter((n): n is AirlineNetwork => !!n).sort((x, y) => y.flights - x.flights);
}

/** Where an airline overlaps with the player: routes both fly, and the player's airports it also serves. */
export function overlapWithPlan(net: AirlineNetwork, plan: Plan): { routes: AirlineRoute[]; airports: string[] } {
  const ours = new Set(routePairs(plan).map((r) => r.key));
  const ourAirports = new Set(routePairs(plan).flatMap((r) => [r.a, r.b]));
  ourAirports.add(plan.base);
  return { routes: net.routes.filter((r) => ours.has(r.key)), airports: net.airports.filter((c) => ourAirports.has(c)) };
}

/** Departures from one airport in local time order, over a typical day. */
export function departuresFrom(net: AirlineNetwork, code: string): { time: number; to: string; type: AircraftModel; freq: number }[] {
  const out: { time: number; to: string; type: AircraftModel; freq: number }[] = [];
  for (const r of net.routes) {
    const s = r.a === code ? r.out : r.b === code ? r.back : null;
    if (s) for (const t of s.times) out.push({ time: t, to: s.to, type: s.type, freq: s.freq });
  }
  return out.sort((x, y) => x.time - y.time || x.to.localeCompare(y.to));
}

export const AREA_NAMES: Record<NameArea, string> = {
  sino: '大中華與新加坡', japan: '日本', korea: '韓國', seasia: '東南亞', southasia: '南亞', mideast: '中東', steppe: '中亞與蒙古',
  europe: '歐洲', africa: '非洲', northam: '北美', latam: '中南美與加勒比', oceania: '大洋洲',
};
export const AREA_ORDER: NameArea[] = ['sino', 'japan', 'korea', 'seasia', 'southasia', 'oceania', 'mideast', 'steppe', 'europe', 'africa', 'northam', 'latam'];
export const areaOf = (a: Airline): NameArea => nameAreaOf(a.country);

let regionNames: Intl.DisplayNames | null | undefined;
/** A country's name in Traditional Chinese (falls back to its code). */
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['zh-Hant-TW', 'zh-Hant', 'zh'], { type: 'region' }); } catch { regionNames = null; }
  }
  try { return regionNames?.of(code) ?? code; } catch { return code; }
}
