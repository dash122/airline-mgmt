// Who carries a market's travellers: the player against each competitor airline.
import { airlines, type Airline } from './competitors';
import { pairKey } from './markets';
import { competitionFor, todaySplit, type RouteResult } from './simulate';

export interface ShareRow {
  kind: 'own' | 'rival' | 'connecting';
  id: string;
  airline?: Airline;
  /** Flights a week, both directions. */
  freq: number;
  fare?: number;
  /** Weekly travellers, both directions. For the player, those who got a seat. */
  pax: number;
  share: number;
  /** Weekly travellers before the player flew this route (rivals only). */
  before: number;
  /** Airport pairs it flies instead of this route's own (same-city airports). */
  airports: string[];
}

export interface MarketSplit {
  /** Weekly air travellers, both directions, all airlines. */
  total: number;
  rows: ShareRow[];
  /** The player's travellers who found the flights full (local spill, weekly). */
  ownTurnedAway: number;
  /** Share of the market's flights that are the player's. */
  ownFreqShare: number;
}

/** Each airline's travellers on a route, today if the player doesn't fly it, or with the player's flights. */
export function marketSplit(a: string, b: string, result?: RouteResult): MarketSplit {
  const key = pairKey(a, b);
  const byId = new Map(airlines().map((x) => [x.id, x]));
  // Today, without the player: per airline, both directions.
  const before = new Map<string, ShareRow>();
  let total = 0, connecting = 0;
  for (const [o, d] of [[a, b], [b, a]]) {
    const t = todaySplit(o, d);
    total += t.total;
    connecting += t.connecting;
    competitionFor(o, d).services.forEach((sv, i) => {
      const r = before.get(sv.airline.id) ?? { kind: 'rival' as const, id: sv.airline.id, airline: sv.airline, freq: 0, fare: sv.fare, pax: 0, share: 0, before: 0, airports: [] };
      r.freq += sv.freq;
      r.pax += t.rivals[i];
      r.before += t.rivals[i];
      const pk = pairKey(sv.from, sv.to);
      if (pk !== key && !r.airports.includes(pk)) r.airports.push(pk);
      before.set(sv.airline.id, r);
    });
  }
  let rows: ShareRow[];
  let ownTurnedAway = 0;
  if (result) {
    total = result.airTotal;
    connecting = result.connectingPax;
    ownTurnedAway = Math.max(0, result.localDemand - result.localPax);
    rows = result.rivals.map((r) => ({
      kind: 'rival', id: r.id, airline: byId.get(r.id), freq: r.freq, fare: r.fare, pax: r.pax, share: 0,
      before: before.get(r.id)?.before ?? 0, airports: r.airports,
    }));
    rows.unshift({ kind: 'own', id: 'own', freq: result.flightsPerWeek, fare: result.fare, pax: result.localPax, share: 0, before: 0, airports: [] });
  } else rows = [...before.values()];
  if (connecting >= 1) rows.push({ kind: 'connecting', id: 'connecting', freq: 0, pax: connecting, share: 0, before: 0, airports: [] });
  for (const r of rows) r.share = total > 0 ? r.pax / total : 0;
  rows.sort((x, y) => (x.kind === 'own' ? -1 : y.kind === 'own' ? 1 : y.pax - x.pax));
  const flights = rows.reduce((s, r) => s + r.freq, 0);
  const own = rows.find((r) => r.kind === 'own');
  return { total, rows, ownTurnedAway, ownFreqShare: own && flights ? own.freq / flights : 0 };
}
