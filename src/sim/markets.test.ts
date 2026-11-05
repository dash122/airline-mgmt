import { expect, test } from 'vitest';
import { AIRPORT_BY_CODE, airportMarkerRadius } from '../data/airports';
import { ANNUAL_TRAFFIC_M } from '../data/airport-traffic';
import { marketBetween, marketsAt, modelledAnnualPax, rivalPaxPerFlight } from './markets';

test('global hubs have substantial transatlantic and transpacific demand', () => {
  for (const [a, b] of [['JFK', 'LHR'], ['LAX', 'NRT'], ['LAX', 'LHR'], ['JFK', 'CDG']]) {
    const m = marketBetween(a, b)!;
    expect(m.airDemand, `${a}-${b}`).toBeGreaterThan(1000);
    expect(m.rivalFreq).toBeGreaterThan(0);
  }
  for (const code of ['JFK', 'LAX', 'LHR', 'DXB']) {
    expect(modelledAnnualPax(code)).toBeGreaterThan(40e6);
    expect(modelledAnnualPax(code)).toBeLessThan(120e6);
  }
});

test('traffic determines marker hierarchy and shared metros never create demand', () => {
  expect(airportMarkerRadius(AIRPORT_BY_CODE.LAX)).toBeGreaterThan(airportMarkerRadius(AIRPORT_BY_CODE.JFK));
  expect(airportMarkerRadius(AIRPORT_BY_CODE.JFK)).toBeGreaterThan(airportMarkerRadius(AIRPORT_BY_CODE.KUH));
  expect(marketBetween('JFK', 'EWR')).toBeUndefined();
  expect(marketBetween('JFK', 'LGA')).toBeUndefined();
  expect(marketsAt('LAX').every(m => Number.isFinite(m.potential) && m.potential >= m.airDemand)).toBe(true);
});

test('modelled passengers match real traffic at the busiest airports outside the hand-calibrated regions', () => {
  // Real traffic counts travellers changing planes too; the model adds them back from each hub's transfer share.
  let n = 0, close = 0;
  for (const [code, millions] of Object.entries(ANNUAL_TRAFFIC_M)) {
    if (!AIRPORT_BY_CODE[code] || millions < 10 || ['JP', 'TW', 'HK', 'MO'].includes(AIRPORT_BY_CODE[code].country)) continue;
    n++;
    const ratio = modelledAnnualPax(code) / 1e6 / millions;
    if (ratio > 0.85 && ratio < 1.15) close++;
    expect(ratio, code).toBeGreaterThan(0.45);
    expect(ratio, code).toBeLessThan(1.35);
  }
  expect(n).toBeGreaterThan(100);
  expect(close / n).toBeGreaterThan(0.9);
});

test('international traffic follows real international figures, not total passengers', () => {
  // Shenzhen and Guangzhou handle more passengers than Hong Kong, but Hong Kong carries far more international ones.
  const intl = (code: string) => marketsAt(code).filter((m) => AIRPORT_BY_CODE[m.a].country !== AIRPORT_BY_CODE[m.b].country)
    .reduce((s, m) => s + 104 * m.airDemand, 0) / 1e6;
  expect(intl('HKG')).toBeGreaterThan(3 * intl('CAN'));
  expect(intl('HKG')).toBeGreaterThan(6 * intl('SZX'));
  expect(intl('SZX')).toBeLessThan(8);
  // Big international gateways carry their own travellers on long-haul routes; Guangzhou far fewer.
  const longHaul = (code: string) => marketsAt(code).filter((m) => m.distKm > 4500).reduce((s, m) => s + 104 * m.airDemand, 0) / 1e6;
  expect(longHaul('HKG')).toBeGreaterThan(5 * longHaul('CAN'));
  expect(longHaul('HKG') / intl('HKG')).toBeGreaterThan(0.15);
});

