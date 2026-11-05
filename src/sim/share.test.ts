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

  test('a long-haul flight fed by many routes still carries local travellers', () => {
    // Hong Kong-Frankfurt: one daily widebody against two rival airlines, with connections from eight routes.
    let p = emptyPlan('HKG');
    const r0 = addRoundTrip(p, 'HKG', 'FRA', 'B789');
    if ('error' in r0) throw new Error(r0.error);
    p = r0.plan;
    for (const x of ['TPE', 'NRT', 'ICN', 'MNL', 'BKK', 'SIN', 'PVG', 'KIX']) p = trips(p, 'HKG', x, 4);
    const r = simulate(p).routes['FRA-HKG'];
    expect(r.rivals.length).toBeGreaterThan(0);
    // The feeders are full but the widebody isn't: travellers turned away count on the full feeders, not here.
    expect(r.loadFactor).toBeLessThan(0.9);
    expect(r.spill).toBe(0);
    expect(r.pax - r.localPax).toBeGreaterThan(0);
    // Seats go to local and connecting travellers alike, so local travellers aren't squeezed out.
    expect(r.localPax / r.pax).toBeGreaterThan(0.1);
  });
});

describe('direct and connecting travellers in one market', () => {
  test('a market you only serve by connecting shows your connection next to the nonstop airlines, and adds up', () => {
    const p = trips(trips(emptyPlan('TPE'), 'TPE', 'HKG', 1), 'TPE', 'NRT', 1);
    const net = simulate(p);
    const s = marketSplit('HKG', 'NRT', undefined, net);
    const via = s.rows.find((r) => r.kind === 'ownVia');
    expect(via?.via).toBe('TPE');
    expect(via!.pax).toBeGreaterThan(0);
    expect(s.rows.some((r) => r.kind === 'own')).toBe(false);
    expect(s.rows.some((r) => r.kind === 'rival')).toBe(true);
    expect(sum(s)).toBeCloseTo(s.total, 0);
    // Nonstop airlines are listed before connections.
    const kinds = s.rows.map((r) => r.kind);
    expect(kinds.indexOf('ownVia')).toBeGreaterThan(kinds.lastIndexOf('rival'));
  });
  test('on a route you fly, the nonstop numbers match the route result', () => {
    const p = trips(emptyPlan('TPE'), 'TPE', 'HKG', 2);
    const net = simulate(p);
    const s = marketSplit('TPE', 'HKG', net.routes['HKG-TPE'], net);
    expect(s.rows.find((r) => r.kind === 'own')!.pax).toBeCloseTo(net.routes['HKG-TPE'].localPax, 0);
    expect(s.total).toBeCloseTo(net.routes['HKG-TPE'].airTotal, 0);
    expect(sum(s)).toBeCloseTo(s.total, 0);
  });
});
