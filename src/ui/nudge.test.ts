import { describe, expect, it } from 'vitest';
import { addRoundTrip, emptyPlan, newAircraft } from '../sim/simulate';
import { pickNudge } from './nudge';

describe('pickNudge', () => {
  const fresh = { guideDone: false, dismissed: [] };
  it('walks a new player through route → first day → report', () => {
    const empty = emptyPlan('TPE');
    expect(pickNudge(empty, null, [], fresh)?.run.kind).toBe('new');
    const r = addRoundTrip(empty, 'TPE', 'HKG');
    if ('error' in r) throw new Error(r.error);
    expect(pickNudge(r.plan, null, [], fresh)?.run.kind).toBe('skip');
    expect(pickNudge(r.plan, null, [{ day: 1, revenue: 10, cost: 5, pax: 1 }], fresh)?.run.kind).toBe('report');
  });
  it('after the guide, points at an idle aircraft once, and stays quiet once dismissed', () => {
    const base = emptyPlan('TPE');
    const r = addRoundTrip(base, 'TPE', 'HKG');
    if ('error' in r) throw new Error(r.error);
    const ac = newAircraft(r.plan, 'A20N');
    const plan = { ...r.plan, fleet: [...r.plan.fleet, ac] };
    const n = pickNudge(plan, null, [], { guideDone: true, dismissed: [] });
    expect(n?.run).toEqual({ kind: 'aircraft', id: ac.id });
    const after = pickNudge(plan, null, [], { guideDone: true, dismissed: [n!.id] });
    expect(after?.id).not.toBe(n!.id);
  });
});
