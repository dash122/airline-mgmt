import { expect, test } from 'vitest';
import { AIRPORT_BY_CODE, airportMarkerRadius } from '../data/airports';
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
