// Airports are generated from open data by scripts/build-data.mjs (OurAirports, GeoNames, Natural Earth).
import type { AircraftClass } from './aircraft';
import data from './airports.json';
import { ANNUAL_TRAFFIC_M } from './airport-traffic';

export type Country = string;
export type AirportSize = 'hub' | 'major' | 'large' | 'medium' | 'small';

export interface Airport {
  code: string;
  name: string; // Traditional Chinese
  country: Country;
  utcOffset: number; // fixed game UTC offset in minutes (no seasonal DST)
  region: string; // ISO 3166-2
  metro: string; // airports in one metro never form a market with each other
  lat: number;
  lon: number;
  size: AirportSize;
  runwayM: number;
  maxClass: AircraftClass;
  landmass: string; // airports on one landmass can be reached by ground
  hsr: boolean; // on a high-speed rail line
  catchment: number; // people who use this airport (share of nearby towns)
  tourism: number; // how strongly the place attracts visitors
  slotCap: number; // weekly departures the player may add
}

/**
 * The data file carries a base weekly slot figure per airport size (hub 140, major 84, large 56, medium 35, small 14).
 * Slots were the limit on growing a network, so the game multiplies them: a hub allows about 20 departures an hour.
 */
export const SLOT_SCALE = 10;

export const AIRPORTS: Airport[] = (data as Airport[]).map((a) => {
  const traffic = ANNUAL_TRAFFIC_M[a.code];
  const size = traffic ? (traffic >= 35 ? 'hub' : 'major') : a.size;
  return { ...a, size, slotCap: Math.max(a.slotCap, size === 'hub' ? 140 : size === 'major' ? 84 : 0) * SLOT_SCALE };
});

/** Radius in screen pixels; circle area grows with historical passenger traffic. */
export function airportMarkerRadius(a: Airport): number {
  const traffic = ANNUAL_TRAFFIC_M[a.code];
  return traffic ? 3 + Math.sqrt(traffic) * 0.75
    : { hub: 7, major: 5, large: 4.5, medium: 3.5, small: 3 }[a.size];
}

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

/** Bases the player can start from. */
export const BASES = ['TPE', 'KHH', 'HKG', 'KIX', 'FUK', 'HND', 'SIN', 'DXB', 'LHR', 'CDG', 'JFK', 'LAX', 'SYD', 'JNB', 'GRU'];
