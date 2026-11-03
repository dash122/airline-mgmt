import { describe, expect, test } from 'vitest';
import { AIRPORTS, AIRPORT_BY_CODE, BASES } from './airports';
import { localMinutes, utcFromLocal, utcOffsetMin } from '../sim/simulate';
import { projY, zoomAt } from '../ui/projection';

describe('global jet airport coverage', () => {
  test('has worldwide coverage and excludes turboprop-only airports', () => {
    expect(AIRPORTS.length).toBeGreaterThan(1000);
    expect(new Set(AIRPORTS.map(a => a.country)).size).toBeGreaterThan(150);
    expect(new Set(AIRPORTS.map(a => a.code)).size).toBe(AIRPORTS.length);
    for (const a of AIRPORTS) {
      expect(a.maxClass).not.toBe('turboprop');
      expect(a.runwayM).toBeGreaterThanOrEqual(1615);
      expect(Number.isFinite(a.utcOffset)).toBe(true);
    }
    for (const code of ['LHR','JFK','LAX','GRU','JNB','SYD','SIN','DXB']) expect(AIRPORT_BY_CODE[code]).toBeDefined();
    for (const code of ['LZN','MFK','KYD']) expect(AIRPORT_BY_CODE[code]).toBeUndefined();
    for (const code of BASES) expect(AIRPORT_BY_CODE[code]).toBeDefined();
  });
  test('global local clocks support negative and fractional offsets', () => {
    expect(utcOffsetMin(AIRPORT_BY_CODE.JFK)).toBe(-300);
    expect(utcOffsetMin(AIRPORT_BY_CODE.DEL)).toBe(330);
    for (const code of ['JFK','DEL','SYD','LHR']) expect(localMinutes(code, utcFromLocal(code, 420))).toBe(420);
  });
  test('global projection remains finite at the poles and zooms out to world scale', () => {
    expect(Number.isFinite(projY(90))).toBe(true);
    expect(Number.isFinite(projY(-90))).toBe(true);
    expect(zoomAt({cx:0,cy:0,scale:4}, 400, 700, 200, 350, 0.1).scale).toBeLessThan(1);
  });
});
