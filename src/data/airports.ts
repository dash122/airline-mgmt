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

/**
 * The data file carries a base weekly slot figure per airport size (hub 140, major 84, large 56, medium 35, small 14).
 * Slots were the limit on growing a network, so the game multiplies them: a hub allows about 20 departures an hour.
 */
export const SLOT_SCALE = 10;

export const AIRPORTS = (data as Airport[]).map((a) => ({ ...a, slotCap: a.slotCap * SLOT_SCALE }));

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

/** Bases the player can start from. */
export const BASES = ['TPE', 'KHH', 'HKG', 'KIX', 'FUK', 'HND'];
