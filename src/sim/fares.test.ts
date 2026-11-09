import { describe, expect, test, vi } from 'vitest';
import { codeshareIdeas, hostedIdeas } from './codeshare';
import { addRoundTrip, emptyPlan, simulate, type Plan } from './simulate';
import { bestFare, fareCurve, fareCurveSteps } from './fares';
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
    // Widebodies on the HKG leg, so no flight fills up and a cheaper fare isn't lost to spill.
    const net = trips(trips(emptyPlan('TPE'), 'TPE', 'HKG', 3, 'A359'), 'TPE', 'NRT', 2);
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
    // The bug this guards against put about 11,900 a week on one daily flight.
    expect(itm.demand).toBeLessThan(itm.seats * 1.5);
  });
  test('a city pair nobody flies still gives the first nonstop most travellers, not all of them', () => {
    const m = marketBetween('HUN', 'ITM')!;
    const r = simulate(trips(emptyPlan('HUN'), 'HUN', 'ITM', 3)).routes['HUN-ITM'];
    expect(r.rivals).toHaveLength(0);
    expect(r.demand).toBeGreaterThan(m.potential * 0.5);
    expect(r.demand).toBeLessThan(m.potential * 2 * 0.9);
  });
});

describe('fare curve steps', () => {
  const hkg = trips(emptyPlan('TPE'), 'TPE', 'HKG', 3);
  test('every other step first, in line with today\'s fare, then the rest; same curve as all at once', () => {
    const plan = { ...hkg, fares: { 'HKG-TPE': 1.05 } };
    const out: ReturnType<typeof fareCurve> = [];
    const steps = fareCurveSteps(plan, 'HKG-TPE', out);
    let coarse: number[] | null = null;
    for (let r = steps.next(); !r.done; r = steps.next()) if (r.value === 'coarse') coarse = out.map((p) => p.mult);
    expect(coarse).toEqual([0.75, 0.85, 0.95, 1.05, 1.15, 1.25, 1.35]);
    expect(out).toHaveLength(15);
    expect(out.map((p) => p.mult)).toEqual([...out.map((p) => p.mult)].sort((x, y) => x - y));
    for (const p of out) expect(p.profit).toBeCloseTo(at(plan, 'HKG-TPE', p.mult).revenue - at(plan, 'HKG-TPE', p.mult).cost, 6);
  });
  test('simulating the same plan again returns the remembered result', () => {
    expect(simulate(hkg)).toBe(simulate(JSON.parse(JSON.stringify(hkg))));
  });
});

describe('structure reuse across fares', () => {
  test('a fare tried on a remembered plan structure gives exactly the results of a cold start, codeshares included', async () => {
    let p = trips(trips(trips(emptyPlan('HKG'), 'HKG', 'NRT', 2), 'HKG', 'SIN', 2), 'HKG', 'TPE', 2);
    p = { ...p, codeshares: codeshareIdeas(p, 6).map((i) => ({ airline: i.airline, key: i.route.key })) };
    p = { ...p, hosted: hostedIdeas(p, 6, 6).map((h) => ({ airline: h.airline, key: h.key })) };
    expect((p.codeshares?.length ?? 0) + (p.hosted?.length ?? 0)).toBeGreaterThan(0);
    const tried = { ...p, fares: { 'HKG-NRT': 1.25, 'HKG-SIN': 0.8 } };
    simulate(p); // remembers the structure
    const warm = JSON.stringify(simulate(tried));
    vi.resetModules();
    const cold = JSON.stringify((await import('./simulate')).simulate(tried));
    expect(warm).toBe(cold);
  });
});
