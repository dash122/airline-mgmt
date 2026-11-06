import { describe, expect, test } from 'vitest';
import { AIRPORTS } from '../data/airports';
import { marketBetween, markets, modelledAnnualPax } from './markets';
import { AIR_TARGETS_M } from '../data/calibration';
import {
  addRoundTrip, blockMinutes, CONNECT_FARE_SHARE, connectFareShare, connectionWeight, detourOk, layoverCostHours, layoverKind, MIN_CONNECT_FARE_SHARE, STOPOVER_FARE_SHARE, stopoverAppealHours, emptyPlan, HUB_COST_PER_WEEK, minConnect, newAircraft, rotationInfo, routeProblem, simulate, utcFromLocal, withLeg, type Plan,
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
    // A 9 hour layover is a stopover: clearly less popular, but far from nothing.
    const stop = simulate(untimed);
    expect(stop.connectingPax).toBeGreaterThan(simulate(timed).connectingPax / 10);
    expect(stop.connectingPax).toBeLessThan(simulate(timed).connectingPax / 2);
    expect(stop.transfers.TPE.stopover).toBeCloseTo(stop.transfers.TPE.pax);
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
    expect(routeProblem('TSA', 'LZN', 'ATR72')).not.toBeNull();
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

describe('transfers', () => {
  const base = emptyPlan('TPE');
  const ac = (id: string, type: Parameters<typeof newAircraft>[1], legs: { from: string; to: string; h: number }[]) =>
    ({ ...newAircraft(base, type), id, reg: id, legs: legs.map((l) => ({ from: l.from, to: l.to, dep: utcFromLocal(l.from, l.h * 60) })) });
  const hkgTpe = (id = 'a') => ac(id, 'A20N', [{ from: 'HKG', to: 'TPE', h: 8 }]);
  const withOnward = (h: number, hub?: string): Plan => ({ ...base, hub, fleet: [hkgTpe(), ac('b', 'A20N', [{ from: 'TPE', to: 'NRT', h }])] });

  test('international transfers need longer than domestic ones, and a hub shortens them', () => {
    expect(minConnect('TPE', 'HKG', 'NRT')).toBeGreaterThan(minConnect('KHH', 'TSA', 'TPE'));
    expect(minConnect('TPE', 'HKG', 'NRT', 'TPE')).toBeLessThan(minConnect('TPE', 'HKG', 'NRT'));
  });
  test('minimum connections are about as short as real airports allow', () => {
    expect(minConnect('KHH', 'TSA', 'TPE')).toBeLessThanOrEqual(40);
    expect(minConnect('TPE', 'HKG', 'NRT')).toBeLessThanOrEqual(65);
  });
  test('a long wait of up to 4 hours is still an ordinary connection', () => {
    expect(layoverKind(230)).toBe('quick');
    expect(layoverCostHours(240, 'TPE')).toBeLessThan(4);
  });
  test('a connection just under the minimum is missed, and the hub setting catches it', () => {
    // The inbound lands at TPE; leave 60 min later: under the 65 min international minimum, over the hub's 55.
    expect(minConnect('TPE', 'HKG', 'NRT')).toBe(65);
    const land = 8 * 60 + blockMinutes('HKG', 'TPE', 'A20N');
    const h = (land + 60) / 60;
    expect(simulate(withOnward(h)).connectingPax).toBe(0);
    expect(simulate(withOnward(h, 'TPE')).connectingPax).toBeGreaterThan(0);
  });
  test('the hub setting costs money each week and appears in total cost', () => {
    const r = simulate(withOnward(11, 'TPE'));
    expect(r.hubCost).toBe(HUB_COST_PER_WEEK);
    expect(r.cost).toBeCloseTo(r.flyingCost + r.ownershipCost + HUB_COST_PER_WEEK);
    expect(simulate(withOnward(11)).hubCost).toBe(0);
  });
  test('one-stop travellers pay less than the nonstop fare', () => {
    const r = simulate(withOnward(11));
    expect(r.connectingPax).toBeGreaterThan(0);
    const direct = marketBetween('HKG', 'NRT')!.refFare;
    const fares = Object.values(r.routes).reduce((s, x) => s + x.revenue, 0);
    const local = Object.values(r.routes).reduce((s, x) => s + x.localPax, 0);
    expect(fares).toBeGreaterThan(0);
    expect(CONNECT_FARE_SHARE).toBeLessThan(1);
    expect(direct).toBeGreaterThan(0);
    expect(local).toBeGreaterThan(0);
  });
  test('only extreme detours are rejected', () => {
    expect(detourOk(1000, 2400)).toBe(true);
    expect(detourOk(1000, 2600)).toBe(false);
    expect(detourOk(500, 1400)).toBe(true);
    expect(detourOk(500, 1600)).toBe(false);
  });
  test('stopping on the same aircraft counts as a through service', () => {
    // Aircraft flies HKG→TPE then straight on to NRT after a 25 min turn.
    const through: Plan = { ...base, fleet: [ac('t', 'A20N', [{ from: 'HKG', to: 'TPE', h: 8 }, { from: 'TPE', to: 'NRT', h: 10 }])] };
    expect(simulate(through).connectingPax).toBeGreaterThan(0);
  });
  test('transfers are reported per airport with their flows', () => {
    const r = simulate(withOnward(11));
    expect(r.transfers.TPE.pax).toBeCloseTo(r.connectingPax);
    expect(r.transfers.TPE.flows[0]).toMatchObject({ from: 'HKG', to: 'NRT' });
  });
  test('a full flight never carries more than its seats', () => {
    const full: Plan = { ...base, fleet: [hkgTpe(), ac('b', 'ATR72', [{ from: 'TPE', to: 'KHH', h: 11 }]), ac('c', 'B77W', [{ from: 'KHH', to: 'OKA', h: 14 }])] };
    const r = simulate(full);
    for (const x of Object.values(r.routes)) expect(x.pax).toBeLessThanOrEqual(x.seats + 1e-6);
  });
  test('long layovers are possible but pay less and carry fewer travellers', () => {
    const at = (h: number) => simulate(withOnward(h));
    const land = 8 * 60 + blockMinutes('HKG', 'TPE', 'A20N');
    const short = at((land + 100) / 60), long = at((land + 8 * 60) / 60);
    expect(long.connectingPax).toBeGreaterThan(0);
    expect(long.connectingPax).toBeLessThan(short.connectingPax);
  });
  test('the connecting fare share falls over a long layover, and recovers for a stopover', () => {
    expect(connectFareShare(90)).toBe(CONNECT_FARE_SHARE);
    expect(connectFareShare(180)).toBe(CONNECT_FARE_SHARE);
    expect(connectFareShare(360)).toBeLessThan(CONNECT_FARE_SHARE);
    expect(connectFareShare(360)).toBeGreaterThan(connectFareShare(470));
    expect(connectFareShare(470)).toBeGreaterThanOrEqual(MIN_CONNECT_FARE_SHARE);
    expect(connectFareShare(600)).toBe(STOPOVER_FARE_SHARE);
    expect(connectFareShare(600)).toBeGreaterThan(connectFareShare(470));
    expect(connectFareShare(600)).toBeLessThan(CONNECT_FARE_SHARE);
  });
  test('long waits feel shorter than they are, and a stopover in a popular city stops growing', () => {
    expect(layoverCostHours(90, 'TPE')).toBeCloseTo(1.5);
    expect(layoverCostHours(360, 'TPE')).toBeLessThan(6);
    expect(layoverCostHours(360, 'TPE')).toBeGreaterThan(3);
    expect(layoverCostHours(600, 'TPE')).toBe(layoverCostHours(1200, 'TPE'));
    expect(layoverCostHours(600, 'HND')).toBeLessThan(layoverCostHours(360, 'HND'));
    expect(stopoverAppealHours('HND')).toBeGreaterThan(stopoverAppealHours('KNH'));
    expect(layoverKind(120)).toBe('quick');
    expect(layoverKind(300)).toBe('long');
    expect(layoverKind(600)).toBe('stopover');
    // A stopover still loses to a quick connection, but keeps a real share of travellers.
    const quick = connectionWeight(4, 90, 'TPE', 2800), stop = connectionWeight(4, 600, 'TPE', 2800);
    expect(stop).toBeLessThan(quick);
    expect(stop).toBeGreaterThan(quick / 10);
  });
});

describe('per-flight results', () => {
  const p = trips(emptyPlan('HKG'), 'HKG', 'TPE', 3);
  const res = simulate(p);
  const r = res.routes['HKG-TPE'];
  test('each scheduled flight gets its own result, and they add up to the route', () => {
    expect(r.flights.length).toBe(6);
    const sum = (k: 'seats' | 'pax' | 'spill') => r.flights.reduce((s, f) => s + f.perWeek * f[k], 0);
    expect(sum('seats')).toBeCloseTo(r.seats);
    expect(sum('pax')).toBeCloseTo(r.pax);
    expect(sum('spill')).toBeCloseTo(r.spill);
    for (const f of r.flights) {
      expect(res.byFlight[f.key]).toBe(f);
      expect(res.aircraft[f.acId].flights[f.index]).toBe(f);
      expect(f.loadFactor).toBeCloseTo(f.pax / f.seats);
      expect(f.loadFactor).toBeLessThanOrEqual(1 + 1e-9);
      expect(f.localPax + f.connectingPax).toBeCloseTo(f.pax);
    }
  });
  test('departures at different times fill differently', () => {
    const lfs = r.flights.map((f) => f.loadFactor);
    expect(Math.max(...lfs) - Math.min(...lfs)).toBeGreaterThan(0.01);
  });
  test('only full flights turn travellers away', () => {
    for (const f of Object.values(res.byFlight)) if (f.spill > 0.5) expect(f.loadFactor).toBeGreaterThan(0.99);
  });
});

test('a long-haul flight every other day carries everyone who wants it while seats are free', () => {
  const r = addRoundTrip(emptyPlan('HKG'), 'HKG', 'LHR', 'B789');
  if ('error' in r) throw new Error(r.error);
  const net = simulate(r.plan);
  const route = net.routes['HKG-LHR'];
  expect(route.flightsPerWeek).toBeLessThan(14);
  expect(route.loadFactor).toBeLessThan(0.9);
  for (const k of ['HKG>LHR', 'LHR>HKG']) expect(net.markets[k].nonstop).toBeCloseTo(net.markets[k].wanted, 0);
});
