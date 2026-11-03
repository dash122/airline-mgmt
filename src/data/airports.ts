// Airports are generated from open data by scripts/build-data.mjs (OurAirports, GeoNames, Natural Earth).
import type { AircraftClass } from './aircraft';
import data from './airports.json';

/** ISO 3166-1 alpha-2 country code. */
export type Country = string;
/** East Asia, Southeast Asia, South and Central Asia, Middle East, Europe, Africa, North America, Latin America, Oceania. */
export type WorldRegion = 'EA' | 'SEA' | 'SAS' | 'ME' | 'EU' | 'AF' | 'NA' | 'LAT' | 'OC';
export type AirportSize = 'hub' | 'major' | 'large' | 'medium' | 'small';

export interface Airport {
  code: string;
  name: string; // Traditional Chinese
  country: Country;
  world: WorldRegion;
  region: string; // ISO 3166-2
  metro: string; // airports in one metro never form a market with each other
  lat: number;
  lon: number;
  utcOffset: number; // minutes east of UTC, standard time (no daylight saving)
  island: boolean; // small landmass: ferry-reachable if near the mainland, otherwise flights are the only way
  size: AirportSize;
  runwayM: number;
  maxClass: AircraftClass;
  landmass: string; // airports on one landmass can be reached by ground
  hsr: boolean; // on a high-speed rail line
  catchment: number; // people who use this airport (share of nearby towns)
  tourism: number; // how strongly the place attracts visitors
  slotCap: number; // weekly departures the player may add
}

export const AIRPORTS = data as Airport[];

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

/** Bases the player can start from. */
export const BASES = ['TPE', 'HKG', 'HND', 'KIX', 'ICN', 'SIN', 'BKK', 'DXB', 'LHR', 'FRA', 'JFK', 'LAX', 'SYD', 'GRU'];
