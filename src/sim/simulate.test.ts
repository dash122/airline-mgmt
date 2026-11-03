import { describe, expect, test } from 'vitest';
import { AIRPORTS } from '../data/airports';
import { marketBetween, markets } from './markets';
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
  test('calibrated demand roughly matches each airport target', () => {
    const ms = [...markets().values()];
    for (const a of AIRPORTS) {
      const total = ms.filter((m) => m.a === a.code || m.b === a.code).reduce((s, m) => s + m.airDemand, 0);
      const target = (a.annualPaxM * 1e6 * a.inRegionShare) / 104;
      expect(total / target).toBeGreaterThan(0.95);
      expect(total / target).toBeLessThan(1.05);
    }
  });
  test('no markets inside one city', () => {
    expect([...markets().keys()]).not.toContain('HND-NRT');
    expect([...markets().keys()]).not.toContain('TPE-TSA');
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
  test('most Taipei-Kaohsiung travellers take high-speed rail', () => {
    const khh = marketBetween('TSA', 'KHH')!;
    const mzg = marketBetween('TSA', 'MZG')!;
    expect(khh.surface).toBeDefined();
    expect(khh.airDemand / khh.potential).toBeLessThan(0.5);
    expect(mzg.airDemand / mzg.potential).toBeGreaterThan(0.8);
  });
});

describe('route rules', () => {
  test('runway and range limits', () => {
    expect(routeProblem('TSA', 'LZN', 'narrowbody')).not.toBeNull();
    expect(routeProblem('TSA', 'LZN', 'turboprop')).toBeNull();
    expect(routeProblem('TPE', 'CTS', 'turboprop')).not.toBeNull();
    expect(routeProblem('HND', 'NRT', 'narrowbody')).not.toBeNull();
  });
});