test('Hong Kong-London is one of the big long-haul markets', () => {
  const lhr = marketBetween('HKG', 'LHR')!;
  // About 1.4 million travellers a year flying between the two cities, plus transfers on the same flights.
  expect(lhr.airDemand).toBeGreaterThan(5000);
  expect(lhr.airDemand).toBeLessThan(12000);
  expect(lhr.rivalFreq).toBeGreaterThanOrEqual(35);
  expect(lhr.rivalFreq).toBeLessThanOrEqual(80);
  expect(lhr.airDemand).toBeGreaterThan(3 * marketBetween('CAN', 'LHR')!.airDemand);
});

test('airport populations are real metro populations shared between the airports of a metro', () => {
  const metro = (codes: string[]) => codes.reduce((s, c) => s + AIRPORT_BY_CODE[c].catchment, 0) / 1e6;
  expect(metro(['JFK', 'LGA', 'EWR'])).toBeGreaterThan(15);
  expect(metro(['JFK', 'LGA', 'EWR'])).toBeLessThan(26);
  expect(metro(['LHR', 'LGW', 'STN', 'LTN'])).toBeGreaterThan(11);
  expect(metro(['CDG', 'ORY'])).toBeGreaterThan(8);
  expect(AIRPORT_BY_CODE.JFK.catchment).toBeGreaterThan(AIRPORT_BY_CODE.LGA.catchment);
  expect(AIRPORT_BY_CODE.SIN.catchment).toBeLessThan(12e6);
});

test('competitor frequencies are in the range of real timetables', () => {
  // Weekly flights per direction, all airlines, roughly as flown about 2024 (with room either side).
  const ranges: [string, string, number, number][] = [
    ['HKG', 'TPE', 60, 120], // about 12-15 a day
    ['HKG', 'NRT', 25, 70],
    ['HKG', 'BKK', 35, 90],
    ['HND', 'CTS', 100, 220],
    ['SIN', 'KUL', 150, 350],
  ];
  for (const [a, b, lo, hi] of ranges) {
    const f = marketBetween(a, b)!.rivalFreq;
    expect(f, `${a}-${b}`).toBeGreaterThanOrEqual(lo);
    expect(f, `${a}-${b}`).toBeLessThanOrEqual(hi);
  }
});

test('nobody flies where fast rail takes under about two and a half hours', () => {
  for (const [a, b] of [['HKG', 'CAN'], ['TPE', 'KHH'], ['HND', 'NGO']]) {
    const m = marketBetween(a, b)!;
    expect(m.potential, `${a}-${b}`).toBeGreaterThan(0);
    expect(m.rivalFreq, `${a}-${b}`).toBe(0);
  }
  // Tokyo-Osaka is about three hours by Shinkansen and still busy by air.
  expect(marketBetween('HND', 'ITM')!.rivalFreq).toBeGreaterThan(50);
});

test('busier routes get bigger aircraft as well as more flights', () => {
  expect(rivalPaxPerFlight(500, 800)).toBeLessThan(rivalPaxPerFlight(5000, 800));
  expect(rivalPaxPerFlight(5000, 800)).toBeLessThan(rivalPaxPerFlight(50000, 800));
  expect(rivalPaxPerFlight(1e6, 800)).toBeLessThanOrEqual(300);
  expect(rivalPaxPerFlight(1e6, 800, 60)).toBe(60);
  expect(rivalPaxPerFlight(500, 9000)).toBeGreaterThanOrEqual(230);
});

test("a city's long-haul travellers go to its main long-haul airport, not its low-cost ones", () => {
  for (const o of ['CAN', 'HKG', 'TPE', 'NRT']) {
    const lhr = marketBetween(o, 'LHR')!.potential;
    expect(marketBetween(o, 'STN')!.potential, `${o}-STN`).toBeLessThan(0.2 * lhr);
    expect(marketBetween(o, 'LTN')!.potential, `${o}-LTN`).toBeLessThan(0.1 * lhr);
    expect(marketBetween(o, 'LGW')!.potential, `${o}-LGW`).toBeLessThan(0.5 * lhr);
  }
  // A 33-million holiday airport draws far fewer travellers from Asia than a 60-million hub.
  expect(marketBetween('TPE', 'PMI')!.potential).toBeLessThan(0.5 * marketBetween('TPE', 'FRA')!.potential);
});
