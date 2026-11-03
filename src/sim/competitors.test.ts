import { describe, expect, test } from 'vitest';
import { airlines, airlinesAt, rivalsBetween, rivalsFrom } from './competitors';
import { marketBetween, markets } from './markets';
import { AIRPORTS } from '../data/airports';
import { addRoundTrip, emptyPlan, simulate } from './simulate';

describe('competitor airlines', () => {
  test('Macau competitors use documented destinations, not every market with demand', () => {
    for (const code of ['ITM', 'TNN', 'TSA', 'HND', 'CTS']) {
      const m = marketBetween('MFM', code)!;
      expect(m.potential).toBeGreaterThan(0);
      expect(m.rivalFreq).toBe(0);
      expect(m.airDemand).toBe(0);
      expect(rivalsBetween('MFM', code)).toEqual([]);
      expect(rivalsBetween(code, 'MFM')).toEqual([]);
    }
    for (const code of ['TPE', 'KHH', 'RMQ', 'NRT', 'KIX', 'FUK']) {
      expect(rivalsFrom('MFM', code).length).toBeGreaterThan(0);
      expect(rivalsFrom(code, 'MFM').length).toBeGreaterThan(0);
    }
  });

  test('Itami has domestic competitors but no international competitors', () => {
    for (const a of AIRPORTS.filter((a) => a.country !== 'JP')) {
      expect(rivalsBetween('ITM', a.code)).toEqual([]);
    }
    expect(rivalsFrom('ITM', 'HND').length).toBeGreaterThan(0);
  });

  test('an unserved Macau market still supports new player service', () => {
    const r = addRoundTrip(emptyPlan('MFM'), 'MFM', 'TNN', 'A20N');
    if ('error' in r) throw new Error(r.error);
    const route = simulate(r.plan).routes['MFM-TNN'];
    expect(route.rivals).toEqual([]);
    expect(route.localPax).toBeGreaterThan(0);
  });

  test('names are unique and every country has a full-service airline', () => {
    const all = airlines();
    expect(new Set(all.map((a) => a.name)).size).toBe(all.length);
    for (const c of new Set(all.map((a) => a.country))) expect(all.some((a) => a.country === c && a.kind === 'full')).toBe(true);
  });

  test('existing service in each market is split between airlines without losing flights', () => {
    for (const m of markets().values()) {
      if (m.rivalFreq <= 0) continue;
      const out = rivalsFrom(m.a, m.b);
      expect(out.length).toBeGreaterThan(0);
      const total = out.reduce((s, x) => s + x.freq, 0);
      expect(Math.abs(total - m.rivalFreq)).toBeLessThanOrEqual(out.length);
      for (const s of out) for (const t of s.times) expect(t).toBeGreaterThanOrEqual(6 * 60);
    }
  });

  test('a busy route has several airlines, low-cost ones cheaper than full-service', () => {
    const list = rivalsFrom('TPE', 'HKG');
    expect(new Set(list.map((s) => s.airline.id)).size).toBeGreaterThan(1);
    const low = list.find((s) => s.airline.kind === 'low')!, full = list.find((s) => s.airline.kind === 'full')!;
    expect(low.fare).toBeLessThan(full.fare);
  });

  test('the main hub is dominated by its home airline', () => {
    expect(airlinesAt('HND')[0].airline.country).toBe('JP');
    expect(airlinesAt('TPE')[0].airline.bases[0]).toBe('TPE');
  });

  test('deterministic', () => {
    expect(JSON.stringify(rivalsBetween('NRT', 'FUK'))).toBe(JSON.stringify(rivalsBetween('NRT', 'FUK')));
  });

  test('route results report competitor travellers', () => {
    const r = addRoundTrip(emptyPlan('TPE'), 'TPE', 'HKG', 'A20N');
    if ('error' in r) throw new Error(r.error);
    const route = simulate(r.plan).routes['HKG-TPE'];
    expect(route.rivals.length).toBeGreaterThan(1);
    const rivalPax = route.rivals.reduce((s, x) => s + x.pax, 0);
    expect(rivalPax + route.localPax).toBeCloseTo(route.airTotal, -1);
  });
});
