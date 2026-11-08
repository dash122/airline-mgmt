// Codeshare: which of a partner airline's routes are worth selling seats on, and what each one does to the network.
// Every number comes from running the whole week's simulation with and without the codeshare (about 1 ms each).
import { airlines } from './competitors';
import { airlineNetwork, type AirlineRoute } from './networks';
import { canCodeshare, CODESHARE_SHARES, codeshareShare, hasCodeshare, routePairs, setCodeshareShare, simulate, toggleCodeshare, type CodeshareResult, type NetworkResult, type Plan } from './simulate';

export { CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, CODESHARE_SHARES, canCodeshare, codeshareFee, codeshareShare, hasCodeshare, setCodeshareShare, toggleCodeshare } from './simulate';

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


/** What one codeshare does to one of the player's own routes. */
export interface CodeshareRouteImpact {
  key: string;
  /** Codeshare travellers on it, weekly both directions. */
  feedPax: number;
  /** The player's own travellers it no longer has room for (onboard without minus the others onboard with it). */
  displacedPax: number;
  lfBefore: number;
  lfAfter: number;
  /** Full flights a week, without and with. */
  fullBefore: number;
  fullAfter: number;
}

/** A codeshare's weekly effect, from a full simulation with and without it. Every term adds up to `gain`. */
export interface CodeshareImpact {
  active: boolean;
  stats: CodeshareResult;
  /** Net change in the week's profit (fee included). */
  gain: number;
  /** Fares codeshare travellers pay for your flights (= stats.feedRevenue). */
  feedRevenue: number;
  /** Change in fares from everyone else on your flights: negative when codeshare travellers take their seats. */
  ownRevenue: number;
  /** Extra per-traveller costs (catering, check-in, airport fees) for the added travellers. */
  paxCost: number;
  fee: number;
  routes: CodeshareRouteImpact[];
}

/**
 * The effect of a codeshare (whether or not it is in the plan yet), with its seat block or, when given, another one.
 * Null when the partner doesn't fly it.
 */
export function codeshareImpact(plan: Plan, airlineId: string, key: string, now?: NetworkResult, share?: number): CodeshareImpact | null {
  const active = hasCodeshare(plan, airlineId, key);
  const cur = now ?? simulate(plan);
  const without = active ? simulate(toggleCodeshare(plan, airlineId, key)) : cur;
  const withIt = share !== undefined && share !== codeshareShare(plan, airlineId, key) ? simulate(setCodeshareShare(plan, airlineId, key, share))
    : active ? cur : simulate(toggleCodeshare(plan, airlineId, key));
  const stats = withIt.codeshares[`${airlineId}|${key}`];
  if (!stats) return null;
  const gain = profit(withIt) - profit(without);
  const ownRevenue = withIt.revenue - without.revenue - stats.feedRevenue;
  const fee = stats.fee;
  const paxCost = withIt.cost - without.cost - fee;
  const routes: CodeshareRouteImpact[] = stats.feeds.map((f) => {
    const a = withIt.routes[f.key];
    const b = without.routes[f.key];
    return {
      key: f.key, feedPax: f.pax,
      displacedPax: Math.max(0, f.pax - ((a?.pax ?? 0) - (b?.pax ?? 0))),
      lfBefore: b?.loadFactor ?? 0, lfAfter: a?.loadFactor ?? 0,
      fullBefore: b?.fullFlights ?? 0, fullAfter: a?.fullFlights ?? 0,
    };
  });
  return { active, stats, gain, feedRevenue: stats.feedRevenue, ownRevenue, paxCost, fee, routes };
}

/** What each seat block would add to the week (fee included), and what it would sell. */
export interface ShareChoice { share: number; gain: number; pax: number; wanted: number; seats: number }

export function shareChoices(plan: Plan, airlineId: string, key: string): ShareChoice[] {
  const active = hasCodeshare(plan, airlineId, key);
  const without = simulate(active ? toggleCodeshare(plan, airlineId, key) : plan);
  return CODESHARE_SHARES.map((share) => {
    const r = simulate(setCodeshareShare(plan, airlineId, key, share));
    const s = r.codeshares[`${airlineId}|${key}`];
    return { share, gain: profit(r) - profit(without), pax: s?.pax ?? 0, wanted: s?.wanted ?? 0, seats: s?.seats ?? 0 };
  });
}

/** The seat block that adds the most (the smaller one when two are within NT$10k). */
export const bestShare = (choices: ShareChoice[]) =>
  choices.reduce((b, c) => (c.gain > b.gain + 10_000 ? c : b), choices[0]);

/** One codeshare idea across all partners. */
export interface CodeshareIdea extends CodeshareOption { airline: string }

/** The best codeshares not yet in the plan, across every partner that can codeshare, most profit first. */
export function codeshareIdeas(plan: Plan, limit = 12): CodeshareIdea[] {
  if (!plan.fleet.length) return [];
  const out: CodeshareIdea[] = [];
  for (const a of airlines()) {
    if (!canCodeshare(a)) continue;
    for (const o of codeshareOptions(plan, a.id)) if (!o.active && o.gain > 0) out.push({ ...o, airline: a.id });
  }
  return out.sort((x, y) => y.gain - x.gain).slice(0, limit);
}
