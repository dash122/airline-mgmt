// Scheduled flight times (gate to gate), built the way airlines plan them: taxiing at both ends, climb and descent,
// a cruise along airways that are a little longer than the great circle, and the prevailing westerly winds.
import type { Airport, AirportSize } from '../data/airports';
import { distanceKm, greatCirclePoint } from './geo';

/** Minutes of taxiing out of, or into, an airport of this size: big hubs have long taxiways and queues. */
export const TAXI_MIN: Record<AirportSize, number> = { hub: 15, major: 12, large: 10, medium: 7, small: 5 };
/** Minutes lost to climbing and descending, compared with cruising the whole way. */
export const CLIMB_DESCENT_MIN = 15;
/** Airways and approach paths are this much longer than the great circle. */
export const ROUTE_FACTOR = 1.04;
/** Average jet-stream wind, km/h: flights heading east gain it and flights heading west lose it. */
export const WIND_KMH = 80;
/** Turboprops fly low, below most of the jet stream. */
const TURBOPROP_KMH = 650;

const rad = (d: number) => (d * Math.PI) / 180;

/** How much of a flight heads east (+1) or west (-1), averaged along its great circle. */
export function eastwardShare(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const steps = 8;
  let sum = 0;
  let prev = [a.lat, a.lon];
  for (let i = 1; i <= steps; i++) {
    const next = greatCirclePoint(a.lat, a.lon, b.lat, b.lon, i / steps);
    let dLon = next[1] - prev[1];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const east = dLon * Math.cos(rad((next[0] + prev[0]) / 2));
    const north = next[0] - prev[0];
    const len = Math.hypot(east, north);
    if (len > 0) sum += east / len;
    prev = next;
  }
  return sum / steps;
}

/**
 * Gate-to-gate minutes from `a` to `b` at cruise speed `speedKmh`, before rounding. On an A320neo Taipei-Hong Kong
 * comes out at 1 h 50 (1 h 40 back) and Tokyo-Sapporo 1 h 40; on a 787-9 Hong Kong-London 12 h 45 (11 h 05 back) and
 * Los Angeles-Taipei 14 h 30 (12 h 25 eastbound), close to real timetables.
 */
export function flightMinutesRaw(a: Airport, b: Airport, speedKmh: number): number {
  const km = distanceKm(a.lat, a.lon, b.lat, b.lon);
  const wind = speedKmh >= TURBOPROP_KMH ? WIND_KMH * eastwardShare(a, b) : 0;
  return TAXI_MIN[a.size] + TAXI_MIN[b.size] + CLIMB_DESCENT_MIN + (ROUTE_FACTOR * km * 60) / (speedKmh + wind);
}

/** Scheduled gate-to-gate minutes, rounded to 5 as timetables are. */
export const flightMinutes = (a: Airport, b: Airport, speedKmh: number) => Math.round(flightMinutesRaw(a, b, speedKmh) / 5) * 5;

/** Typical gate-to-gate hours for a distance, with no wind and mid-sized airports (for comparing trips). */
export const typicalFlightHours = (distKm: number, speedKmh = 830) => (2 * TAXI_MIN.major + CLIMB_DESCENT_MIN + (ROUTE_FACTOR * distKm * 60) / speedKmh) / 60;
