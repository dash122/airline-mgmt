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
 * The player's connecting journeys that use route a⇄b on one of their two legs. A journey (o, h, d) uses the route when
 * its first leg is o⇄h or its second leg is h⇄d. Its transfer airport h is then one of the route's airports.
 */
export function routeConnections(net: NetworkResult | null | undefined, a: string, b: string): RouteConnection[] {
  const onRoute = (x: string, y: string) => (x === a && y === b) || (x === b && y === a);
  const out: RouteConnection[] = [];
  for (const [via, info] of Object.entries(net?.transfers ?? {})) {
    for (const f of info.flows) {
      if (f.pax < 0.5) continue;
      if (onRoute(f.from, via) || onRoute(via, f.to)) out.push({ from: f.from, to: f.to, via, pax: f.pax });
    }
  }
  return out.sort((x, y) => y.pax - x.pax);
}
