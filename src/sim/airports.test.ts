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

import { estimateVia, hubOpportunities, linkages, viaGroup, viewFromHub } from './airports';
import { AIRPORT_BY_CODE } from '../data/airports';
import { ANNUAL_TRAFFIC_M } from '../data/airport-traffic';
describe('connecting markets', () => {
  const base = emptyPlan('TPE');
  const mk = (id: string, from: string, to: string, h: number) => ({ ...newAircraft(base, 'A20N'), id, reg: id, legs: [{ from, to, dep: utcFromLocal(from, h * 60) }] });
  const find = (list: ReturnType<typeof linkages>, a: string, b: string) => list.find((l) => (l.o === a && l.d === b) || (l.o === b && l.d === a));

  test('a market through a hub that is far out of the way is explained, with nonstop as the way out', () => {
    const p: Plan = { ...emptyPlan('HKG'), hub: 'HKG', fleet: [mk('a', 'HKG', 'KIX', 8), mk('b', 'HKG', 'OKA', 8)] };
    const l = find(linkages(p, simulate(p), 'HKG', 50), 'KIX', 'OKA')!;
    expect(l.status).toBe('detour');
    expect(l.detourPct).toBeGreaterThan(1.5);
    expect(l.nonstopFlown).toBe(false);
    expect(l.demand).toBeGreaterThan(0);
  });
  test('Fukuoka to Taipei through Hong Kong is possible but long, and is shown as a market to link', () => {
    const p: Plan = { ...emptyPlan('HKG'), hub: 'HKG', fleet: [mk('a', 'FUK', 'HKG', 8), mk('b', 'HKG', 'TPE', 14)] };
    const l = find(linkages(p, simulate(p), 'HKG', 50), 'FUK', 'TPE')!;
    expect(l.status).not.toBe('detour');
    expect(l.detourPct).toBeGreaterThan(0.9);
  });
  test('a missing leg is named', () => {
    const p: Plan = { ...base, fleet: [mk('a', 'HKG', 'TPE', 8)] };
    const l = linkages(p, simulate(p), 'TPE', 50).find(l => l.status === 'leg')!;
    expect(l).toBeDefined();
    expect(l.missing).toHaveLength(1);
    expect(l.missing[0]).not.toBe('HKG');
    expect(AIRPORT_BY_CODE[l.missing[0]]).toBeDefined();
  });
  test('flights that only make a stopover get a suggested time, and taking it makes a quick connection', () => {
    const miss: Plan = { ...base, fleet: [mk('a', 'HKG', 'TPE', 8), mk('b', 'TPE', 'NRT', 19)] };
    const l = find(linkages(miss, simulate(miss), 'TPE', 50), 'HKG', 'NRT')!;
    expect(l.status).toBe('long');
    expect(l.viaPax).toBeGreaterThan(0); // the stopover still carries some
    expect(l.wait).toBeGreaterThan(8 * 60);
    expect(l.suggest).toBeDefined();
    const fixed: Plan = { ...base, fleet: [mk('a', 'HKG', 'TPE', 8), mk('b', 'TPE', 'NRT', l.suggest!.local / 60)] };
    const after = find(linkages(fixed, simulate(fixed), 'TPE', 50), 'HKG', 'NRT')!;
    expect(after.status).toBe('connected');
    expect(after.viaPax).toBeGreaterThan(0);
    expect(after.lost).toBeLessThan(after.demand);
  });
  test('when the quick fix would leave at night, an earlier flight in is suggested instead', () => {
    const late: Plan = { ...base, fleet: [mk('a', 'HKG', 'TPE', 21), mk('b', 'TPE', 'NRT', 11)] };
    const l = find(linkages(late, simulate(late), 'TPE', 50), 'HKG', 'NRT')!;
    expect(l.suggest).toBeDefined();
    expect(l.suggest!.from).toBe('HKG');
    expect(l.suggest!.to).toBe('TPE');
    expect(l.suggest!.before).toBe(11 * 60);
    expect(l.suggest!.local).toBeGreaterThanOrEqual(6 * 60);
  });
  test('slots were expanded', () => {
    expect(AIRPORT_BY_CODE.TPE.slotCap).toBeGreaterThanOrEqual(1000);
    expect(AIRPORT_BY_CODE.KNH.slotCap).toBeGreaterThanOrEqual(100);
  });
});

