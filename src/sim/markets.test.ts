import { expect, test } from 'vitest';
import { AIRPORT_BY_CODE, airportMarkerRadius } from '../data/airports';
import { ANNUAL_TRAFFIC_M } from '../data/airport-traffic';
import { marketBetween, marketsAt, modelledAnnualPax } from './markets';

test('global hubs have substantial transatlantic and transpacific demand', () => {
  for (const [a, b] of [['JFK', 'LHR'], ['LAX', 'NRT'], ['LAX', 'LHR'], ['JFK', 'CDG']]) {
    const m = marketBetween(a, b)!;
    expect(m.airDemand, `${a}-${b}`).toBeGreaterThan(1000);
    expect(m.rivalFreq).toBeGreaterThan(0);
  }
  for (const code of ['JFK', 'LAX', 'LHR', 'DXB']) {
    expect(modelledAnnualPax(code)).toBeGreaterThan(40e6);
    expect(modelledAnnualPax(code)).toBeLessThan(120e6);
  }
});

test('traffic determines marker hierarchy and shared metros never create demand', () => {
  expect(airportMarkerRadius(AIRPORT_BY_CODE.LAX)).toBeGreaterThan(airportMarkerRadius(AIRPORT_BY_CODE.JFK));
  expect(airportMarkerRadius(AIRPORT_BY_CODE.JFK)).toBeGreaterThan(airportMarkerRadius(AIRPORT_BY_CODE.KUH));
  expect(marketBetween('JFK', 'EWR')).toBeUndefined();
  expect(marketBetween('JFK', 'LGA')).toBeUndefined();
  expect(marketsAt('LAX').every(m => Number.isFinite(m.potential) && m.potential >= m.airDemand)).toBe(true);
});

test('modelled passengers match real traffic at the busiest airports outside the hand-calibrated regions', () => {
  let n = 0;
  for (const [code, millions] of Object.entries(ANNUAL_TRAFFIC_M)) {
    if (!AIRPORT_BY_CODE[code] || millions < 10 || ['JP', 'TW', 'HK', 'MO'].includes(AIRPORT_BY_CODE[code].country)) continue;
    n++;
    expect(modelledAnnualPax(code) / 1e6 / millions, code).toBeGreaterThan(0.85);
    expect(modelledAnnualPax(code) / 1e6 / millions, code).toBeLessThan(1.15);
  }
  expect(n).toBeGreaterThan(100);
});

test('airport populations are real metro populations shared between the airports of a metro', () => {
  const metro = (codes: string[]) => codes.reduce((s, c) => s + AIRPORT_BY_CODE[c].catchment, 0) / 1e6;
  expect(metro(['JFK', 'LGA', 'EWR'])).toBeGreaterThan(15);
  expect(metro(['JFK', 'LGA', 'EWR'])).toBeLessThan(26);
  expect(metro(['LHR', 'LGW', 'STN', 'LTN', 'LCY'])).toBeGreaterThan(11);
  expect(metro(['CDG', 'ORY'])).toBeGreaterThan(8);
  expect(AIRPORT_BY_CODE.JFK.catchment).toBeGreaterThan(AIRPORT_BY_CODE.LGA.catchment);
  expect(AIRPORT_BY_CODE.SIN.catchment).toBeLessThan(12e6);
});
