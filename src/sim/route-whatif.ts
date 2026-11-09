// What the route sheet's "one more / one fewer round trip" buttons would do to the whole network's weekly profit.
// Runs in the calculation worker: each answer is two full simulations.
import { removeOneRoundTrip } from './schedule';
import { addRoundTrip, localMinutes, simulate, type Plan } from './simulate';

export interface RouteWhatIf { add: number | null; remove: number | null }

/** One simulation at a time, so a caller can yield between them and drop an answer a newer plan has made stale. */
export function* routeWhatIfSteps(plan: Plan, a: string, b: string, routeKey: string): Generator<void, RouteWhatIf, void> {
  const now = simulate(plan);
  const base = now.revenue - now.cost;
  const more = addRoundTrip(plan, a, b);
  const fewer = removeOneRoundTrip(plan, routeKey, localMinutes);
  const delta = (p: Plan) => { const r = simulate(p); return r.revenue - r.cost - base; };
  yield;
  const add = 'error' in more ? null : delta(more.plan);
  yield;
  return { add, remove: fewer ? delta(fewer) : null };
}

export function routeWhatIf(plan: Plan, a: string, b: string, routeKey: string): RouteWhatIf {
  const steps = routeWhatIfSteps(plan, a, b, routeKey);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
