// Codeshare: which of a partner airline's routes are worth selling seats on, and what each one does to the network.
// Every number comes from running the whole week's simulation with and without the codeshare (about 1 ms each).
import { airlines } from './competitors';
import { airlineNetwork, type AirlineRoute } from './networks';
import { canCodeshare, CODESHARE_SHARES, codeshareShare, hasCodeshare, hostedShare, isHosted, routePairs, setCodeshareShare, setHostedShare, simulate, simulateLean, toggleCodeshare, toggleHosted, type CodeshareResult, type HostedResult, type NetworkResult, type Plan } from './simulate';

export { CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, CODESHARE_SHARES, HOSTED_FEE_PER_WEEK, canCodeshare, codeshareFee, codeshareShare, hasCodeshare, hostedShare, isHosted, setCodeshareShare, setHostedShare, toggleCodeshare, toggleHosted } from './simulate';

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
/** A search from one route's ends tries only each partner's busiest few routes there, so it stays quick on a phone. */
const NEAR_OPTIONS = 16;

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
/** `now` is the plan's own simulation; pass it when comparing many partners so it is worked out once. */
export function codeshareOptions(plan: Plan, airlineId: string, now?: NetworkResult): CodeshareOption[] {
  return drain(codeshareOptionSteps(plan, airlineId, now));
}

