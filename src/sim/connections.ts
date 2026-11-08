// How connecting travellers reach one route: the journeys (origin → destination) that ride it on one of their legs.
import type { NetworkResult } from './simulate';

export interface RouteConnection {
  /** Where the journey starts and ends, not the route's endpoints. */
  from: string;
  to: string;
  /** The transfer airport: always one of the route's two airports, where the journey changes planes. */
  via: string;
  /** Weekly travellers, both directions. */
  pax: number;
}

/**
 * The player's connecting journeys that use route a⇄b on one of their legs. A journey (o, h, d) uses the route when
 * its first leg is o⇄h or its second leg is h⇄d. Its transfer airport h is then one of the route's airports.
 * A journey with two stops (o, h, k, d) can use the route on any of its three legs; it is listed once, under the
 * first leg on the route, with the route's stop as the transfer airport.
 */
export function routeConnections(net: NetworkResult | null | undefined, a: string, b: string): RouteConnection[] {
  const onRoute = (x: string, y: string) => (x === a && y === b) || (x === b && y === a);
  const out: RouteConnection[] = [];
  // A two-stop journey is listed at each of its transfer airports: count it once.
  const seen = new Set<string>();
  for (const [via, info] of Object.entries(net?.transfers ?? {})) {
    for (const f of info.flows) {
      if (f.pax < 0.5) continue;
      const stops = f.stops ?? [f.from, via, f.to];
      const id = stops.join('>');
      if (seen.has(id)) continue;
      const leg = stops.slice(0, -1).findIndex((x, i) => onRoute(x, stops[i + 1]));
      if (leg < 0) continue;
      seen.add(id);
      // The transfer airport is the route's end that is a stop, not the journey's origin or destination.
      const stop = [leg, leg + 1].find((i) => i > 0 && i < stops.length - 1);
      out.push({ from: stops[0], to: stops[stops.length - 1], via: stops[stop!], pax: f.pax });
    }
  }
  return out.sort((x, y) => y.pax - x.pax);
}
