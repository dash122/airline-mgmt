import { describe, expect, it } from 'vitest';
import { airlines } from './competitors';
import { airlineNetwork, airlineNetworks, departuresFrom, overlapWithPlan } from './networks';
import { addRoundTrip, emptyPlan } from './simulate';

describe('airline networks', () => {
  const hk = airlines().find((a) => a.country === 'HK' && a.kind === 'full')!;
  const net = airlineNetwork(hk.id)!;

  it('puts the main base first and lists routes from the hub side', () => {
    expect(net.hubs[0].code).toBe('HKG');
    expect(net.hubs[0].main).toBe(true);
    expect(net.routes.length).toBeGreaterThan(20);
    expect(net.routes.every((r) => r.a === 'HKG' || r.b !== 'HKG')).toBe(true);
    expect(net.routes.some((r) => r.key === 'HKG-TPE')).toBe(true);
  });

  it('sums departures and estimates a fleet', () => {
    const deps = net.routes.reduce((s, r) => s + r.out.freq + r.back.freq, 0);
    expect(net.flights).toBe(deps);
    expect(net.fleet.reduce((s, f) => s + f.aircraft, 0)).toBeGreaterThan(5);
    expect(departuresFrom(net, 'HKG').length).toBeGreaterThan(net.hubs[0].destinations - 1);
  });

  it('finds the player overlap', () => {
    const r = addRoundTrip(emptyPlan('TPE'), 'TPE', 'HKG');
    if ('error' in r) throw new Error(r.error);
    const o = overlapWithPlan(net, r.plan);
    expect(o.routes.map((x) => x.key)).toContain('HKG-TPE');
    expect(o.airports).toEqual(expect.arrayContaining(['HKG', 'TPE']));
  });

  it('lists every airline that flies, busiest first, each with hubs', () => {
    const all = airlineNetworks();
    expect(all.length).toBeGreaterThan(100);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].flights).toBeGreaterThanOrEqual(all[i].flights);
    expect(all.every((n) => n.hubs.length >= 1 && n.hubs.length <= 4)).toBe(true);
  });
});
