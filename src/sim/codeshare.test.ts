import { describe, expect, it } from 'vitest';
import { rivalsBetween } from './competitors';
import { bestShare, codeshareIdeaSteps, hostedChoices, hostedIdeaSteps, hostedIdeas, hostedImpact, hostedOptions, codeshareIdeas, codeshareImpact, codeshareOptions, shareChoices } from './codeshare';
import { canCodeshare, CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, CODESHARE_SHARES, codeshareFee, codeshareShare, setCodeshareShare, feederFlights, HOSTED_FEE_PER_WEEK, setHostedShare, toggleHosted, addRoundTrip, emptyPlan, partnerFlights, simulate, toggleCodeshare, type Plan } from './simulate';
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

  it('lets the player size the seat block, with a fee that grows with it', () => {
    expect(codeshareShare(withCs, partner.id, key)).toBe(CODESHARE_SEAT_SHARE);
    const big = setCodeshareShare(withCs, partner.id, key, 0.4);
    expect(big.codeshares).toEqual([{ airline: partner.id, key, seatShare: 0.4 }]);
    // Back to the default stores no override; on a plan without it, it starts the codeshare.
    expect(setCodeshareShare(big, partner.id, key, CODESHARE_SEAT_SHARE).codeshares).toEqual([{ airline: partner.id, key }]);
    expect(setCodeshareShare(plan, partner.id, key, 0.1).codeshares).toEqual([{ airline: partner.id, key, seatShare: 0.1 }]);
    const r = simulate(big).codeshares[`${partner.id}|${key}`];
    expect(r.share).toBe(0.4);
    expect(r.seats).toBeGreaterThan(cs.seats * 1.9);
    expect(r.fee).toBe(codeshareFee(0.4));
    expect(codeshareFee(0.4)).toBeGreaterThan(CODESHARE_FEE_PER_WEEK);
    expect(codeshareFee(0.4) / 0.4).toBeLessThan(CODESHARE_FEE_PER_WEEK / CODESHARE_SEAT_SHARE);
    expect(r.pax).toBeGreaterThanOrEqual(cs.pax - 1e-6);
  });

  it('prices every seat block against having no codeshare', () => {
    const choices = shareChoices(withCs, partner.id, key);
    expect(choices.map((c) => c.share)).toEqual([...CODESHARE_SHARES]);
    const now = choices.find((c) => c.share === CODESHARE_SEAT_SHARE)!;
    expect(now.gain).toBeCloseTo(after.revenue - after.cost - (before.revenue - before.cost), 0);
    expect(shareChoices(plan, partner.id, key)[1].gain).toBeCloseTo(now.gain, 0);
    expect(choices).toContain(bestShare(choices));
    const imp = codeshareImpact(withCs, partner.id, key, undefined, 0.4)!;
    expect(imp.gain).toBeCloseTo(choices[3].gain, 0);
  });

  it('reports each partner departure, what it sells and which of your flights it connects with', () => {
    expect(cs.departures.length).toBe(partnerFlights({ airline: partner.id, key }).length);
    const sold = cs.departures.reduce((s, d) => s + d.pax * d.perWeek, 0);
    expect(sold).toBeCloseTo(cs.pax, 3);
    for (const d of cs.departures) {
      expect(d.pax).toBeLessThanOrEqual(d.seats + 1e-6);
      expect(d.wanted).toBeGreaterThanOrEqual(d.pax - 1e-6);
      if (d.pax > 0.1) expect(d.links).toBeGreaterThan(0);
      if (d.top) expect([d.top.from, d.top.to].sort().join('-')).toBe('BKK-TPE');
    }
    expect(cs.departures.some((d) => d.top)).toBe(true);
  });

  it('lists the best new codeshares across every partner', () => {
    const ideas = codeshareIdeas(plan, 8);
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.map((i) => i.gain)).toEqual(ideas.map((i) => i.gain).sort((x, y) => y - x));
    expect(new Set(ideas.map((i) => i.airline)).size).toBeGreaterThan(1);
    for (const i of ideas) expect(i.gain).toBeGreaterThan(0);
    expect(codeshareIdeas(withCs, 50).some((i) => i.airline === partner.id && i.route.key === key)).toBe(false);
  });

  it('the step version finds the same ideas as it goes, so a long search can show partial results', () => {
    const found: ReturnType<typeof codeshareIdeas> = [];
    const steps = codeshareIdeaSteps(plan, 8, undefined, found);
    let r = steps.next();
    let pauses = 0;
    while (!r.done) { pauses++; r = steps.next(); }
    expect(pauses).toBeGreaterThan(1);
    expect(r.value.map((i) => `${i.airline}|${i.route.key}`)).toEqual(codeshareIdeas(plan, 8).map((i) => `${i.airline}|${i.route.key}`));
    expect(found.length).toBeGreaterThan(0);
    const hosted = hostedIdeaSteps(plan, 8);
    let h = hosted.next();
    while (!h.done) h = hosted.next();
    expect(h.value.map((i) => `${i.airline}|${i.key}`)).toEqual(hostedIdeas(plan, 8).map((i) => `${i.airline}|${i.key}`));
  });

  it('extensions: near limits ideas to partner routes that touch those airports', () => {
    const [a, b] = key.split('-');
    const near = codeshareIdeas(plan, 50, [a, b]);
    for (const i of near) expect([i.route.a, i.route.b].some((c) => c === a || c === b)).toBe(true);
    const all = codeshareIdeas(plan, 50);
    expect(near.length).toBeLessThanOrEqual(all.length);
  });

  describe('partners selling your routes', () => {
    const route = 'BKK-TPE';
    const host = hostedOptions(plan, route)[0];
    const hosted = toggleHosted(plan, host.airline, route);
    const res = simulate(hosted);
    const h = res.hosted[`${host.airline}|${route}`];

    it('brings the partner\'s travellers from its flights at either end onto your route', () => {
      expect(host.gain).toBeGreaterThan(0);
      expect(h.pax).toBeGreaterThan(50);
      expect(h.pax).toBeLessThanOrEqual(h.seats + 1e-6);
      expect(h.wanted).toBeGreaterThanOrEqual(h.pax - 1e-6);
      expect(h.sources.length).toBeGreaterThan(0);
      for (const f of feederFlights({ airline: host.airline, key: route })) {
        expect([f.from, f.to].some((x) => x === 'BKK' || x === 'TPE')).toBe(true);
        expect(f.hosted).toBe(route);
      }
      expect(res.routes[route].pax).toBeGreaterThan(before.routes[route].pax);
      // Nothing sold on routes the partner doesn't sell, and no partner-only trips.
      expect(res.routes['NRT-TPE']).toBeUndefined();
    });

    it('adds up: your fare share, displaced own travellers, costs and the fee', () => {
      expect(h.fee).toBe(HOSTED_FEE_PER_WEEK);
      expect(res.codeshareCost).toBe(HOSTED_FEE_PER_WEEK);
      const imp = hostedImpact(hosted, host.airline, route)!;
      expect(imp.gain).toBeCloseTo(res.revenue - res.cost - (before.revenue - before.cost), 0);
      expect(imp.revenue + imp.ownRevenue - imp.paxCost - imp.fee).toBeCloseTo(imp.gain, 0);
      expect(imp.lfAfter).toBeGreaterThan(imp.lfBefore);
      expect(h.revenue).toBeGreaterThan(0);
      expect(h.partnerRevenue).toBeGreaterThan(0);
    });

    it('caps the partner at its seat block on your flights', () => {
      const small = simulate(setHostedShare(plan, host.airline, route, 0.1)).hosted[`${host.airline}|${route}`];
      const big = simulate(setHostedShare(plan, host.airline, route, 0.4)).hosted[`${host.airline}|${route}`];
      expect(big.seats).toBeGreaterThan(small.seats * 3.5);
      expect(small.pax).toBeLessThanOrEqual(small.seats + 1e-6);
      expect(big.pax).toBeGreaterThanOrEqual(small.pax - 1e-6);
      const choices = hostedChoices(plan, host.airline, route);
      expect(choices[1].gain).toBeCloseTo(host.gain, 0);
    });

    it('ranks partners for each of your routes', () => {
      const ideas = hostedIdeas(plan, 6, 6);
      expect(ideas.length).toBeGreaterThan(0);
      expect(ideas.map((i) => i.gain)).toEqual(ideas.map((i) => i.gain).sort((x, y) => y - x));
      const opts = hostedOptions(hosted, route);
      expect(opts[0]).toMatchObject({ airline: host.airline, active: true });
    });
  });
});
