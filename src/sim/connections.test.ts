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
      { from: 'PVG', to: 'YVR', via: 'HKG', stops: ['PVG', 'HKG', 'YVR'], pax: 40 },
      { from: 'LAX', to: 'HKG', via: 'YVR', stops: ['LAX', 'YVR', 'HKG'], pax: 25 },
      { from: 'YVR', to: 'SFO', via: 'HKG', stops: ['YVR', 'HKG', 'SFO'], pax: 10 },
    ]);
  });

  test('ignores flows under half a traveller a week and a missing network', () => {
    const n = net({ HKG: [{ from: 'PVG', to: 'YVR', pax: 0.4 }] });
    expect(routeConnections(n, 'HKG', 'YVR')).toEqual([]);
    expect(routeConnections(null, 'HKG', 'YVR')).toEqual([]);
  });
});

describe('route connections over two stops', () => {
  // A CAN→HKG→JFK→MIA trip is listed at both of its transfer airports, with the same stops.
  const stops = ['CAN', 'HKG', 'JFK', 'MIA'];
  const flow = { from: 'CAN', to: 'MIA', pax: 12, long: 0, stopover: 0, stops };
  const net2 = (transfers: Record<string, typeof flow[]>) => ({
    transfers: Object.fromEntries(Object.entries(transfers).map(([via, flows]) => [via, { pax: 0, long: 0, stopover: 0, flows }])),
  }) as unknown as NetworkResult;

  test('lists a two-stop journey once, under the stop on the route it rides', () => {
    const n = net2({ HKG: [flow], JFK: [flow] });
    expect(routeConnections(n, 'HKG', 'CAN')).toEqual([{ from: 'CAN', to: 'MIA', via: 'HKG', stops, pax: 12 }]);
    expect(routeConnections(n, 'HKG', 'JFK')).toEqual([{ from: 'CAN', to: 'MIA', via: 'HKG', stops, pax: 12 }]);
    expect(routeConnections(n, 'JFK', 'MIA')).toEqual([{ from: 'CAN', to: 'MIA', via: 'JFK', stops, pax: 12 }]);
    expect(routeConnections(n, 'CAN', 'MIA')).toEqual([]);
  });
});
