// "旅客怎麼轉": who rides this route, as one row per trip (origin → … → destination) with the number of travellers.
// Direct travellers come first as a plain two-airport row; connecting trips show every stop. This route's leg is drawn
// thick, your other flights thin, and a codeshare partner's flight dashed in its colour. Replaces the old flow diagram
// and the separate "brought by partners" note: one list answers both.
import { useContext, useMemo, useState, type CSSProperties } from 'react';
import { routeConnections } from '../sim/connections';
import type { NetworkResult } from '../sim/simulate';
import { airlineName } from '../sim/simulate';
import { CodeshareLink, colorOf } from './codeshare';
import { count } from './format';
import { journeyLegs, journeyUses, JourneyPath } from './journey';

export interface TravellerRow {
  key: string;
  path: string[];
  pax: number;
  /** The codeshare partner whose flight is on the trip, and that flight's route key. */
  partner?: { airline: string; key: string };
}

/** The same trip read in either direction is one trip. */
const canon = (path: string[]) => { const f = path.join('>'); const r = [...path].reverse().join('>'); return f < r ? f : r; };

/** Read a trip so that this route comes first: the far airports then fan out to the right, and rows line up. */
function routeFirst(path: string[], routeKey: string): string[] {
  const legs = journeyLegs(path);
  const at = legs.findIndex((l) => l.key === routeKey);
  return at >= 0 && at > legs.length - 1 - at ? [...path].reverse() : path;
}

/**
 * Every trip that rides route `routeKey`, biggest first: the direct travellers, your connecting trips, and trips that
 * use a codeshare partner's flight (marked, and added when the network's transfer list does not already have them).
 */
export function travellerRows(net: NetworkResult | null | undefined, routeKey: string, directPax: number): TravellerRow[] {
  const [a, b] = routeKey.split('-');
  const rows = new Map<string, TravellerRow>();
  if (directPax >= 0.5) rows.set(canon([a, b]), { key: `${a}>${b}`, path: [a, b], pax: directPax });
  for (const c of routeConnections(net, a, b)) {
    const id = canon(c.stops);
    const row = rows.get(id);
    if (row) row.pax += c.pax; else rows.set(id, { key: id, path: routeFirst(c.stops, routeKey), pax: c.pax });
  }
  for (const cs of Object.values(net?.codeshares ?? {})) {
    if (!cs.feeds.some((f) => f.key === routeKey && f.pax >= 1)) continue;
    for (const j of cs.journeys ?? []) {
      if (j.pax < 0.5 || !journeyUses(j.path, routeKey)) continue;
      const id = canon(j.path);
      const row = rows.get(id);
      const partner = { airline: cs.airline, key: cs.key };
      if (row) row.partner ??= partner; else rows.set(id, { key: id, path: j.path, pax: j.pax, partner });
    }
  }
  return [...rows.values()].sort((x, y) => y.pax - x.pax);
}

const SHOWN = 4;

export function TravellerBridge({ net, routeKey, routePax, directPax }: { net: NetworkResult | null | undefined; routeKey: string; routePax: number; directPax: number }) {
  const open = useContext(CodeshareLink);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => travellerRows(net, routeKey, directPax), [net, routeKey, directPax]);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const hidden = rows.length - shown.length;
  const direct = rows.filter((r) => r.path.length === 2).reduce((s, r) => s + r.pax, 0);
  const viaPartner = rows.filter((r) => r.partner).reduce((s, r) => s + r.pax, 0);
  const connecting = rows.filter((r) => r.path.length > 2).reduce((s, r) => s + r.pax, 0);
  const total = Math.max(routePax, direct + connecting, 1);
  const hasPartner = viaPartner > 0;
  const partnerRoute = (r: TravellerRow) => r.partner && open ? () => open(r.partner!.airline, r.partner!.key, routeKey) : undefined;
  return (
    <section className="bridge" aria-label="旅客怎麼轉">
      <div className="bridge-head">
        <h3>旅客怎麼轉</h3>
        <span>{count(total)} 人／週</span>
      </div>
      <div className="bridge-split" role="img" aria-label={`直飛 ${count(direct)} 人，轉機 ${count(connecting)} 人`}>
        <i className="direct" style={{ flexGrow: direct }} />
        <i className="transit" style={{ flexGrow: connecting }} />
      </div>
      <div className="bridge-split-legend">
        <span><i className="direct" />直飛 <b>{count(direct)}</b></span>
        <span><i className="transit" />轉機 <b>{count(connecting)}</b></span>
        {hasPartner && <span className="partner">夥伴帶來 <b>{count(viaPartner)}</b></span>}
      </div>
      <ul className="bridge-rows">
        {shown.map((r) => {
          const go = partnerRoute(r);
          const color = r.partner ? colorOf(r.partner.airline) : 'var(--accent)';
          const body = <>
            <JourneyPath path={r.path} partnerKey={r.partner?.key ?? ''} color={color} airline={r.partner ? airlineName(r.partner.airline) : ''} here={routeKey} />
            <b className="jy-pax">{count(r.pax)}<small> 人</small></b>
          </>;
          return <li key={`${r.key}|${r.partner?.key ?? ''}`}>{go ? <button onClick={go}>{body}<span className="chev" aria-hidden="true" /></button> : <div>{body}</div>}</li>;
        })}
      </ul>
      {hidden > 0 && <button className="bridge-more" aria-expanded={all} onClick={() => setAll(true)}>再看 {hidden} 條</button>}
      {all && rows.length > SHOWN && <button className="bridge-more" aria-expanded onClick={() => setAll(false)}>收起</button>}
      <div className="bridge-legend">
        <span><i className="jy-leg own here" />這條航線</span>
        <span><i className="jy-leg own" />你的航班</span>
        {hasPartner && <span><i className="jy-leg partner" style={{ '--c': 'var(--muted)' } as CSSProperties} />夥伴航班</span>}
        <span><i className="jy-dot via" />轉機</span>
      </div>
    </section>
  );
}
