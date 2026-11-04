import { describe, expect, test } from 'vitest';
import { blockMinutes } from './simulate';
import { eastwardShare } from './flighttime';

const hm = (from: string, to: string, type: Parameters<typeof blockMinutes>[2]) => blockMinutes(from, to, type) / 60;

describe('flight times', () => {
  test('short and medium flights match real timetables', () => {
    expect(hm('TPE', 'HKG', 'A20N')).toBeGreaterThanOrEqual(1.5);
    expect(hm('TPE', 'HKG', 'A20N')).toBeLessThanOrEqual(2);
    expect(hm('HND', 'CTS', 'A20N')).toBeGreaterThanOrEqual(1.5);
    expect(hm('HND', 'CTS', 'A20N')).toBeLessThanOrEqual(1.85);
    expect(hm('TPE', 'NRT', 'A20N')).toBeGreaterThanOrEqual(2.9);
    expect(hm('TPE', 'NRT', 'A20N')).toBeLessThanOrEqual(3.5);
  });
  test('long-haul flights match real timetables, and the jet stream makes eastbound faster', () => {
    expect(hm('HKG', 'LHR', 'B789')).toBeGreaterThanOrEqual(12);
    expect(hm('HKG', 'LHR', 'B789')).toBeLessThanOrEqual(13.5);
    expect(hm('LHR', 'HKG', 'B789')).toBeGreaterThanOrEqual(10.5);
    expect(hm('LHR', 'HKG', 'B789')).toBeLessThanOrEqual(12);
    expect(hm('LAX', 'TPE', 'B789')).toBeGreaterThan(hm('TPE', 'LAX', 'B789') + 1);
    expect(hm('NRT', 'TPE', 'A20N')).toBeGreaterThan(hm('TPE', 'NRT', 'A20N'));
  });
  test('the eastward share is +1 due east and -1 due west', () => {
    const a = { lat: 0, lon: 0 }, b = { lat: 0, lon: 20 };
    expect(eastwardShare(a, b)).toBeCloseTo(1, 2);
    expect(eastwardShare(b, a)).toBeCloseTo(-1, 2);
  });
});
