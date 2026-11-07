// Codeshare: which of a partner airline's routes are worth selling seats on, and what each one does to the network.
// Every number comes from running the whole week's simulation with and without the codeshare (about 1 ms each).
import { airlines } from './competitors';
import { airlineNetwork, type AirlineRoute } from './networks';
import { canCodeshare, hasCodeshare, routePairs, simulate, toggleCodeshare, type CodeshareResult, type NetworkResult, type Plan } from './simulate';

export { CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, canCodeshare, hasCodeshare, toggleCodeshare } from './simulate';

export interface CodeshareOption {
  route: AirlineRoute;
  active: boolean;
  /** Weekly network profit with the codeshare minus without it (fee included). */
  gain: number;
  /** The codeshare's own numbers, with it in the plan. */
  stats: CodeshareResult | null;
  /** Which of the player's airports it touches. */
  at: string;
}

/** Most routes of one partner that are tried, busiest first. */
const MAX_OPTIONS = 60;

const profit = (r: NetworkResult) => r.revenue - r.cost;

/** Airports the player flies to or from, and its base. */
export function playerAirports(plan: Plan): Set<string> {
  const s = new Set<string>([plan.base]);
  for (const r of routePairs(plan)) { s.add(r.a); s.add(r.b); }
  return s;
}

/**
 * The partner's routes from airports the player flies to, with what codesharing on each would add to (or, for an
 * active one, what it adds now to) the week's profit. Routes that would carry nobody are left out unless active.
 */
export function codeshareOptions(plan: Plan, airlineId: string): CodeshareOption[] {
  const net = airlineNetwork(airlineId);
  if (!net || !canCodeshare(net.airline) || !plan.fleet.length) return [];
  const mine = playerAirports(plan);
  const routes = net.routes.filter((r) => mine.has(r.a) || mine.has(r.b) || hasCodeshare(plan, airlineId, r.key))
    .sort((x, y) => Number(hasCodeshare(plan, airlineId, y.key)) - Number(hasCodeshare(plan, airlineId, x.key)) || y.freq - x.freq)
    .slice(0, MAX_OPTIONS);
  const now = simulate(plan);
  const out: CodeshareOption[] = [];
  for (const route of routes) {
    const active = hasCodeshare(plan, airlineId, route.key);
    const other = simulate(toggleCodeshare(plan, airlineId, route.key));
    const withIt = active ? now : other;
    const stats = withIt.codeshares[`${airlineId}|${route.key}`] ?? null;
    if (!active && (!stats || stats.pax < 1)) continue;
    const gain = active ? profit(now) - profit(other) : profit(other) - profit(now);
    out.push({ route, active, gain, stats, at: mine.has(route.a) ? route.a : route.b });
  }
  return out.sort((x, y) => Number(y.active) - Number(x.active) || y.gain - x.gain);
}

/** The plan's codeshares grouped by partner, for lists. */
export function partnersOf(plan: Plan): { id: string; name: string; color: string; keys: string[] }[] {
  const by = new Map<string, string[]>();
  for (const c of plan.codeshares ?? []) by.set(c.airline, [...(by.get(c.airline) ?? []), c.key]);
  return [...by.entries()].map(([id, keys]) => {
    const a = airlines().find((x) => x.id === id);
    return { id, name: a?.name ?? id, color: a?.color ?? '#888', keys };
  });
}

