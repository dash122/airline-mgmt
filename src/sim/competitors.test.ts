import { describe, expect, test } from 'vitest';
import { airlines, airlinesAt, rivalsAt, rivalsBetween, rivalsFrom } from './competitors';
import { marketBetween, markets, marketsAt, modelledAnnualPax } from './markets';
import { AIRPORTS } from '../data/airports';
import { addRoundTrip, emptyPlan, simulate } from './simulate';

describe('competitor airlines', () => {
  test('airport indexes preserve the global market totals and competitor services', () => {
    for (const code of ['TPE', 'LHR', 'MFM']) {
      const expected = [...markets().values()].filter(m => m.a === code || m.b === code);
      expect(marketsAt(code)).toEqual(expected);
      expect(modelledAnnualPax(code)).toBeCloseTo(expected.reduce((sum, m) => sum + 104 * m.airDemand, 0), 5);
      const rivals = rivalsAt(code);
      expect(rivalsAt(code)).toBe(rivals);
      expect(rivals.map(r => r.to).sort()).toEqual(expected.filter(m => {
        const to = m.a === code ? m.b : m.a;
        return m.rivalFreq > 0 && rivalsFrom(code, to).length > 0;
      }).map(m => m.a === code ? m.b : m.a).sort());
    }
    expect(marketsAt('UNKNOWN')).toEqual([]);
    expect(modelledAnnualPax('UNKNOWN')).toBe(0);
  });
  test('global nonstop networks respect airport destination budgets and remain symmetric', () => {
    const limits = { hub: 100, major: 60, large: 30, medium: 12, small: 4 };
    const counts = new Map<string, number>();
    for (const m of markets().values()) {
      if (!m.rivalFreq) continue;
      counts.set(m.a, (counts.get(m.a) ?? 0) + 1);
      counts.set(m.b, (counts.get(m.b) ?? 0) + 1);
      expect(m.distKm).toBeLessThanOrEqual(15000);
      expect(marketBetween(m.b, m.a)).toBe(m);
    }
    for (const a of AIRPORTS) expect(counts.get(a.code) ?? 0).toBeLessThanOrEqual(limits[a.size]);
  });

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
    // Rival travellers are counted before seats run out, so they add up with our demand (carried plus spill).
    expect(rivalPax + route.localDemand + route.connectingPax).toBeCloseTo(route.airTotal, -1);
  });
});
