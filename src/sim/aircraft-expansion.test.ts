import { describe, expect, test } from 'vitest';
import { AIRCRAFT, MODEL_ORDER, type AircraftModel } from '../data/aircraft';
import { AIRPORTS } from '../data/airports';
import { emptyPlan, routeProblem } from './simulate';
import { typesFor } from './schedule';
import { airlines, rivalsAt } from './competitors';
import { marketBetween } from './markets';

const ADDED: AircraftModel[] = ['A21X', 'BCS3', 'E75L', 'A339', 'B78X', 'A35K', 'B779', 'A388'];
const RUNWAY_NEEDED = 3000;

/** A pair of airports that a type can fly between on the given terms, found in the data rather than hard-coded. */
function findPair(pred: (a: string, b: string) => boolean): [string, string] | undefined {
  for (const a of AIRPORTS) for (const b of AIRPORTS) {
    if (a.code < b.code && pred(a.code, b.code)) return [a.code, b.code];
  }
  return undefined;
}

describe('expanded aircraft list', () => {
  test('each added type is in the list with the fields the simulation reads', () => {
    for (const t of ADDED) {
      const s = AIRCRAFT[t];
      expect(MODEL_ORDER, t).toContain(t);
      expect(s.seats, t).toBeGreaterThan(0);
      expect(s.rangeKm, t).toBeGreaterThan(0);
      expect(s.speedKmh, t).toBeGreaterThan(0);
      expect(s.ownershipPerWeek, t).toBeGreaterThan(0);
    }
    expect(AIRCRAFT.A388.seats).toBeGreaterThan(AIRCRAFT.B77W.seats);
  });

  test('the A380 needs a runway of at least 3 km at both ends, on top of its size class', () => {
    // Both ends are widebody-capable, the distance is within the A380's range, and only the runway differs.
    const pair = findPair((a, b) => {
      const A = AIRPORTS.find((x) => x.code === a)!, B = AIRPORTS.find((x) => x.code === b)!;
      return A.maxClass === 'widebody' && B.maxClass === 'widebody' && Math.min(A.runwayM, B.runwayM) < RUNWAY_NEEDED
        && routeProblem(a, b, 'B77W') === null;
    });
    expect(pair, 'a widebody route with a short runway at one end').toBeDefined();
    expect(routeProblem(pair![0], pair![1], 'A388')).toBe('跑道太短，無法起降此機型');
  });

  test('the A380 flies between two long-runway airports inside its range', () => {
    const pair = findPair((a, b) => {
      const A = AIRPORTS.find((x) => x.code === a)!, B = AIRPORTS.find((x) => x.code === b)!;
      return A.runwayM >= RUNWAY_NEEDED && B.runwayM >= RUNWAY_NEEDED && A.metro !== B.metro && routeProblem(a, b, 'A388') === null;
    });
    expect(pair).toBeDefined();
  });

  test('leases offer the A380 only on routes its runways allow', () => {
    const long = findPair((a, b) => routeProblem(a, b, 'A388') === null);
    const short = findPair((a, b) => routeProblem(a, b, 'B77W') === null && routeProblem(a, b, 'A388') === '跑道太短，無法起降此機型');
    expect(typesFor(emptyPlan(long![0]), long![0], long![1])).toContain('A388');
    expect(typesFor(emptyPlan(short![0]), short![0], short![1])).not.toContain('A388');
  });

  test('rivals fly their own fleets: varied makers, and every flight within the type\'s range and runway needs', () => {
    const used = new Set<AircraftModel>();
    let checked = 0;
    for (const al of airlines()) {
      expect(al.fleet.length, al.id).toBeGreaterThan(0);
      for (const a of AIRPORTS.filter((x) => al.bases.includes(x.code)).slice(0, 2)) {
        for (const { services } of rivalsAt(a.code).slice(0, 8)) for (const s of services) {
          if (s.airline.id !== al.id) continue;
          const A = AIRPORTS.find((x) => x.code === s.from)!, B = AIRPORTS.find((x) => x.code === s.to)!;
          const km = marketBetween(s.from, s.to)!.distKm, spec = AIRCRAFT[s.type];
          checked++;
          used.add(s.type);
          if (al.fleet.includes(s.type)) {
            expect(km, `${al.id} ${s.type}`).toBeLessThanOrEqual(spec.rangeKm);
            expect(spec.minRunwayM ?? 0, `${al.id} ${s.type}`).toBeLessThanOrEqual(Math.min(A.runwayM, B.runwayM));
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Boeing and Airbus narrowbodies and some of the later types all appear across the rivals.
    expect(used.has('B738') || used.has('B38M')).toBe(true);
    expect(used.has('A20N') || used.has('A21N')).toBe(true);
    expect(ADDED.some((t) => used.has(t))).toBe(true);
  });

  test('only airlines with a big hub and a 3 km runway get an A380', () => {
    for (const al of airlines().filter((x) => x.fleet.includes('A388'))) {
      const hub = AIRPORTS.find((x) => x.code === al.bases[0])!;
      expect(al.kind).toBe('full');
      expect(hub.runwayM).toBeGreaterThanOrEqual(RUNWAY_NEEDED);
    }
  });
});
