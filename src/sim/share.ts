// Who carries a market's travellers: the player against each competitor airline.
import { airlines, type Airline } from './competitors';
import { pairKey } from './markets';
import { competitionFor, todaySplit, type NetworkResult, type RouteResult } from './simulate';

export interface ShareRow {
  /**
   * own = your nonstops, ownVia = your flights with a change of plane at `via`, rival = a competitor's nonstops,
   * rivalVia = a competitor's one-stop trips through its hub `via`, connecting = other airlines' connections.
   */
  kind: 'own' | 'ownVia' | 'rival' | 'rivalVia' | 'connecting';
  id: string;
  airline?: Airline;
  /** ownVia, rivalVia: where the travellers change planes. */
  via?: string;
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
  /** The player's travellers who found the flights full (weekly, nonstop and connecting). */
  ownTurnedAway: number;
  /** Share of the market's flights that are the player's. */
  ownFreqShare: number;
}

const KIND_ORDER: Record<ShareRow['kind'], number> = { own: 0, rival: 1, ownVia: 2, rivalVia: 3, connecting: 4 };

/**
 * Who carries the travellers between two airports: your nonstops, your connections (per transfer airport), each
 * competitor's nonstops and its connections through its hubs, and other airlines' connections. Today's split where you carry nobody; with your flights
 * when `net` (or the route's result) is given.
 */
export function marketSplit(a: string, b: string, result?: RouteResult, net?: NetworkResult | null): MarketSplit {
  const key = pairKey(a, b);
  const byId = new Map(airlines().map((x) => [x.id, x]));
  const rivals = new Map<string, ShareRow>();
  const via = new Map<string, number>();
  const rivalVia = new Map<string, ShareRow>();
  let total = 0, connecting = 0, nonstop = 0, wanted = 0, todayConnecting = 0;
  for (const [o, d] of [[a, b], [b, a]]) {
    const t = todaySplit(o, d);
    const info = net?.markets[`${o}>${d}`];
    total += info ? info.airTotal : t.total;
    connecting += info ? info.connecting : t.connecting;
    todayConnecting += t.connecting;
    if (info) {
      nonstop += info.nonstop;
      wanted += info.wanted;
      for (const [h, n] of Object.entries(info.via)) via.set(h, (via.get(h) ?? 0) + n);
    }
    competitionFor(o, d).services.forEach((sv, i) => {
      const r = rivals.get(sv.airline.id) ?? { kind: 'rival' as const, id: sv.airline.id, airline: byId.get(sv.airline.id) ?? sv.airline, freq: 0, fare: sv.fare, pax: 0, share: 0, before: 0, airports: [] };
      r.freq += sv.freq;
      r.pax += info ? info.rivals[i]?.pax ?? 0 : t.rivals[i];
      r.before += t.rivals[i];
      const pk = pairKey(sv.from, sv.to);
      if (pk !== key && !r.airports.includes(pk)) r.airports.push(pk);
      rivals.set(sv.airline.id, r);
    });
    competitionFor(o, d).connections.forEach((x, i) => {
      const id = `${x.airline.id}@${x.via}`;
      const r = rivalVia.get(id) ?? { kind: 'rivalVia' as const, id, airline: byId.get(x.airline.id) ?? x.airline, via: x.via, freq: 0, fare: x.fare, pax: 0, share: 0, before: 0, airports: [] };
      r.freq += x.freq;
      r.pax += info ? info.rivalVia?.[i]?.pax ?? 0 : t.via[i];
      r.before += t.via[i];
      rivalVia.set(id, r);
    });
  }
  const rows: ShareRow[] = [...rivals.values()];
  // Without the whole network's result, fall back to the route's own numbers (nonstop only).
  if (result && !net) {
    total = result.airTotal;
    connecting = result.connectingPax;
    nonstop = result.localPax;
    wanted = result.localDemand;
    for (const r of result.rivals) { const row = rivals.get(r.id); if (row) row.pax = r.pax; }
    // The route's result only has all connections together: share them out as they are split today.
    for (const r of rivalVia.values()) r.pax = todayConnecting > 0 ? (r.before * connecting) / todayConnecting : 0;
  }
  const named = [...rivalVia.values()].reduce((sum, r) => sum + r.pax, 0);
  for (const r of rivalVia.values()) if (r.pax >= 0.5) rows.push(r);
  connecting = Math.max(0, connecting - named);
  const viaPax = [...via.values()].reduce((s, x) => s + x, 0);
  if (result) rows.push({ kind: 'own', id: 'own', freq: result.flightsPerWeek, fare: result.fare, pax: nonstop, share: 0, before: 0, airports: [] });
  for (const [h, n] of via) if (n >= 0.5) rows.push({ kind: 'ownVia', id: `via-${h}`, via: h, freq: 0, pax: n, share: 0, before: 0, airports: [] });
  if (connecting >= 1) rows.push({ kind: 'connecting', id: 'connecting', freq: 0, pax: connecting, share: 0, before: 0, airports: [] });
  for (const r of rows) r.share = total > 0 ? r.pax / total : 0;
  rows.sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || y.pax - x.pax);
  const flights = rows.filter((r) => r.kind === 'own' || r.kind === 'rival').reduce((s, r) => s + r.freq, 0);
  const own = rows.find((r) => r.kind === 'own');
  return { total, rows, ownTurnedAway: Math.max(0, wanted - nonstop - viaPax), ownFreqShare: own && flights ? own.freq / flights : 0 };
}
