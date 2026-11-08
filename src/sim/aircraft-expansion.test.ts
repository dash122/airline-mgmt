import { describe, expect, test } from 'vitest';
import { AIRCRAFT, MODEL_ORDER, type AircraftModel } from '../data/aircraft';
import { AIRPORTS } from '../data/airports';
import { emptyPlan, routeProblem } from './simulate';
import { typesFor } from './schedule';
import { rivalsFrom } from './competitors';

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

  test('rival airlines keep their own fleets, so the added types never appear in competitor schedules', () => {
    const hubs = ['TPE', 'HKG', 'NRT', 'ICN', 'SIN', 'BKK', 'LAX', 'LHR', 'JFK', 'DXB', 'SYD', 'CDG'].filter((c) => AIRPORTS.some((a) => a.code === c));
    let checked = 0;
    for (const a of hubs) for (const b of hubs) {
      if (a === b) continue;
      for (const s of rivalsFrom(a, b)) {
        checked++;
        expect(ADDED, `${a}-${b}`).not.toContain(s.type);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
