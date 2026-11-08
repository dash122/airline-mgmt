import { describe, expect, it } from 'vitest';
import { routeWhatIf } from './route-whatif';
import { addRoundTrip, emptyPlan, simulate, type Plan } from './simulate';
import { removeOneRoundTrip } from './schedule';
import { localMinutes } from './simulate';

describe('route what-if', () => {
  let plan: Plan = emptyPlan('TPE');
  for (const d of ['OKA', 'HKG']) { const r = addRoundTrip(plan, 'TPE', d); if ('error' in r) throw new Error(r.error); plan = r.plan; }
  const key = 'HKG-TPE';

  it('matches the direct add and remove comparison', () => {
    const now = simulate(plan);
    const base = now.revenue - now.cost;
    const more = addRoundTrip(plan, 'HKG', 'TPE');
    const fewer = removeOneRoundTrip(plan, key, localMinutes);
    const w = routeWhatIf(plan, 'HKG', 'TPE', key);
    expect(w.add).toBeCloseTo(!('error' in more) ? (simulate(more.plan).revenue - simulate(more.plan).cost) - base : 0, 3);
    expect(w.remove).toBeCloseTo(fewer ? (simulate(fewer).revenue - simulate(fewer).cost) - base : 0, 3);
  });
});
