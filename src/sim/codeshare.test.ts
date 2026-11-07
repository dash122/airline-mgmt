import { describe, expect, it } from 'vitest';
import { rivalsBetween } from './competitors';
import { codeshareImpact, codeshareOptions } from './codeshare';
import { canCodeshare, CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, addRoundTrip, emptyPlan, partnerFlights, simulate, toggleCodeshare, type Plan } from './simulate';
import { AIRCRAFT } from '../data/aircraft';
import { hubTransit } from './airports';

const planWith = (base: string, dests: string[]): Plan => {
  let plan = emptyPlan(base);
  for (const d of dests) {
    const r = addRoundTrip(plan, base, d);
    if ('error' in r) throw new Error(r.error);
    plan = r.plan;
  }
  return plan;
};
const partnerOn = (a: string, b: string) => rivalsBetween(a, b).filter((s) => canCodeshare(s.airline)).sort((x, y) => y.freq - x.freq)[0].airline;

describe('codeshare', () => {
  const plan = planWith('TPE', ['BKK']);
  const partner = partnerOn('BKK', 'HKT');
  const key = 'BKK-HKT';
  const withCs = toggleCodeshare(plan, partner.id, key);
  const before = simulate(plan);
  const after = simulate(withCs);
  const cs = after.codeshares[`${partner.id}|${key}`];

  it('breaks the profit change into terms that add up, and says which of your routes it feeds', () => {
    const imp = codeshareImpact(withCs, partner.id, key)!;
    const off = codeshareImpact(plan, partner.id, key)!;
    expect(imp.active).toBe(true);
    expect(off.active).toBe(false);
    expect(off.gain).toBeCloseTo(imp.gain, 0);
    expect(imp.gain).toBeCloseTo((after.revenue - after.cost) - (before.revenue - before.cost), 0);
    expect(imp.feedRevenue + imp.ownRevenue - imp.paxCost - imp.fee).toBeCloseTo(imp.gain, 0);
    expect(cs.wanted).toBeGreaterThanOrEqual(cs.pax - 1e-6);
    const feed = cs.feeds.find((f) => f.key === 'BKK-TPE')!;
    expect(feed.pax).toBeCloseTo(cs.pax, 3);
    expect(feed.revenue).toBeCloseTo(cs.feedRevenue, 0);
    const r = imp.routes.find((x) => x.key === 'BKK-TPE')!;
    expect(r.lfAfter).toBeGreaterThan(r.lfBefore);
  });

  it('sells connections from your flights onto the partner route', () => {
    expect(cs.pax).toBeGreaterThan(50);
    expect(after.markets['TPE>HKT']?.via.BKK ?? 0).toBeGreaterThan(10);
    expect(after.connectingPax).toBeGreaterThan(before.connectingPax);
    // Every codeshare trip includes one of your own flights: none between the partner's two ends alone.
    expect(after.markets['BKK>HKT']).toBeUndefined();
    expect(after.routes[key]).toBeUndefined();
  });

  it('splits the ticket by distance and charges a weekly fee', () => {
    expect(cs.fee).toBe(CODESHARE_FEE_PER_WEEK);
    expect(after.codeshareCost).toBe(CODESHARE_FEE_PER_WEEK);
    expect(after.cost - after.flyingCost - after.ownershipCost - after.hubCost).toBeCloseTo(CODESHARE_FEE_PER_WEEK, 3);
    expect(cs.feedRevenue).toBeGreaterThan(0);
    expect(cs.partnerRevenue).toBeGreaterThan(0);
    // The player books only its own part: total revenue equals the fares on its own flights.
    const own = Object.values(after.routes).reduce((s, r) => s + r.revenue, 0);
    expect(after.revenue).toBeCloseTo(own, -2);
    // TPE-BKK is much longer than BKK-HKT, so the player keeps most of each ticket.
    expect(cs.feedRevenue).toBeGreaterThan(cs.partnerRevenue);
  });

  it('gives a fixed block of seats on each partner flight', () => {
    const flights = partnerFlights({ airline: partner.id, key });
    expect(flights.length).toBeGreaterThan(0);
    for (const f of flights) expect(f.seats).toBe(Math.round(AIRCRAFT[f.type].seats * CODESHARE_SEAT_SHARE));
    expect(cs.pax).toBeLessThanOrEqual(cs.seats + 1e-6);
  });

  it('only full-service and regional airlines codeshare', () => {
    const low = rivalsBetween('BKK', 'HKT').find((s) => s.airline.kind === 'low');
    if (low) expect(partnerFlights({ airline: low.airline.id, key })).toEqual([]);
    expect(codeshareOptions(plan, low?.airline.id ?? 'none')).toEqual([]);
  });

  it('ranks the partner routes by what they add, with active ones first', () => {
    const opts = codeshareOptions(withCs, partner.id);
    expect(opts[0].active).toBe(true);
    expect(opts[0].route.key).toBe(key);
    expect(opts[0].gain).toBeCloseTo(after.revenue - after.cost - (before.revenue - before.cost), 0);
    const rest = opts.slice(1).map((o) => o.gain);
    expect(rest).toEqual([...rest].sort((x, y) => y - x));
  });

  it('counts a codeshare leg as reachable in the hub transit view', () => {
    const t = hubTransit(withCs, after, 'BKK');
    const row = t.carried.find((l) => [l.o, l.d].sort().join('-') === 'HKT-TPE');
    expect(row?.viaPax ?? 0).toBeGreaterThan(10);
  });
});
