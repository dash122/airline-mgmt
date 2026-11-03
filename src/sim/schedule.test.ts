import { describe, expect, test } from 'vitest';
import { addRoundTrip, emptyPlan, localMinutes, rotationInfo, type Plan } from './simulate';
import {
  closeRoute, gapAt, insertWindow, leaseFor, moveUnit, placementOptions, removeOneRoundTrip, removeUnit, shiftUnit, shiftWindow, unitOf, units,
} from './schedule';

const must = (r: ReturnType<typeof addRoundTrip>) => {
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};
let plan: Plan = emptyPlan('TPE');
for (const to of ['HKG', 'NRT', 'KIX']) plan = must(addRoundTrip(plan, 'TPE', to, 'A20N'));
const ac = plan.fleet[0];

describe('schedule editing', () => {
  test('legs group into round trips', () => {
    expect(plan.fleet).toHaveLength(1);
    expect(units(ac)).toEqual([{ start: 0, count: 2 }, { start: 2, count: 2 }, { start: 4, count: 2 }]);
    expect(unitOf(ac, 3)).toEqual({ start: 2, count: 2 });
  });

  test('moving a middle round trip leaves the others alone and stays inside the gap', () => {
    const u = unitOf(ac, 2);
    const w = shiftWindow(ac, u);
    expect(w.min).toBe(0); // packed tight after the first trip
    expect(w.max).toBe(0); // and right before the third
    const freed = removeUnit(ac, unitOf(ac, 4));
    const w2 = shiftWindow(freed, unitOf(freed, 2));
    expect(w2.max).toBeGreaterThan(60);
    const moved = shiftUnit(freed, unitOf(freed, 2), 60);
    expect(moved.legs[0].dep).toBe(freed.legs[0].dep);
    expect(moved.legs[2].dep).toBe(freed.legs[2].dep + 60);
    expect(rotationInfo(moved).fits).toBe(true);
  });

  test('removing any round trip keeps the day closed', () => {
    const out = removeUnit(ac, unitOf(ac, 2));
    expect(out.legs.map((l) => l.to)).toEqual(['HKG', 'TPE', 'KIX', 'TPE']);
    expect(rotationInfo(out).closed).toBe(true);
  });

  test('placement options use free aircraft time before leasing', () => {
    const lighter = { ...plan, fleet: [removeUnit(ac, unitOf(ac, 4))] };
    const opts = placementOptions(lighter, 'TPE', 'FUK');
    expect(opts[0].placement).not.toBeNull();
    const p = opts[0].placement!;
    expect(p.from).toBe('TPE');
    expect(p.dep).toBeGreaterThanOrEqual(p.lo);
    expect(opts[0].utilAfter).toBeGreaterThan(opts[0].utilBefore);
    // A turboprop can't reach Tokyo from Taipei.
    const withAtr = leaseFor(lighter, 'TSA', 'MZG', 'ATR72').plan;
    const atr = placementOptions(withAtr, 'TPE', 'NRT').find((o) => o.ac.type === 'ATR72')!;
    expect(atr.placement).toBeNull();
  });

  test('gaps and windows', () => {
    const freed = removeUnit(ac, unitOf(ac, 2));
    expect(gapAt(freed, freed.legs[1].dep + 10)).toBe(2);
    expect(insertWindow(freed, 2, 'TPE', 'OKA')).not.toBeNull();
    expect(insertWindow(ac, 2, 'TPE', 'OKA')).toBeNull();
  });

  test('frequency down, close route and move between aircraft', () => {
    let p = must(addRoundTrip(plan, 'TPE', 'HKG', 'A20N'));
    const before = p.fleet.flatMap((a) => a.legs).length;
    p = removeOneRoundTrip(p, 'HKG-TPE', localMinutes)!;
    expect(p.fleet.flatMap((a) => a.legs).length).toBe(before - 2);
    const closed = closeRoute(plan, 'NRT-TPE');
    expect(closed.fleet[0].legs.some((l) => l.to === 'NRT')).toBe(false);
    const two = leaseFor(plan, 'TPE', 'OKA', 'A20N').plan;
    const target = placementOptions({ ...two, fleet: [two.fleet[1]] }, 'TPE', 'NRT')[0].placement!;
    const moved = moveUnit(two, ac.id, unitOf(ac, 2), target);
    expect(moved.fleet[0].legs).toHaveLength(4);
    expect(moved.fleet[1].legs).toHaveLength(4);
  });
});
