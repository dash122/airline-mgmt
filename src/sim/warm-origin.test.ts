import { expect, it } from 'vitest';
import { emptyPlan, addRoundTrip } from './simulate';
import { destinationsFrom, warmOriginSteps } from './newroute';

it('warming an origin in the background leaves its destination list unchanged', () => {
  let plan = emptyPlan('TPE');
  for (const to of ['HKG', 'NRT', 'SIN']) { const n = addRoundTrip(plan, 'TPE', to); if ('plan' in n) plan = n.plan; }
  const before = destinationsFrom(plan, 'TPE');
  const steps = warmOriginSteps('TPE');
  let r = steps.next();
  while (!r.done) r = steps.next();
  expect(destinationsFrom(plan, 'TPE')).toEqual(before);
  expect(before.length).toBeGreaterThan(0);
});
