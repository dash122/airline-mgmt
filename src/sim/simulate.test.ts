import { describe, expect, test } from 'vitest';
import { AIRPORTS } from '../data/airports';
import { marketBetween, markets, modelledAnnualPax } from './markets';
import { AIR_TARGETS_M } from '../data/calibration';
import { routeProblem, simulate, simulateRoute, type Plan } from './simulate';

const plan: Plan = {
  base: 'TPE',
  routes: [
    { id: 'r1', a: 'TPE', b: 'HKG', aircraft: 'narrowbody', freq: 14, fareMult: 1 },
    { id: 'r2', a: 'TSA', b: 'MZG', aircraft: 'turboprop', freq: 14, fareMult: 1 },
    { id: 'r3', a: 'TPE', b: 'NRT', aircraft: 'narrowbody', freq: 7, fareMult: 1 },
  ],
};

describe('markets', () => {
  test('modelled air travel matches each group target', () => {
    const totals: Record<string, number> = {};
    for (const m of markets().values()) totals[m.group] = (totals[m.group] ?? 0) + (m.airDemand * 104) / 1e6;
    for (const g of ['JP-JP', 'TW-TW', 'JP-TW', 'HK-TW', 'HK-JP']) {
      expect(totals[g] / AIR_TARGETS_M[g]).toBeGreaterThan(0.9);
      expect(totals[g] / AIR_TARGETS_M[g]).toBeLessThan(1.1);
    }
  });
  test('every airport has people and coordinates', () => {
    expect(AIRPORTS.length).toBeGreaterThan(90);
    for (const a of AIRPORTS) {
      expect(a.catchment).toBeGreaterThan(0);
      expect(Number.isFinite(a.lat) && Number.isFinite(a.lon)).toBe(true);
    }
  });
  test('no markets inside one metro', () => {
    expect(marketBetween('HND', 'NRT')).toBeUndefined();
    expect(marketBetween('TPE', 'TSA')).toBeUndefined();
  });
  test('big metros fly more than small towns', () => {
    expect(modelledAnnualPax('HND')).toBeGreaterThan(modelledAnnualPax('KUH') * 20);
  });
  test('ground travel: rail on one landmass, ferry to near islands, nothing to far islands', () => {
    expect(marketBetween('HND', 'ITM')!.ground?.name).toContain('高鐵');
    expect(marketBetween('KHH', 'MZG')!.ground?.name).toContain('渡輪');
    expect(marketBetween('TSA', 'KNH')!.ground).toBeUndefined();
  });
});

describe('simulate', () => {
  test('is deterministic', () => {
    expect(simulate(plan)).toEqual(simulate(plan));
  });
  test('never carries more than seats', () => {
    for (const r of Object.values(simulate(plan).routes)) expect(r.paxPerDir).toBeLessThanOrEqual(r.seatsPerDir + 1e-9);
  });
  test('more flights win more travellers', () => {
    const base = { id: 'x', a: 'TPE', b: 'HKG', aircraft: 'widebody' as const, fareMult: 1 };
    expect(simulateRoute({ ...base, freq: 21 }).demandPerDir).toBeGreaterThan(simulateRoute({ ...base, freq: 7 }).demandPerDir);
  });
  test('cheaper fares win more travellers', () => {
    const base = { id: 'x', a: 'TPE', b: 'OKA', aircraft: 'narrowbody' as const, freq: 7 };
    expect(simulateRoute({ ...base, fareMult: 0.8 }).demandPerDir).toBeGreaterThan(simulateRoute({ ...base, fareMult: 1.2 }).demandPerDir);
  });
  test('high-speed rail takes most short trips', () => {
    const m = marketBetween('HND', 'NGO')!;
    expect(m.airDemand / m.potential).toBeLessThan(0.3);
    const far = marketBetween('HND', 'OKA')!;
    expect(far.airDemand / far.potential).toBeGreaterThan(0.9);
  });
});

describe('route rules', () => {
  test('runway and range limits', () => {
    expect(routeProblem('TSA', 'LZN', 'narrowbody')).not.toBeNull();
    expect(routeProblem('TSA', 'LZN', 'turboprop')).toBeNull();
    expect(routeProblem('TPE', 'CTS', 'turboprop')).not.toBeNull();
    expect(routeProblem('HND', 'NRT', 'narrowbody')).not.toBeNull();
    expect(routeProblem('TTT', 'KYD', 'narrowbody')).not.toBeNull();
  });
});