/** The same search one route at a time, so a caller can yield between simulations (each one is a full week). */
export function* codeshareOptionSteps(plan: Plan, airlineId: string, now?: NetworkResult, only?: Set<string>): Generator<void, CodeshareOption[], void> {
  const net = airlineNetwork(airlineId);
  if (!net || !canCodeshare(net.airline) || !plan.fleet.length) return [];
  // `only`: restrict candidates to routes touching these airports (a search from one route's ends).
  const mine = only ?? playerAirports(plan);
  const routes = net.routes.filter((r) => mine.has(r.a) || mine.has(r.b) || hasCodeshare(plan, airlineId, r.key))
    .sort((x, y) => Number(hasCodeshare(plan, airlineId, y.key)) - Number(hasCodeshare(plan, airlineId, x.key)) || y.freq - x.freq)
    .slice(0, only ? NEAR_OPTIONS : MAX_OPTIONS);
  // Most partners fly none of your airports: nothing to compare, so no simulation at all.
  if (!routes.length) return [];
  now ??= simulate(plan);
  const out: CodeshareOption[] = [];
  for (const route of routes) {
    yield;
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
  const without = active ? simulateLean(toggleCodeshare(plan, airlineId, key)) : cur;
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

/**
 * The best codeshares not yet in the plan, across every partner that can codeshare, most profit first.
 * With `near`, only partner routes that start or end at one of those airports (extensions of a route you fly).
 */
export function codeshareIdeas(plan: Plan, limit = 12, near?: string[]): CodeshareIdea[] {
  return drain(codeshareIdeaSteps(plan, limit, near));
}

/**
 * The same search, one partner at a time, so a caller can yield between partners and drop a search that a newer
 * plan has made stale. Returns the ranked list as the generator's final value.
 */
export function* codeshareIdeaSteps(plan: Plan, limit = 12, near?: string[], out: CodeshareIdea[] = []): Generator<void, CodeshareIdea[], void> {
  if (!plan.fleet.length) return [];
  const now = simulate(plan);
  const only = near ? new Set(near) : undefined;
  for (const a of airlines()) {
    if (!canCodeshare(a)) continue;
    // A search from one route's ends only needs partners that fly those airports.
    if (only && !airlineNetwork(a.id)?.routes.some((r) => only.has(r.a) || only.has(r.b))) continue;
    const options = yield* codeshareOptionSteps(plan, a.id, now, only);
    for (const o of options) {
      if (o.active || o.gain <= 0) continue;
      if (near && !near.some((c) => o.route.a === c || o.route.b === c)) continue;
      out.push({ ...o, airline: a.id });
    }
  }
  return out.sort((x, y) => y.gain - x.gain).slice(0, limit);
}

/** Runs a step generator to the end and returns its result. */
function drain<T>(steps: Generator<void, T, void>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

// ---------- Partners selling your routes ----------

/** What a partner selling one of your routes does, from a full simulation with and without it. Terms add up to `gain`. */
export interface HostedImpact {
  active: boolean;
  stats: HostedResult;
  gain: number;
  /** Your part of the partner's travellers' fares (= stats.revenue). */
  revenue: number;
  /** Change in fares from your own travellers: negative when the partner's travellers take their seats. */
  ownRevenue: number;
  /** Extra per-traveller and sales costs. */
  paxCost: number;
  fee: number;
  /** Load factor on the route, without and with. */
  lfBefore: number;
  lfAfter: number;
  /** Your own travellers it pushes off the route. */
  displacedPax: number;
}

export function hostedImpact(plan: Plan, airlineId: string, key: string, now?: NetworkResult, share?: number): HostedImpact | null {
  const active = isHosted(plan, airlineId, key);
  const cur = now ?? simulate(plan);
  const without = active ? simulateLean(toggleHosted(plan, airlineId, key)) : cur;
  const withIt = share !== undefined && share !== hostedShare(plan, airlineId, key) ? simulate(setHostedShare(plan, airlineId, key, share))
    : active ? cur : simulate(toggleHosted(plan, airlineId, key));
  const stats = withIt.hosted[`${airlineId}|${key}`];
  if (!stats) return null;
  const a = withIt.routes[key], b = without.routes[key];
  return {
    active, stats, gain: profit(withIt) - profit(without), revenue: stats.revenue,
    ownRevenue: withIt.revenue - without.revenue - stats.revenue, paxCost: withIt.cost - without.cost - stats.fee, fee: stats.fee,
    lfBefore: b?.loadFactor ?? 0, lfAfter: a?.loadFactor ?? 0,
    displacedPax: Math.max(0, stats.pax - ((a?.pax ?? 0) - (b?.pax ?? 0))),
  };
}

/** What each seat block would add if this partner sold your route. */
export function hostedChoices(plan: Plan, airlineId: string, key: string): ShareChoice[] {
  const without = simulate(isHosted(plan, airlineId, key) ? toggleHosted(plan, airlineId, key) : plan);
  return CODESHARE_SHARES.map((share) => {
    const r = simulate(setHostedShare(plan, airlineId, key, share));
    const s = r.hosted[`${airlineId}|${key}`];
    return { share, gain: profit(r) - profit(without), pax: s?.pax ?? 0, wanted: s?.wanted ?? 0, seats: s?.seats ?? 0 };
  });
}

/** One partner that could sell (or sells) one of your routes. */
export interface HostedOption { airline: string; key: string; active: boolean; gain: number; pax: number; sources: number }

/** Airlines that fly to either end of your route and can codeshare, busiest there first. */
function partnersAt(key: string): string[] {
  const [a, b] = key.split('-');
  const count = new Map<string, number>();
  for (const al of airlines()) {
    if (!canCodeshare(al)) continue;
    const net = airlineNetwork(al.id);
    const n = net?.routes.filter((r) => r.key !== key && (r.a === a || r.b === a || r.a === b || r.b === b)).length ?? 0;
    if (n) count.set(al.id, n);
  }
  return [...count].sort((x, y) => y[1] - x[1]).map(([id]) => id);
}

/** Partners that could sell one of your routes, most profit first (active ones first). */
export function hostedOptions(plan: Plan, key: string, limit = 24): HostedOption[] {
  return drain(hostedOptionSteps(plan, key, limit));
}

/** The same search one partner at a time (see codeshareOptionSteps). */
export function* hostedOptionSteps(plan: Plan, key: string, limit = 24): Generator<void, HostedOption[], void> {
  if (!routePairs(plan).some((r) => r.key === key)) return [];
  const now = simulate(plan);
  const out: HostedOption[] = [];
  for (const id of partnersAt(key).slice(0, limit)) {
    yield;
    const active = isHosted(plan, id, key);
    const other = simulate(toggleHosted(plan, id, key));
    const withIt = active ? now : other;
    const s = withIt.hosted[`${id}|${key}`];
    if (!active && (!s || s.pax < 1)) continue;
    out.push({ airline: id, key, active, gain: active ? profit(now) - profit(other) : profit(other) - profit(now), pax: s?.pax ?? 0, sources: s?.sources.length ?? 0 });
  }
  for (const h of plan.hosted ?? []) {
    if (h.key === key && !out.some((o) => o.airline === h.airline)) {
      const imp = hostedImpact(plan, h.airline, key, now);
      if (imp) out.push({ airline: h.airline, key, active: true, gain: imp.gain, pax: imp.stats.pax, sources: imp.stats.sources.length });
    }
  }
  return out.sort((x, y) => Number(y.active) - Number(x.active) || y.gain - x.gain);
}

/** The best partners to sell any of your routes, not yet doing so. */
export function hostedIdeas(plan: Plan, limit = 12, perRoute = 12): HostedOption[] {
  return drain(hostedIdeaSteps(plan, limit, perRoute));
}

/** The same search, one of your routes at a time (see codeshareIdeaSteps). */
export function* hostedIdeaSteps(plan: Plan, limit = 12, perRoute = 12, out: HostedOption[] = []): Generator<void, HostedOption[], void> {
  for (const r of routePairs(plan)) {
    const options = yield* hostedOptionSteps(plan, r.key, perRoute);
    for (const o of options) if (!o.active && o.gain > 0) out.push(o);
  }
  return out.sort((x, y) => y.gain - x.gain).slice(0, limit);
}
