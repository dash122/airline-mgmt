import type { CSSProperties } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from '../sim/markets';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;

/** The legs of a journey, each with its pair key, so a leg can be matched to a route. */
export const journeyLegs = (path: string[]) => path.slice(1).map((to, i) => ({ from: path[i], to, key: pairKey(path[i], to) }));

/** Whether a journey flies this route (either direction). */
export const journeyUses = (path: string[], routeKey: string) => journeyLegs(path).some((l) => l.key === routeKey);

/** A city's name for a small label: the bracketed part (松山(愛媛)) is dropped. */
export const shortName = (code: string) => name(code).replace(/[（(].*?[）)]/g, '');

/**
 * Both directions of a journey are one journey, so it can be read either way. Reading it the same way in every row makes
 * a list scannable: your own flights first, the partner's flight last, so the dashed leg is always at the right.
 */
export function orientJourney(path: string[], partnerKey: string): string[] {
  const at = journeyLegs(path).findIndex((l) => l.key === partnerKey);
  return at >= 0 && at < path.length - 2 - at ? [...path].reverse() : path;
}

/**
 * One journey as a line of airports: filled dots at the two ends, hollow dots where the traveller changes planes. Every
 * airport gets an equal column and each line runs from one dot to the next, so rows with the same number of stops line up.
 * The partner's flight is the dashed leg in the airline's colour, your own flights are solid, and `here` (a route key)
 * is drawn thicker so you can see where the route you came from sits in the trip.
 */
export function JourneyPath({ path: raw, partnerKey, color, airline, here }: { path: string[]; partnerKey: string; color: string; airline: string; here?: string }) {
  const path = orientJourney(raw, partnerKey);
  const legs = journeyLegs(path);
  const said = `${name(path[0])}${legs.map((l) => `，${l.key === partnerKey ? `搭${airline}到` : '搭你的航班到'}${name(l.to)}`).join('')}`;
  return (
    <ol className="jy" role="img" aria-label={said} style={{ gridTemplateColumns: `repeat(${path.length}, minmax(0, 1fr))`, '--c': color } as CSSProperties}>
      {path.map((code, i) => {
        const leg = legs[i];
        return (
          <li key={`${code}-${i}`} className={`jy-node ${i === 0 || i === path.length - 1 ? 'end' : 'via'}${leg ? ` ${leg.key === partnerKey ? 'partner' : 'own'}${leg.key === here ? ' here' : ''}` : ''}`}>
            <i className="jy-dot" />
            <b>{code}</b>
            <small>{shortName(code)}</small>
          </li>
        );
      })}
    </ol>
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
