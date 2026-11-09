import { describe, expect, test } from 'vitest';
import { rivalsBetween } from '../sim/competitors';
import { canCodeshare } from '../sim/simulate';
import { partnersOn } from './airport-views';

// The airport sheet offers a codeshare chip per partner on a route. A codeshare needs an airline that flies exactly
// this airport pair, and the market split also counts airlines serving the same city from another airport.
describe('codeshare partners on an airport route', () => {
  test('only airlines that fly the exact pair and can codeshare, never low-cost ones', () => {
    const partners = partnersOn('HKG', 'TPE');
    expect(partners.length).toBeGreaterThan(0);
    const flying = new Set(rivalsBetween('HKG', 'TPE').map((s) => s.airline.id));
    for (const a of partners) {
      expect(flying.has(a.id)).toBe(true);
      expect(canCodeshare(a)).toBe(true);
    }
    expect(new Set(partners.map((a) => a.id)).size).toBe(partners.length);
  });

  test('a pair nobody flies directly has no partners, even when the city has other airports served', () => {
    // Osaka's ITM is served by airlines through KIX, but nobody flies HKG-ITM itself.
    expect(rivalsBetween('HKG', 'ITM')).toHaveLength(0);
    expect(partnersOn('HKG', 'ITM')).toEqual([]);
  });
});
