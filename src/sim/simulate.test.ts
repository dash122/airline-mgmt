import { describe, expect, test } from 'vitest';
import { AIRPORTS } from '../data/airports';
import { marketBetween, markets, modelledAnnualPax } from './markets';
import { AIR_TARGETS_M } from '../data/calibration';
import {
  addRoundTrip, emptyPlan, newAircraft, rotationInfo, routeProblem, simulate, utcFromLocal, withLeg, type Plan,
} from './simulate';

const must = (r: ReturnType<typeof addRoundTrip>) => {
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};
const trips = (p: Plan, a: string, b: string, n: number, type?: Parameters<typeof addRoundTrip>[3]) => {
  for (let i = 0; i < n; i++) p = must(addRoundTrip(p, a, b, type));
  return p;
};
const plan = trips(trips(emptyPlan('TPE'), 'TPE', 'HKG', 3), 'TSA', 'MZG', 4, 'ATR72');

describe('markets', () => {
  test('modelled air travel matches each group target', () => {
    const totals: Record<string, number> = {};
    for (const m of markets().values()) totals[m.group] = (totals[m.group] ?? 0) + (m.airDemand * 104) / 1e6;
    for (const g of ['JP-JP', 'TW-TW', 'JP-TW', 'HK-TW', 'HK-JP']) {
      expect(totals[g] / AIR_TARGETS_M[g]).toBeGreaterThan(0.9);
      expect(totals[g] / AIR_TARGETS_M[g]).toBeLessThan(1.1);
    }
  });
  test('every airport has people and coordinates', () => {
    expect(AIRPORTS.length).toBeGreaterThan(90);
    for (const a of AIRPORTS) {
      expect(a.catchment).toBeGreaterThan(0);
      expect(Number.isFinite(a.lat) && Number.isFinite(a.lon)).toBe(true);
    }
  });
  test('no markets inside one metro', () => {
    expect(marketBetween('HND', 'NRT')).toBeUndefined();
    expect(marketBetween('TPE', 'TSA')).toBeUndefined();
  });
  test('big metros fly more than small towns', () => {
    expect(modelledAnnualPax('HND')).toBeGreaterThan(modelledAnnualPax('KUH') * 20);
  });
  test('ground travel: rail on one landmass, ferry to near islands, nothing to far islands', () => {
    expect(marketBetween('HND', 'ITM')!.ground?.name).toContain('高鐵');
    expect(marketBetween('KHH', 'MZG')!.ground?.name).toContain('渡輪');
    expect(marketBetween('TSA', 'KNH')!.ground).toBeUndefined();
  });
});

describe('simulate', () => {
  test('is deterministic', () => {
    expect(simulate(plan)).toEqual(simulate(plan));
  });
  test('never carries more than seats', () => {
    for (const r of Object.values(simulate(plan).routes)) expect(r.pax).toBeLessThanOrEqual(r.seats + 1e-6);
  });
  test('more flights carry more travellers', () => {
    const one = simulate(trips(emptyPlan('TPE'), 'TPE', 'HKG', 1, 'B77W')).pax;
    const three = simulate(trips(emptyPlan('TPE'), 'TPE', 'HKG', 3, 'B77W')).pax;
    expect(three).toBeGreaterThan(one);
  });
  test('cheaper fares win more travellers', () => {
    const p = trips(emptyPlan('TPE'), 'TPE', 'OKA', 1, 'B77W');
    const cheap = simulate({ ...p, fares: { 'OKA-TPE': 0.8 } }).pax;
    const dear = simulate({ ...p, fares: { 'OKA-TPE': 1.2 } }).pax;
    expect(cheap).toBeGreaterThan(dear);
  });
  test('a morning departure sells better than one at 3am', () => {
    const at = (localMin: number) => {
      const ac = newAircraft(emptyPlan('TPE'), 'B77W');
      return simulate({ ...emptyPlan('TPE'), fleet: [{ ...ac, legs: [{ from: 'TPE', to: 'HKG', dep: utcFromLocal('TPE', localMin) }] }] }).pax;
    };
    expect(at(8 * 60)).toBeGreaterThan(at(3 * 60));
  });
  test('well-timed flights at a hub carry connecting travellers', () => {
    const base = emptyPlan('TPE');
    const a1 = newAircraft(base, 'A20N');
    const a2 = { ...newAircraft(base, 'A20N'), id: 'second' };
    const hkgTpe = { from: 'HKG', to: 'TPE', dep: utcFromLocal('HKG', 8 * 60) };
    const timed = { ...base, fleet: [{ ...a1, legs: [hkgTpe] }, { ...a2, legs: [{ from: 'TPE', to: 'NRT', dep: utcFromLocal('TPE', 11 * 60) }] }] };
    const untimed = { ...base, fleet: [{ ...a1, legs: [hkgTpe] }, { ...a2, legs: [{ from: 'TPE', to: 'NRT', dep: utcFromLocal('TPE', 19 * 60) }] }] };
    expect(simulate(timed).connectingPax).toBeGreaterThan(0);
    expect(simulate(untimed).connectingPax).toBe(0);
  });
  test('an idle aircraft still costs its lease', () => {
    const idle = { ...emptyPlan('TPE'), fleet: [newAircraft(emptyPlan('TPE'), 'A20N')] };
    const r = simulate(idle);
    expect(r.revenue).toBe(0);
    expect(r.ownershipCost).toBeGreaterThan(0);
    expect(r.avgUtilisation).toBe(0);
  });
});

describe('fleet and rotations', () => {
  test('round trips share an aircraft until its day is full, then lease another', () => {
    const p = trips(emptyPlan('TPE'), 'TPE', 'HKG', 6);
    expect(p.fleet.length).toBeGreaterThan(1);
    for (const ac of p.fleet) {
      const info = rotationInfo(ac);
      expect(info.fits).toBe(true);
      expect(info.closed).toBe(true);
    }
    expect(rotationInfo(p.fleet[0]).utilisation).toBeGreaterThan(0.4);
  });
  test('an aircraft that does not return home is flagged', () => {
    const ac = withLeg(newAircraft(emptyPlan('TPE'), 'A20N'), 'TPE', 'HKG');
    expect(rotationInfo(ac).closed).toBe(false);
  });
});

describe('route rules', () => {
  test('runway and range limits', () => {
    expect(routeProblem('TSA', 'LZN', 'A20N')).not.toBeNull();
    expect(routeProblem('TSA', 'LZN', 'ATR72')).toBeNull();
    expect(routeProblem('TPE', 'CTS', 'ATR72')).not.toBeNull();
    expect(routeProblem('HND', 'NRT', 'A20N')).not.toBeNull();
    expect(routeProblem('TTT', 'KYD', 'A20N')).not.toBeNull();
  });
});

describe('economics', () => {
  const build = (base: string, to: string, type: 'A20N' | 'B77W', trips: number) => {
    let p = emptyPlan(base);
    for (let i = 0; i < trips; i++) { const r = addRoundTrip(p, base, to, type); if ('error' in r) throw new Error(r.error); p = r.plan; }
    return simulate(p);
  };
  test('a well-matched narrowbody on a busy route can break even at the reference fare', () => {
    expect(build('TPE', 'HKG', 'A20N', 3).costRecovery).toBeGreaterThan(1);
  });
  test('a 777-300ER on a short domestic route loses money', () => {
    expect(build('TPE', 'KHH', 'B77W', 3).costRecovery).toBeLessThan(1);
  });
});
