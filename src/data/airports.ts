// Airports are generated from open data by scripts/build-data.mjs (OurAirports, GeoNames, Natural Earth).
import type { AircraftClass } from './aircraft';
import data from './airports.json';

export type Country = 'TW' | 'HK' | 'MO' | 'JP';
export type AirportSize = 'hub' | 'major' | 'large' | 'medium' | 'small';

export interface Airport {
  code: string;
  name: string; // Traditional Chinese
  country: Country;
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

export const AIRPORTS = data as Airport[];

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

/** Bases the player can start from. */
export const BASES = ['TPE', 'KHH', 'HKG', 'KIX', 'FUK', 'HND'];
