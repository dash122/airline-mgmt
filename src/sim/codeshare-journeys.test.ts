import { describe, expect, test } from 'vitest';
import { rivalsBetween } from './competitors';
import { pairKey } from './markets';
import { addRoundTrip, canCodeshare, emptyPlan, simulate, toggleCodeshare, type Plan } from './simulate';

const fly = (plan: Plan, a: string, b: string) => {
  const r = addRoundTrip(plan, a, b);
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};

// A partner flight Tokyo-Osaka, your flights Osaka-Hong Kong and Hong Kong-Changsha: a traveller from Tokyo to Changsha
// flies the partner, then you, then you. The result has to say so, stop by stop, not just "via Osaka".
describe('codeshare journeys', () => {
  const partner = [...new Set(rivalsBetween('HND', 'KIX').filter((s) => canCodeshare(s.airline)).map((s) => s.airline.id))][0];
  const key = pairKey('HND', 'KIX');
  const base = fly(fly(emptyPlan('HKG'), 'HKG', 'CSX'), 'HKG', 'KIX');
  const result = simulate(toggleCodeshare(base, partner, key));
  const stats = result.codeshares[`${partner}|${key}`];

  test('there is a partner airline that flies Tokyo-Osaka and can codeshare', () => {
    expect(partner).toBeTruthy();
    expect(stats).toBeTruthy();
  });

  test('every journey uses the partner flight as one of its legs, and has at least two legs', () => {
    expect(stats.journeys.length).toBeGreaterThan(0);
    for (const j of stats.journeys) {
      const legs = j.path.slice(1).map((c, i) => pairKey(j.path[i], c));
      expect(legs, j.path.join('>')).toContain(key);
      expect(j.path.length).toBeGreaterThanOrEqual(3);
      expect(j.pax).toBeGreaterThan(0);
    }
  });

  test('keeps the stops after Osaka: a Tokyo traveller reaches Changsha through Hong Kong, not straight from Osaka', () => {
    const toCsx = stats.journeys.find((j) => j.path.includes('CSX') && j.path.includes('HND'));
    expect(toCsx, JSON.stringify(stats.journeys.map((j) => j.path.join('>')))).toBeTruthy();
    const p = toCsx!.path;
    // Either direction is fine, but Hong Kong sits between Osaka and Changsha.
    const at = (c: string) => p.indexOf(c);
    expect(Math.abs(at('KIX') - at('HKG'))).toBe(1);
    expect(Math.abs(at('HKG') - at('CSX'))).toBe(1);
  });

  test('both directions of a journey are one row, biggest first', () => {
    const keys = stats.journeys.map((j) => [...j.path].sort().join('>'));
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < stats.journeys.length; i++) expect(stats.journeys[i - 1].pax).toBeGreaterThanOrEqual(stats.journeys[i].pax);
  });
});
