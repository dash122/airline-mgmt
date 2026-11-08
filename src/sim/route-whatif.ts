// What the route sheet's "one more / one fewer round trip" buttons would do to the whole network's weekly profit.
// Runs in the calculation worker: each answer is two full simulations.
import { removeOneRoundTrip } from './schedule';
import { addRoundTrip, localMinutes, simulate, type Plan } from './simulate';

export interface RouteWhatIf { add: number | null; remove: number | null }

export function routeWhatIf(plan: Plan, a: string, b: string, routeKey: string): RouteWhatIf {
  const now = simulate(plan);
  const base = now.revenue - now.cost;
  const more = addRoundTrip(plan, a, b);
  const fewer = removeOneRoundTrip(plan, routeKey, localMinutes);
  const delta = (p: Plan) => { const r = simulate(p); return r.revenue - r.cost - base; };
  return { add: 'error' in more ? null : delta(more.plan), remove: fewer ? delta(fewer) : null };
}
