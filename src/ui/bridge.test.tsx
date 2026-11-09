import { describe, expect, test } from 'vitest';
import type { NetworkResult } from '../sim/simulate';
import { travellerRows } from './bridge';

const flow = (from: string, to: string, pax: number, stops?: string[]) => ({ from, to, pax, long: 0, stopover: 0, ...(stops ? { stops } : {}) });
const net = (transfers: Record<string, ReturnType<typeof flow>[]>, codeshares: unknown = {}) => ({
  transfers: Object.fromEntries(Object.entries(transfers).map(([via, flows]) => [via, { pax: 0, long: 0, stopover: 0, flows }])),
  codeshares,
}) as unknown as NetworkResult;

describe('traveller rows', () => {
  test('lists direct travellers and connecting trips, biggest first, with the route read first', () => {
    const n = net({ HKG: [flow('KHH', 'OKA', 2), flow('OKA', 'TPE', 7)] });
    const rows = travellerRows(n, 'HKG-OKA', 94);
    expect(rows.map((r) => r.pax)).toEqual([94, 7, 2]);
    expect(rows[0].path).toEqual(['HKG', 'OKA']);
    expect(rows.every((r) => r.path.length === 2 || r.path.includes('HKG'))).toBe(true);
  });

  test('puts this route on the first leg of every trip', () => {
    const n = net({ HKG: [flow('KHH', 'OKA', 5)] });
    const [row] = travellerRows(n, 'HKG-OKA', 0);
    expect(row.path).toEqual(['OKA', 'HKG', 'KHH']);
    expect(row.pax).toBe(5);
  });

  test('marks a partner trip once and does not count its travellers twice', () => {
    const cs = { x: { airline: 'A', key: 'ASJ-OKA', feeds: [{ key: 'HKG-OKA', pax: 6, revenue: 0 }], journeys: [{ path: ['HKG', 'OKA', 'ASJ'], pax: 6 }, { path: ['HND', 'OKA', 'HKG'], pax: 3 }] } };
    const n = net({ OKA: [flow('HKG', 'ASJ', 6)] }, cs);
    const rows = travellerRows(n, 'HKG-OKA', 10);
    expect(rows.find((r) => r.path.includes('ASJ'))).toMatchObject({ pax: 6, partner: { airline: 'A', key: 'ASJ-OKA' } });
    expect(rows.reduce((s, r) => s + r.pax, 0)).toBe(19);
  });

  test('is empty with no network and no direct travellers', () => {
    expect(travellerRows(null, 'HKG-OKA', 0)).toEqual([]);
  });
});
