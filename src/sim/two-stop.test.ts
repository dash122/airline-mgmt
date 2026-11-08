import { describe, expect, it } from 'vitest';
import { rivalsBetween } from './competitors';
import { canCodeshare, connectionWeight, addRoundTrip, emptyPlan, simulate, toggleCodeshare, tripWeight, type Plan } from './simulate';
import { routeConnections } from './connections';

// The player flies HKG-JFK and HKG-CAN from its Hong Kong hub. A codeshare on a partner's JFK-MIA flight lets
// Guangzhou travellers reach Miami: CAN-HKG, HKG-JFK, then the partner's JFK-MIA flight.
const hubPlan = (): Plan => {
  let plan = emptyPlan('HKG');
  for (const d of ['JFK', 'CAN']) {
    const r = addRoundTrip(plan, 'HKG', d);
    if ('error' in r) throw new Error(r.error);
    plan = r.plan;
  }
  return plan;
};
const partner = rivalsBetween('JFK', 'MIA').find((s) => canCodeshare(s.airline))!.airline.id;
const key = 'JFK-MIA';

describe('two-stop trips over a codeshare', () => {
  const plan = hubPlan();
  const before = simulate(plan);
  const withCs = toggleCodeshare(plan, partner, key);
  const after = simulate(withCs);
  const cs = after.codeshares[`${partner}|${key}`];

  it('bridges Guangzhou to Miami only once the partner sells its New York-Miami flight', () => {
    expect(before.markets['CAN>MIA']).toBeUndefined();
    const m = after.markets['CAN>MIA'];
    expect(m).toBeDefined();
    expect(m!.wanted).toBeGreaterThan(0);
    expect(m!.via.HKG ?? 0).toBeGreaterThan(0);
  });

  it('books the trip on each of the player\'s flights and the partner\'s, with a fare share to each', () => {
    const feeds = cs.feeds.map((f) => f.key);
    expect(feeds).toEqual(expect.arrayContaining(['CAN-HKG', 'HKG-JFK']));
    // Each trip counts once for the codeshare, however many of the player's flights it uses.
    expect(cs.pax).toBeGreaterThan(0);
    // The player's share of the fares is split between its flights by distance and adds back up to the codeshare's total.
    const feedRevenue = cs.feeds.reduce((s, f) => s + f.revenue, 0);
    expect(feedRevenue).toBeCloseTo(cs.feedRevenue, 3);
  });

  it('lists the trip in the transfer airports with its full stop list', () => {
    const jfk = after.transfers.JFK.flows.find((f) => f.from === 'CAN' && f.to === 'MIA');
    const hkg = after.transfers.HKG.flows.find((f) => f.from === 'CAN' && f.to === 'MIA');
    expect(jfk?.stops).toEqual(['CAN', 'HKG', 'JFK', 'MIA']);
    expect(hkg?.stops).toEqual(['CAN', 'HKG', 'JFK', 'MIA']);
    expect(jfk!.pax).toBeCloseTo(hkg!.pax, 6);
  });

  it('shows the trip on the player routes it rides, once each, with the transfer airport on that route', () => {
    const onCan = routeConnections(after, 'HKG', 'CAN');
    expect(onCan).toContainEqual(expect.objectContaining({ from: 'CAN', to: 'MIA', via: 'HKG' }));
    expect(onCan.filter((c) => c.from === 'CAN' && c.to === 'MIA')).toHaveLength(1);
    const onJfk = routeConnections(after, 'HKG', 'JFK');
    expect(onJfk).toContainEqual(expect.objectContaining({ from: 'CAN', to: 'MIA', via: 'HKG' }));
  });

  it('weighs a second stop as a further connection: less attractive than one stop with the same layover', () => {
    const one = tripWeight(2, [{ waitMin: 90, via: 'HKG', through: false }], 5000);
    expect(one).toBeCloseTo(connectionWeight(2, 90, 'HKG', 5000), 12);
    const two = tripWeight(4, [{ waitMin: 90, via: 'HKG', through: false }, { waitMin: 90, via: 'JFK', through: false }], 5000);
    expect(two).toBeLessThan(one);
  });
});
