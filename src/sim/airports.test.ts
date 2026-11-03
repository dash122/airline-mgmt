import { describe, expect, test } from 'vitest';
import { byAirport, connectionGaps, hourly, spokes, stations, timeline } from './airports';
import { addRoundTrip, emptyPlan, newAircraft, simulate, utcFromLocal, type Plan } from './simulate';

const build = (): Plan => {
  let p = emptyPlan('TPE');
  for (const [a, b, n] of [['TPE', 'HKG', 2], ['TPE', 'NRT', 1], ['TPE', 'KIX', 1]] as const) {
    for (let i = 0; i < n; i++) { const r = addRoundTrip(p, a, b); if ('error' in r) throw new Error(r.error); p = r.plan; }
  }
  return p;
};
const plan = build();
const result = simulate(plan);

describe('airport views', () => {
  test('spokes list each direct route once with its daily flights', () => {
    const s = spokes(plan, result, 'TPE');
    expect(s.map((x) => x.other).sort()).toEqual(['HKG', 'KIX', 'NRT']);
    expect(s.find((x) => x.other === 'HKG')!.flightsPerDay).toBe(2);
    expect(s.find((x) => x.other === 'NRT')!.bearing).toBeGreaterThan(30);
    expect(s.find((x) => x.other === 'NRT')!.bearing).toBeLessThan(90);
  });
  test('the timeline is chronological and counts every flight', () => {
    const t = timeline(plan, { mode: 'dep', basis: 'local' });
    expect(t.length).toBe(8);
    for (let i = 1; i < t.length; i++) expect(t[i].time).toBeGreaterThanOrEqual(t[i - 1].time);
    expect(timeline(plan, { mode: 'dep', basis: 'local', airport: 'HKG' }).every((r) => r.from === 'HKG')).toBe(true);
  });
  test('arrivals are listed at the airport they land at', () => {
    expect(timeline(plan, { mode: 'arr', basis: 'local', airport: 'TPE' }).every((r) => r.to === 'TPE')).toBe(true);
  });
  test('grouping by airport puts the busiest first', () => {
    const g = byAirport(plan, { mode: 'dep', basis: 'local', order: 'busy' });
    expect(g[0].code).toBe('TPE');
    expect(g.reduce((s, x) => s + x.rows.length, 0)).toBe(8);
  });
  test('hourly bins add up to the departures and arrivals', () => {
    const h = hourly(plan, 'TPE');
    expect(h.dep.reduce((a, b) => a + b, 0)).toBe(4);
    expect(h.arr.reduce((a, b) => a + b, 0)).toBe(4);
  });
  test('stations report slot use and transfers', () => {
    const rows = stations(plan, result);
    expect(rows[0].code).toBe('TPE');
    expect(rows[0].departures).toBe(28);
  });
  test('flights that miss each other show up as connection gaps, and disappear when fixed', () => {
    const base = emptyPlan('TPE');
    const mk = (id: string, from: string, to: string, h: number) => ({ ...newAircraft(base, 'A20N'), id, reg: id, legs: [{ from, to, dep: utcFromLocal(from, h * 60) }] });
    const bad: Plan = { ...base, fleet: [mk('a', 'HKG', 'TPE', 8), mk('b', 'TPE', 'NRT', 19)] };
    expect(connectionGaps(bad, 'TPE').some((g) => g.from === 'HKG' && g.to === 'NRT')).toBe(true);
    const g = connectionGaps(bad, 'TPE').find((x) => x.from === 'HKG' && x.to === 'NRT')!;
    const fixed: Plan = { ...base, fleet: [mk('a', 'HKG', 'TPE', 8), mk('b', 'TPE', 'NRT', g.suggest / 60)] };
    expect(connectionGaps(fixed, 'TPE').some((x) => x.from === 'HKG' && x.to === 'NRT')).toBe(false);
  });
});

import { spreadAngles } from '../ui/airports';
describe('radial layout', () => {
  test('crowded bearings are pushed apart and the order is kept', () => {
    const out = spreadAngles([80, 82, 84, 270]);
    const sorted = [...out.slice(0, 3)].sort((a, b) => a - b);
    for (let i = 1; i < 3; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(25.9);
    expect(out[0]).toBeLessThan(out[1]);
    expect(out[1]).toBeLessThan(out[2]);
  });
});

import { dayMark, dayShiftBetween, zoneDiffHours } from './airports';
describe('arrival day markers', () => {
  test('a late flight east across a one hour zone lands the next day', () => {
    const dep = utcFromLocal('TPE', 23 * 60 + 30);
    expect(dayShiftBetween('TPE', 'NRT', dep, dep + 200)).toBe(1);
    expect(dayShiftBetween('TPE', 'NRT', utcFromLocal('TPE', 8 * 60), utcFromLocal('TPE', 8 * 60) + 200)).toBe(0);
  });
  test('the base clock view reads both ends on one clock', () => {
    const dep = utcFromLocal('TPE', 22 * 60 + 30);
    expect(dayShiftBetween('TPE', 'TPE', dep, dep + 200)).toBe(1);
    expect(dayShiftBetween('TPE', 'TPE', dep, dep + 60)).toBe(0);
  });
  test('zone difference and marks', () => {
    expect(zoneDiffHours('TPE', 'NRT')).toBe(1);
    expect(zoneDiffHours('NRT', 'TPE')).toBe(-1);
    expect(zoneDiffHours('TPE', 'HKG')).toBe(0);
    expect(dayMark(1)).toBe('+1');
    expect(dayMark(-1)).toBe('-1');
    expect(dayMark(0)).toBe('');
  });
});
