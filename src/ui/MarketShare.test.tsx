import { describe, expect, test } from 'vitest';
import type { MarketSplit, ShareRow } from '../sim/share';
import { marketSummary } from './rivals';

const row = (kind: ShareRow['kind'], pax: number, total: number, freq = 0): ShareRow =>
  ({ kind, id: kind, freq, pax, share: pax / total, before: 0, airports: [] });

describe('market share summary', () => {
  test('never calls the player the biggest airline when it carries nobody', () => {
    const total = 10_649;
    const split: MarketSplit = { total, rows: [row('own', 0, total, 28), row('connecting', 4637, total)], ownTurnedAway: 6012, ownFreqShare: 1 };
    const text = marketSummary(split);
    expect(text).not.toContain('最大');
    expect(text).not.toContain('100%');
    expect(text).toContain('沒有載到');
    expect(text).toContain('6,012');
  });
  test('the only nonstop airline is described as such', () => {
    const total = 10_000;
    const text = marketSummary({ total, rows: [row('own', 2400, total, 28), row('connecting', 3000, total)], ownTurnedAway: 4600, ownFreqShare: 1 });
    expect(text).toContain('唯一直飛');
    expect(text).toContain('24%');
  });
});
