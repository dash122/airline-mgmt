import { describe, expect, test } from 'vitest';
import { addRoundTrip, emptyPlan, simulate, type Plan } from '../sim/simulate';
import { marketSplit } from '../sim/share';
import { marketPotential } from '../sim/airports';
import { breakEven, explainRoute } from './explain';

const trips = (plan: Plan, a: string, b: string, n: number) => {
  let p = plan;
  for (let i = 0; i < n; i++) {
    const r = addRoundTrip(p, a, b, 'A20N');
    if ('error' in r) throw new Error(r.error);
    p = r.plan;
  }
  return p;
};

describe('tap-to-explain', () => {
  const plan = trips(emptyPlan('TPE'), 'TPE', 'HKG', 2);
  const r = simulate(plan).routes['HKG-TPE'];
  const split = marketSplit('HKG', 'TPE', r);

  test('the profit breakdown adds up to revenue and flying cost', () => {
    const m = r.money;
    expect(m.localRevenue + m.connectingRevenue).toBeCloseTo(r.revenue, 0);
    expect(m.blockCost + m.departureCost + m.paxCost + m.salesCost).toBeCloseTo(r.flyingCost, 0);
    expect(explainRoute('profit', r, split).rows.at(-1)!.total).toBe(true);
  });
  test('break-even load factor is where fares cover flying costs', () => {
    const be = breakEven(r)!;
    expect(be.loadFactor).toBeGreaterThan(0);
    expect(be.loadFactor < r.loadFactor).toBe(r.revenue > r.flyingCost);
  });
  test('spill names the full flights and the travellers turned away', () => {
    const e = explainRoute('spill', r, split);
    expect(e.why).toContain('溢出');
    if (r.spill > 1) expect(r.fullFlights).toBeGreaterThan(0);
    expect(explainRoute('lf', r, split).rows[0].value).toContain(String(r.flightsPerWeek));
  });
  test('market share compares flights and fares with the competitors', () => {
    const e = explainRoute('share', r, split);
    expect(e.why).toContain('班次');
    expect(e.rows.some((x) => x.label.includes('對手平均'))).toBe(true);
  });
});

describe('airport market potential', () => {
  test('flown markets show what the player carries; unflown ones what a daily flight would win', () => {
    const plan = trips(emptyPlan('TPE'), 'TPE', 'HKG', 1);
    const pot = marketPotential(plan, simulate(plan), 'TPE');
    expect(pot.total).toBeGreaterThan(pot.ours);
    expect(pot.ours).toBeGreaterThan(0);
    const hkg = pot.rows.find((x) => x.to === 'HKG')!;
    expect(hkg.flown).toBe(true);
    expect(hkg.ours).toBeGreaterThan(0);
    const other = pot.rows.find((x) => !x.flown && x.seats > 0)!;
    expect(other.estimate).toBeGreaterThan(0);
  });
});
