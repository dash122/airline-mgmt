import { describe, expect, test } from 'vitest';
import { airlines, airlinesAt, COUNTRY_NAMES, HUB_WAVES, NAME_POOLS, nameAreaOf, rivalsAt, rivalsBetween, rivalsFrom } from './competitors';
import { DESTINATIONS, LONG_HAUL_KM, longHaulDestinations, marketBetween, markets, marketsAt, modelledAnnualPax, modelledLocalPax } from './markets';
import { AIRPORTS } from '../data/airports';
import { AIRCRAFT } from '../data/aircraft';
import { addRoundTrip, emptyPlan, simulate } from './simulate';

describe('competitor airlines', () => {
  test('airport indexes preserve the global market totals and competitor services', () => {
    for (const code of ['TPE', 'LHR', 'MFM']) {
      const expected = [...markets().values()].filter(m => m.a === code || m.b === code);
      expect(marketsAt(code)).toEqual(expected);
      expect(modelledLocalPax(code)).toBeCloseTo(expected.reduce((sum, m) => sum + 104 * m.airDemand, 0), 5);
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
    const counts = new Map<string, number>(), longCounts = new Map<string, number>();
    for (const m of markets().values()) {
      if (!m.rivalFreq) continue;
      const c = m.distKm > LONG_HAUL_KM ? longCounts : counts;
      c.set(m.a, (c.get(m.a) ?? 0) + 1);
      c.set(m.b, (c.get(m.b) ?? 0) + 1);
      expect(m.distKm).toBeLessThanOrEqual(15000);
      expect(marketBetween(m.b, m.a)).toBe(m);
    }
    for (const a of AIRPORTS) {
      expect(counts.get(a.code) ?? 0).toBeLessThanOrEqual(DESTINATIONS[a.size]);
      expect(longCounts.get(a.code) ?? 0).toBeLessThanOrEqual(longHaulDestinations(a));
    }
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

  test('names fit where the airline is based and never carry numbers', () => {
    const all = airlines();
    expect(all.every((a) => !/[0-9]/.test(a.name))).toBe(true);
    const base = (a: { name: string }) => a.name.replace(/航空$/, '').replace(/(之星|之翼|快線|國際|聯合)$/, '');
    for (const a of all) {
      const p = NAME_POOLS[nameAreaOf(a.country)];
      expect([...p.full, ...p.low, ...p.regional, ...(COUNTRY_NAMES[a.country] ?? [])].includes(base(a)) || base(a).length === 2).toBe(true);
    }
    expect(all.find((a) => a.country === 'FR' && a.kind === 'full')!.name).toBe('塞納航空');
    expect(nameAreaOf('DE')).toBe('europe');
    expect(nameAreaOf('BR')).toBe('latam');
    expect(nameAreaOf('JP')).toBe('japan');
  });

  test('existing service in each market is split between airlines without losing flights', () => {
    let early = 0;
    for (const m of markets().values()) {
      if (m.rivalFreq <= 0) continue;
      const out = rivalsFrom(m.a, m.b);
      expect(out.length).toBeGreaterThan(0);
      const total = out.reduce((s, x) => s + x.freq, 0);
      expect(Math.abs(total - m.rivalFreq)).toBeLessThanOrEqual(out.length);
      for (const s of out) for (const t of s.times) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(24 * 60);
        if (t < 6 * 60) early++;
      }
    }
    // Departures are no longer held to 06:00 or later: some long-haul flights leave in the small hours.
    expect(early).toBeGreaterThan(0);
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

  test('big hubs have long-haul competitors', () => {
    // Weekly flights each way, with room around today's timetables (London-New York about 140, Dubai-London 80).
    const ranges: [string, string, number][] = [['HKG', 'LHR', 80], ['HKG', 'JFK', 50], ['SIN', 'LHR', 80], ['LHR', 'JFK', 160], ['DXB', 'LHR', 120], ['NRT', 'LHR', 50], ['TPE', 'LAX', 60]];
    for (const [a, b, hi] of ranges) {
      const f = marketBetween(a, b)!.rivalFreq;
      expect(f, `${a}-${b}`).toBeGreaterThanOrEqual(7);
      expect(f, `${a}-${b}`).toBeLessThanOrEqual(hi);
      for (const s of rivalsFrom(a, b)) expect(AIRCRAFT[s.type].cls, `${a}-${b}`).toBe('widebody');
    }
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

  test('competitor frequencies stay close to real ones on busy Hong Kong routes', () => {
    // Hong Kong–Guangzhou is a 50-minute train ride: almost nobody flies it.
    expect(marketBetween('HKG', 'CAN')!.ground?.name).toBe('高鐵/新幹線');
    expect(marketBetween('HKG', 'CAN')!.rivalFreq).toBeLessThan(15);
    // Hong Kong–Taipei is one of Asia's busiest routes, mostly on widebodies: about 15 to 20 a day each way.
    const tpe = marketBetween('HKG', 'TPE')!.rivalFreq;
    expect(tpe).toBeGreaterThan(70);
    expect(tpe).toBeLessThan(150);
  });
});

describe('competitor networks', () => {
  test('hubs follow real traffic, and the biggest markets have several full-service airlines with their own hubs', () => {
    const hubs = (c: string) => airlines().filter((a) => a.country === c && a.kind === 'full').map((a) => a.bases[0]);
    expect(hubs('CN').sort()).toEqual(['CAN', 'PEK', 'PVG']);
    expect(hubs('US')).toContain('ATL');
    expect(hubs('US')).toHaveLength(3);
    // Osaka is far smaller than Tokyo and Manchester than London, so both airlines share the main city.
    expect(hubs('JP')).toEqual(['HND', 'HND']);
    expect(hubs('GB')).toEqual(['LHR', 'LHR']);
    expect(hubs('TW')).toEqual(['TPE']);
  });

  test('low-cost airlines only fly from their bases', () => {
    for (const m of markets().values()) {
      if (m.rivalFreq <= 0) continue;
      for (const s of rivalsFrom(m.a, m.b)) {
        if (s.airline.kind !== 'low') continue;
        const bases = s.airline.bases;
        const based = bases.includes(m.a) || bases.includes(m.b);
        // The only exception: a route between two other cities that it flies because its base is the nearest.
        if (!based) expect(rivalsFrom(m.a, m.b).map((x) => x.airline.id), `${m.a}-${m.b}`).toEqual([s.airline.id]);
      }
    }
  });

  test('holiday airports get few long-haul routes', () => {
    const longAt = (c: string) => [...markets().values()].filter((m) => m.rivalFreq > 0 && m.distKm > LONG_HAUL_KM && (m.a === c || m.b === c)).length;
    expect(longAt('PMI')).toBeLessThanOrEqual(5);
    expect(longAt('AGP')).toBeLessThanOrEqual(10);
    expect(longAt('FRA')).toBeGreaterThan(25);
  });

  test('flights leave in waves at the airline hub, and long-haul flights at long-haul times', () => {
    const inWave = (t: number) => HUB_WAVES.some((w) => t >= w && t <= w + 3 * 25 + 20);
    for (const { to, services } of rivalsAt('TPE')) {
      for (const s of services) {
        if (s.airline.bases.includes('TPE') && marketBetween('TPE', to)!.distKm <= LONG_HAUL_KM) for (const t of s.times) expect(inWave(t), `TPE-${to} ${t}`).toBe(true);
      }
    }
    // Los Angeles-Taipei leaves late in the evening and lands at dawn.
    for (const s of rivalsFrom('LAX', 'TPE')) expect(Math.max(...s.times)).toBeGreaterThanOrEqual(20 * 60);
  });
});
