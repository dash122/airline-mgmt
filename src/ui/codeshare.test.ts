import { describe, expect, test } from 'vitest';
import type { NetworkResult } from '../sim/simulate';
import { groupFeeds } from './codeshare';

// Partner feeds into one route: grouped per airline, biggest first, so the route sheet can show a few rows
// instead of one chip per partner route.
const net = {
  codeshares: {
    'A|NRT-HKG': { airline: 'A', key: 'NRT-HKG', feeds: [{ key: 'HKG-KHH', pax: 300 }, { key: 'HKG-TPE', pax: 50 }] },
    'A|ICN-HKG': { airline: 'A', key: 'ICN-HKG', feeds: [{ key: 'HKG-KHH', pax: 120 }] },
    'B|SIN-HKG': { airline: 'B', key: 'SIN-HKG', feeds: [{ key: 'HKG-KHH', pax: 500 }] },
    'C|BKK-HKG': { airline: 'C', key: 'BKK-HKG', feeds: [{ key: 'HKG-KHH', pax: 0.4 }] },
  },
} as unknown as NetworkResult;

describe('groupFeeds', () => {
  test('one group per airline with its routes, both sorted biggest first', () => {
    const groups = groupFeeds(net, 'HKG-KHH');
    expect(groups.map((g) => g.airline)).toEqual(['B', 'A']);
    expect(groups[1].pax).toBe(420);
    expect(groups[1].routes).toEqual([{ key: 'NRT-HKG', pax: 300 }, { key: 'ICN-HKG', pax: 120 }]);
  });

  test('ignores feeds into other routes and under one traveller', () => {
    const groups = groupFeeds(net, 'HKG-KHH');
    expect(groups.some((g) => g.airline === 'C')).toBe(false);
    expect(groupFeeds(net, 'HKG-TPE').map((g) => g.pax)).toEqual([50]);
  });

  test('no result yet means no groups', () => {
    expect(groupFeeds(null, 'HKG-KHH')).toEqual([]);
    expect(groupFeeds(undefined, 'HKG-KHH')).toEqual([]);
  });
});
