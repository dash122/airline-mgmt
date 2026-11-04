import { describe, expect, test } from 'vitest';
import { addRoundTrip, emptyPlan, simulate, type Plan } from './simulate';
import { bestFare, fareCurve } from './fares';
import { marketBetween } from './markets';

const must = (r: ReturnType<typeof addRoundTrip>) => {
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};
const trips = (p: Plan, a: string, b: string, n: number, type?: Parameters<typeof addRoundTrip>[3]) => {
  for (let i = 0; i < n; i++) p = must(addRoundTrip(p, a, b, type));
  return p;
};
const at = (p: Plan, key: string, mult: number) => simulate({ ...p, fares: { ...p.fares, [key]: mult } });

describe('fares', () => {
  const hkg = trips(emptyPlan('TPE'), 'TPE', 'HKG', 3);
  test('every fare step changes demand, smoothly', () => {
    const curve = fareCurve(hkg, 'HKG-TPE');
    expect(curve).toHaveLength(15);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].demand).toBeLessThan(curve[i - 1].demand);
      // +5% never costs more than a fifth of the demand: no cliff.
      expect(curve[i].demand / curve[i - 1].demand).toBeGreaterThan(0.8);
    }
  });
  test('the response is similar on short and long routes', () => {
    const drop = (p: Plan, key: string) => at(p, key, 1.1).routes[key].demand / at(p, key, 1).routes[key].demand;
    const short = drop(hkg, 'HKG-TPE');
    const long = drop(trips(emptyPlan('TPE'), 'TPE', 'NRT', 3), 'NRT-TPE');
    expect(Math.abs(short - long)).toBeLessThan(0.08);
  });
  test('on a full route, a higher fare first eats the spill and keeps the load', () => {
    const full = trips(emptyPlan('TSA'), 'TSA', 'MZG', 2, 'ATR72');
    const lo = at(full, 'MZG-TSA', 1).routes['MZG-TSA'];
    const hi = at(full, 'MZG-TSA', 1.1).routes['MZG-TSA'];
    expect(lo.spill).toBeGreaterThan(100);
    expect(hi.spill).toBeLessThan(lo.spill);
    expect(hi.revenue).toBeGreaterThan(lo.revenue);
    expect(lo.demand).toBeCloseTo(lo.pax + lo.spill, 6);
  });
  test('a fare on one leg reaches the connecting travellers on it', () => {
    const net = trips(trips(emptyPlan('TPE'), 'TPE', 'HKG', 3), 'TPE', 'NRT', 2);
    const conn = (mult: number) => { const r = at(net, 'HKG-TPE', mult).routes['HKG-TPE']; return r.pax - r.localPax; };
    expect(conn(1)).toBeGreaterThan(50);
    expect(conn(1.2)).toBeLessThan(conn(1) * 0.95);
    expect(conn(0.8)).toBeGreaterThan(conn(1) * 1.05);
  });
  test('the suggested fare is the most profitable step', () => {
    const curve = fareCurve(hkg, 'HKG-TPE');
    const best = bestFare(curve)!;
    for (const p of curve) expect(best.profit).toBeGreaterThanOrEqual(p.profit - 1);
    expect(best.mult).toBeGreaterThan(0.7);
    expect(best.mult).toBeLessThan(1.4);
  });
});

describe('airports in one city', () => {
  test('a route nobody flies competes with flights from the other airport in the same city', () => {
    const itm = simulate(trips(emptyPlan('TPE'), 'TPE', 'ITM', 1)).routes['ITM-TPE'];
    const kix = simulate(trips(emptyPlan('TPE'), 'TPE', 'KIX', 1)).routes['KIX-TPE'];
    expect(itm.rivals.length).toBeGreaterThan(0);
    // About the same order of demand as flying to the busier airport, not the whole city's travellers.
    expect(itm.demand).toBeLessThan(kix.demand * 2);
    expect(itm.demand).toBeLessThan(itm.seats);
  });
  test('a city pair nobody flies still gives the first nonstop most travellers, not all of them', () => {
    const m = marketBetween('KHH', 'ITM')!;
    const r = simulate(trips(emptyPlan('KHH'), 'KHH', 'ITM', 3)).routes['ITM-KHH'];
    expect(r.rivals).toHaveLength(0);
    expect(r.demand).toBeGreaterThan(m.potential * 0.5);
    expect(r.demand).toBeLessThan(m.potential * 2 * 0.9);
  });
});
