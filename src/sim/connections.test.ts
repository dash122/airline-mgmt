import { describe, expect, test } from 'vitest';
import type { NetworkResult } from './simulate';
import { routeConnections } from './connections';

const net = (transfers: Record<string, { from: string; to: string; pax: number }[]>) => ({
  transfers: Object.fromEntries(Object.entries(transfers).map(([via, flows]) => [via, {
    pax: 0, long: 0, stopover: 0, flows: flows.map((f) => ({ ...f, long: 0, stopover: 0 })),
  }])),
}) as unknown as NetworkResult;

describe('route connections', () => {
  test('keeps only journeys that ride the route on one of their legs, biggest first', () => {
    const n = net({
      HKG: [{ from: 'PVG', to: 'YVR', pax: 40 }, { from: 'YVR', to: 'SFO', pax: 10 }],
      YVR: [{ from: 'LAX', to: 'HKG', pax: 25 }, { from: 'SFO', to: 'PVG', pax: 99 }],
    });
    expect(routeConnections(n, 'HKG', 'YVR')).toEqual([
      { from: 'PVG', to: 'YVR', via: 'HKG', pax: 40 },
      { from: 'LAX', to: 'HKG', via: 'YVR', pax: 25 },
      { from: 'YVR', to: 'SFO', via: 'HKG', pax: 10 },
    ]);
  });

  test('ignores flows under half a traveller a week and a missing network', () => {
    const n = net({ HKG: [{ from: 'PVG', to: 'YVR', pax: 0.4 }] });
    expect(routeConnections(n, 'HKG', 'YVR')).toEqual([]);
    expect(routeConnections(null, 'HKG', 'YVR')).toEqual([]);
  });
});
