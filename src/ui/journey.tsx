import { Fragment, type CSSProperties } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from '../sim/markets';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;

/** The legs of a journey, each with its pair key, so a leg can be matched to a route. */
export const journeyLegs = (path: string[]) => path.slice(1).map((to, i) => ({ from: path[i], to, key: pairKey(path[i], to) }));

/** Whether a journey flies this route (either direction). */
export const journeyUses = (path: string[], routeKey: string) => journeyLegs(path).some((l) => l.key === routeKey);

/**
 * One journey as a line of airports: filled dots at the two ends, hollow dots where the traveller changes planes.
 * The partner's flight is the dashed leg in the airline's colour, your own flights are solid, and `here` (a route key)
 * is drawn thicker so you can see where the route you came from sits in the trip.
 */
export function JourneyPath({ path, partnerKey, color, airline, here }: { path: string[]; partnerKey: string; color: string; airline: string; here?: string }) {
  const legs = journeyLegs(path);
  const cols = path.map((_, i) => (i < path.length - 1 ? 'auto minmax(10px, 1fr)' : 'auto')).join(' ');
  const said = `${name(path[0])}${legs.map((l) => `，${l.key === partnerKey ? `搭${airline}到` : '搭你的航班到'}${name(l.to)}`).join('')}`;
  return (
    <div className="jy" role="img" aria-label={said} style={{ gridTemplateColumns: cols, '--c': color } as CSSProperties}>
      {path.map((code, i) => (
        <Fragment key={`${code}-${i}`}>
          <span className={`jy-node ${i === 0 || i === path.length - 1 ? 'end' : 'via'}`}>
            <i className="jy-dot" />
            <b>{code}</b>
            <small>{name(code)}</small>
          </span>
          {i < legs.length && <span className={`jy-leg ${legs[i].key === partnerKey ? 'partner' : 'own'}${legs[i].key === here ? ' here' : ''}`} />}
        </Fragment>
      ))}
    </div>
  );
}

/** What the lines and dots mean, once above a list of journeys. */
export function JourneyLegend({ airline, color, here }: { airline: string; color: string; here?: boolean }) {
  return (
    <div className="jy-legend" style={{ '--c': color } as CSSProperties}>
      <span><i className="jy-leg partner" />{airline}</span>
      <span><i className="jy-leg own" />你的航班</span>
      <span><i className="jy-dot via" />轉機</span>
      {here && <span><i className="jy-leg own here" />你剛看的航線</span>}
    </div>
  );
}
