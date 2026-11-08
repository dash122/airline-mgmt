import { describe, expect, test } from 'vitest';
import { hk, hkSigned, hkd, money, price, TWD_PER_HKD } from './format';

// The simulation books NT$; everything the player reads is Hong Kong dollars.
describe('currency display', () => {
  test('converts NT$ to HK$ once, in one place', () => {
    expect(hkd(8_020)).toBe(8_020 / TWD_PER_HKD);
    expect(price(8_020)).toBe('HK$2,005');
  });

  test('money() is the converted amount, short and bare', () => {
    expect(money(4 * 7_370_000)).toBe('737 萬');
    expect(money(4 * 123_000_000)).toBe('1.23 億');
    expect(money(4 * 500)).toBe('500');
    expect(money(0)).toBe('0');
    expect(money(-4 * 1_200_000)).toBe('-120 萬');
  });

  test('headline figures name the currency, with the sign in front of it', () => {
    expect(hk(4 * 7_370_000)).toBe('HK$737 萬');
    expect(hk(-4 * 120_000)).toBe('-HK$12 萬');
    expect(hkSigned(4 * 3_160_000)).toBe('+HK$316 萬');
    expect(hkSigned(-4 * 3_160_000)).toBe('-HK$316 萬');
  });
});
