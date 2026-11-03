import { describe, expect, it } from 'vitest';
import { nearestLongitude, toScreen, worldCopies, zoomAt } from './projection';

describe('world wrapping', () => {
  it('keeps US airports east of Asia across the date line after repeated pans', () => {
    for (const center of [180, 540, -180, -540]) {
      const view = { cx: center, cy: 0, scale: 4 };
      const asia = nearestLongitude(140, center);
      const us = nearestLongitude(-120, center);
      expect(us - asia).toBe(100);
      expect(toScreen(view, 1000, 600, 35, us)[0]).toBe(740);
      expect(worldCopies(view, 1000)).toContain(us + 120);
    }
  });

  it('covers every visible world when zoomed out', () => {
    const view = { cx: 730, cy: 0, scale: 0.5 };
    const copies = worldCopies(view, 1200);
    for (let x = 0; x <= 1200; x += 10) {
      const lon = view.cx + (x - 600) / view.scale;
      expect(copies.some(offset => lon >= offset - 180 && lon <= offset + 180)).toBe(true);
    }
  });

  it('keeps the zoom anchor fixed beyond the original world', () => {
    const view = { cx: 230, cy: 20, scale: 4 };
    const lon = nearestLongitude(-120, view.cx);
    const [x, y] = toScreen(view, 1000, 600, 35, lon);
    expect(toScreen(zoomAt(view, 1000, 600, x, y, 2), 1000, 600, 35, lon)).toEqual([x, y]);
  });
});
