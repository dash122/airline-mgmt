// Traveller choice model. Utilities are in "log weight" units (higher is better).
export interface GroundOption {
  name: string;
  hours: number; // door to door
  fare: number; // NT$
  /** Comfort bonus (+) or penalty (-) versus flying at equal cost. */
  comfort: number;
}

/** Value of time, NT$ per hour. */
export const VALUE_OF_TIME = 600;
/** Sensitivity to generalized cost (per NT$). */
export const THETA = 1 / 1000;
/** Hours of airport access, security and boarding at both ends. */
export const AIR_ACCESS_HOURS = 3;
/** Hours in a week when flights depart. */
export const SERVICE_HOURS_PER_WEEK = 7 * 16;

export const blockHours = (distKm: number, speedKmh = 820) => distKm / speedKmh + 0.5;

/** Average extra hours a traveller waits for a departure that suits them, valued at half. */
export const scheduleDelay = (freq: number) => Math.min(24, SERVICE_HOURS_PER_WEEK / (2 * Math.max(freq, 0.1))) * 0.5;

export function airGeneralizedCost(fare: number, distKm: number, freq: number): number {
  return fare + VALUE_OF_TIME * (AIR_ACCESS_HOURS + blockHours(distKm) + scheduleDelay(freq));
}

/** Utility of flying when a single airline (or the market as a whole) offers `freq` flights a week at `fare`. */
export function airUtility(fare: number, distKm: number, freq: number): number {
  return -THETA * airGeneralizedCost(fare, distKm, freq);
}

export interface AirOffer {
  freq: number;
  fare: number;
}

/**
 * Nested choice: travellers first pick a mode, then an airline. Flying gets better with the total
 * number of flights in the market (less waiting). Each airline's share of fliers is proportional
 * to its flights, adjusted for fare.
 */
export function airChoice(offers: AirOffer[], distKm: number): { utility: number; shares: number[] } {
  const total = offers.reduce((s, o) => s + o.freq, 0);
  if (total <= 0) return { utility: -Infinity, shares: offers.map(() => 0) };
  const w = offers.map((o) => o.freq * Math.exp(-THETA * o.fare));
  const W = w.reduce((s, x) => s + x, 0);
  const timeCost = VALUE_OF_TIME * (AIR_ACCESS_HOURS + blockHours(distKm) + scheduleDelay(total));
  return { utility: -THETA * timeCost + Math.log(W / total), shares: w.map((x) => x / W) };
}

export function groundUtility(g: GroundOption): number {
  return -THETA * (g.fare + VALUE_OF_TIME * g.hours) + g.comfort;
}

/** Not travelling: anchored to a reference weekly air service so demand responds to price and service. */
export function noTravelUtility(refFare: number, distKm: number): number {
  return -THETA * airGeneralizedCost(refFare, distKm, 7) * 1.35;
}
