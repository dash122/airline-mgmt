import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../data/airports';
import { leaseFor } from './schedule';
import { emptyPlan, localMinutes, simulate } from './simulate';
import { applyChoice, destination, destinationsFrom, inBand, previewChoice, routeChoices, searchAirports } from './newroute';

describe('searchAirports', () => {
  it('finds airports by code, name and country', () => {
    expect(searchAirports('nrt')[0].code).toBe('NRT');
    const osaka = searchAirports('大阪').map((a) => a.code);
    expect(osaka).toContain('KIX');
    expect(osaka).toContain('ITM');
    expect(searchAirports('泰國').every((a) => a.country === 'TH')).toBe(true);
    expect(searchAirports('  ')).toEqual([]);
  });
});

describe('destinationsFrom', () => {
  const plan = emptyPlan('TPE');
  const list = destinationsFrom(plan, 'TPE');
  it('lists flyable places, most travellers first, without same-city airports', () => {
    expect(list.length).toBeGreaterThan(100);
    expect(list.some((d) => d.code === 'TSA')).toBe(false);
    const ok = list.filter((d) => !d.problem);
    for (let i = 1; i < ok.length; i++) expect(ok[i - 1].est).toBeGreaterThanOrEqual(ok[i].est);
    expect(list.findIndex((d) => d.problem)).toBeGreaterThanOrEqual(ok.length);
  });
  it('filters by distance band', () => {
    expect(list.filter((d) => inBand(d, 'long')).every((d) => d.distKm >= 5000)).toBe(true);
    expect(list.filter((d) => inBand(d, 'short')).every((d) => d.distKm < 2000)).toBe(true);
  });
  it('explains why a searched airport cannot be a route', () => {
    expect(destination(plan, 'TPE', 'TSA').problem).toBeTruthy();
  });
});

describe('routeChoices', () => {
  it('puts a free aircraft on a time that sells, not before dawn', () => {
    const plan = leaseFor(emptyPlan('TPE'), 'TPE', 'ITM', 'B738').plan;
    const fleet = routeChoices(plan, 'TPE', 'YIW').find((c) => c.kind === 'fleet')!;
    expect(fleet).toBeDefined();
    const h = localMinutes(fleet.placement!.from, fleet.placement!.dep) / 60;
    expect(h).toBeGreaterThanOrEqual(6);
  });
  it('offers every type that can fly the route as a lease', () => {
    const lease = routeChoices(emptyPlan('TPE'), 'TPE', 'LHR').filter((c) => c.kind === 'lease');
    expect(lease.length).toBeGreaterThan(0);
    expect(lease.every((c) => AIRPORT_BY_CODE.LHR && c.type !== 'ATR72')).toBe(true);
  });
  it('previews the change in network profit that confirming would give', () => {
    const plan = emptyPlan('TPE');
    const c = routeChoices(plan, 'TPE', 'HKG').find((x) => x.kind === 'lease')!;
    const dep = -8 * 60 + 7 * 60;
    const p = previewChoice(plan, null, c, 'TPE', 'HKG', dep);
    const after = simulate(applyChoice(plan, c, 'TPE', 'HKG', dep).plan);
    expect(p.networkDelta).toBeCloseTo(after.revenue - after.cost, 0);
    expect(p.pax).toBeGreaterThan(0);
  });
});
