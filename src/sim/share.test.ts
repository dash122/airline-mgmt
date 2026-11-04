import { describe, expect, test } from 'vitest';
import { addRoundTrip, emptyPlan, simulate, type Plan } from './simulate';
import { marketSplit } from './share';

const trips = (p: Plan, a: string, b: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const r = addRoundTrip(p, a, b);
    if ('error' in r) throw new Error(r.error);
    p = r.plan;
  }
  return p;
};
const sum = (s: ReturnType<typeof marketSplit>) => s.rows.reduce((t, r) => t + r.pax, 0) + s.ownTurnedAway;

describe('route market share', () => {
  test('before the player flies, competitors share the whole market', () => {
    const s = marketSplit('HKG', 'TPE');
    expect(s.rows.length).toBeGreaterThan(1);
    expect(s.rows.every((r) => r.kind !== 'own')).toBe(true);
    expect(sum(s)).toBeCloseTo(s.total, 0);
    expect(s.rows.reduce((t, r) => t + r.share, 0)).toBeCloseTo(1, 3);
  });

  test('flying the route takes travellers from competitors, and the parts add up', () => {
    const r = simulate(trips(emptyPlan('TPE'), 'TPE', 'HKG', 3)).routes['HKG-TPE'];
    const s = marketSplit('HKG', 'TPE', r);
    const own = s.rows[0];
    expect(own.kind).toBe('own');
    expect(own.pax).toBeCloseTo(r.localPax, 3);
    expect(own.share).toBeCloseTo(r.marketShare, 3);
    expect(sum(s)).toBeCloseTo(r.airTotal, 0);
    const rivals = s.rows.filter((x) => x.kind === 'rival');
    expect(rivals.length).toBeGreaterThan(0);
    for (const x of rivals) expect(x.pax).toBeLessThan(x.before);
    expect(s.ownFreqShare).toBeGreaterThan(0);
    expect(s.ownFreqShare).toBeLessThan(1);
  });

  test('same-city competitors are labelled with the airports they fly', () => {
    const r = simulate(trips(emptyPlan('TPE'), 'TPE', 'ITM', 1)).routes['ITM-TPE'];
    const s = marketSplit('ITM', 'TPE', r);
    const rivals = s.rows.filter((x) => x.kind === 'rival');
    expect(rivals.length).toBeGreaterThan(0);
    expect(rivals.every((x) => x.airports.length > 0 && !x.airports.includes('ITM-TPE'))).toBe(true);
    // Opening Itami still takes travellers from the airlines at Kansai.
    for (const x of rivals) expect(x.pax).toBeLessThan(x.before);
  });
});
