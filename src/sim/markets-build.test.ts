import { expect, test } from 'vitest';
import { marketBetween, markets, marketsReady, prepareMarkets } from './markets';

// The app builds the demand model in short slices while idle (prepareMarkets) so that no single tap waits for all of it.
test('the demand model builds in short slices, then answers at once', () => {
  expect(marketsReady()).toBe(false);
  let slices = 0;
  while (!prepareMarkets(0)) slices++;
  // Each slice stops at its first pause, so a phone never holds the screen for the whole build.
  expect(slices).toBeGreaterThan(100);
  expect(marketsReady()).toBe(true);
  expect(prepareMarkets(0)).toBe(true);
  expect(markets().size).toBeGreaterThan(500_000);
  expect(marketBetween('TPE', 'HKG')?.rivalFreq).toBeGreaterThan(0);
});