describe('transit potential from the hub', () => {
  const base = emptyPlan('TPE');
  const mk = (id: string, from: string, to: string, h: number) => ({ ...newAircraft(base, 'A20N'), id, reg: id, legs: [{ from, to, dep: utcFromLocal(from, h * 60) }] });
  test('new routes from the hub count the travellers who would connect onto routes already flown', () => {
    const p: Plan = { ...base, fleet: [mk('a', 'TPE', 'HKG', 8), mk('b', 'TPE', 'NRT', 8), mk('c', 'TPE', 'BKK', 8)] };
    const ideas = hubOpportunities(p, 'TPE');
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.every((i) => !['HKG', 'NRT', 'BKK'].includes(i.to))).toBe(true);
    expect(ideas.some((i) => i.via > 0 && i.markets.length > 0)).toBe(true);
    for (let k = 1; k < ideas.length; k++) expect(ideas[k - 1].local + ideas[k - 1].via).toBeGreaterThanOrEqual(ideas[k].local + ideas[k].via);
  });
  test('tapping another airport shows where its travellers could go through the hub, and what opening the leg unlocks', () => {
    const p: Plan = { ...base, fleet: [mk('a', 'TPE', 'HKG', 8), mk('b', 'TPE', 'NRT', 8)] };
    const v = viewFromHub(p, simulate(p), 'TPE', 'MNL');
    expect(v.legFlown).toBe(false);
    expect(v.local).toBeGreaterThan(0);
    expect(v.rows.length).toBeGreaterThan(0);
    expect(v.rows.every((r) => r.o === 'MNL' && r.missing.includes('MNL'))).toBe(true);
    expect(v.unlockCount).toBeGreaterThan(0);
    expect(v.unlock).toBeGreaterThan(0);
  });
  test('once the leg is flown, its connections show as carried', () => {
    const p: Plan = { ...base, fleet: [{ ...mk('a', 'MNL', 'TPE', 7), legs: [{ from: 'MNL', to: 'TPE', dep: utcFromLocal('MNL', 7 * 60) }] }, mk('b', 'TPE', 'NRT', 11)] };
    const v = viewFromHub(p, simulate(p), 'TPE', 'MNL');
    expect(v.legFlown).toBe(true);
    const nrt = v.rows.find((r) => r.d === 'NRT')!;
    expect(nrt).toBeDefined();
    expect(nrt.viaPax).toBeGreaterThan(0);
  });
  test('from any airport, every market through the hub is listed, on legs flown and not yet flown, biggest first', () => {
    const p: Plan = { ...emptyPlan('HKG'), hub: 'HKG', fleet: [mk('a', 'HKG', 'BKK', 8), mk('b', 'HKG', 'SIN', 8)] };
    const v = viewFromHub(p, simulate(p), 'HKG', 'TPE');
    expect(v.rows.length).toBeGreaterThan(50);
    expect(v.rows.some((r) => viaGroup(r) === 'flown' && r.d === 'BKK')).toBe(true);
    expect(v.rows.some((r) => viaGroup(r) === 'hubLeg' && r.d === 'LHR')).toBe(true);
    for (let k = 1; k < v.rows.length; k++) expect(Math.max(v.rows[k - 1].est, v.rows[k - 1].viaPax)).toBeGreaterThanOrEqual(Math.max(v.rows[k].est, v.rows[k].viaPax));
    expect(v.total).toBeGreaterThan(v.rows[0].est);
    // Small airports are not given a whole province's population.
    expect(v.rows[0].est).toBeLessThan(5000);
  });
  test('transit markets through the hub follow airport size, not holiday islands or tiny airports', () => {
    const v = viewFromHub(emptyPlan('HKG'), null, 'HKG', 'TPE');
    const top = v.rows.slice(0, 20).map((r) => r.d);
    expect(top).not.toContain('PMI');
    // Every top destination is a sizeable airport with real traffic data.
    for (const d of top) expect(ANNUAL_TRAFFIC_M[d] ?? 0).toBeGreaterThan(4);
    // Bangkok, with nonstops from Taipei and 60M passengers a year, draws more than Mallorca, which has neither.
    const est = (d: string) => v.rows.find((r) => r.d === d)?.est ?? 0;
    expect(est('BKK')).toBeGreaterThan(2 * est('PMI'));
    for (const code of ['NRT', 'ICN']) {
      const w = viewFromHub(emptyPlan('HKG'), null, 'HKG', code);
      for (const r of w.rows.slice(0, 15)) expect(ANNUAL_TRAFFIC_M[r.d] ?? 0).toBeGreaterThan(4);
    }
  });
  test('the estimate uses the same transit demand as the simulation', () => {
    const big = (id: string, legs: [string, string, number][]) => ({ ...newAircraft(base, 'B77W'), id, reg: id, legs: legs.map(([from, to, h]) => ({ from, to, dep: utcFromLocal(from, h * 60) })) });
    // TPE to Manila through Hong Kong with a 1 h 40 min connection each way, on big aircraft so no one is turned away.
    const p: Plan = { ...emptyPlan('HKG'), hub: 'HKG', fleet: [big('a', [['TPE', 'HKG', 8], ['HKG', 'MNL', 11.5]]), big('b', [['MNL', 'HKG', 8], ['HKG', 'TPE', 12]])] };
    const r = simulate(p);
    const sim = r.transfers.HKG.flows.filter((f) => (f.from === 'TPE' && f.to === 'MNL') || (f.from === 'MNL' && f.to === 'TPE')).reduce((s, f) => s + f.pax, 0);
    const est = estimateVia(p, 'TPE', 'HKG', 'MNL');
    expect(sim).toBeGreaterThan(0);
    expect(est / sim).toBeGreaterThan(0.5);
    expect(est / sim).toBeLessThan(2);
  });
});
