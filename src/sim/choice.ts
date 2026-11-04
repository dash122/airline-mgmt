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
/**
 * How much travellers react to a fare change, relative to the route's reference fare: 10% above the
 * reference costs an airline about 1 - e^-0.25 = 22% of its share. A fixed NT$ sensitivity made long routes
 * a knife edge (on a NT$7,000 route, +10% halved demand) and short ones barely respond.
 */
export const FARE_SENSITIVITY = 2.5;
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
  /** Product quality in NT$ per trip (positive = travellers would pay more for it). */
  quality?: number;
}

/**
 * Nested choice: travellers first pick a mode, then an airline. Flying gets better with the total
 * number of flights in the market (less waiting). Each airline's share of fliers is proportional
 * to its flights, adjusted for fare.
 */
export function airChoice(offers: AirOffer[], distKm: number, refFare: number): { utility: number; shares: number[] } {
  const total = offers.reduce((s, o) => s + o.freq, 0);
  if (total <= 0) return { utility: -Infinity, shares: offers.map(() => 0) };
  // At the reference fare this is the plain generalized-cost model; away from it, fares count relative to the reference.
  const w = offers.map((o) => o.freq * Math.exp(THETA * ((o.quality ?? 0) - refFare) - fareResponse(o.fare, refFare)));
  const W = w.reduce((s, x) => s + x, 0);
  const timeCost = VALUE_OF_TIME * (AIR_ACCESS_HOURS + blockHours(distKm) + scheduleDelay(total));
  return { utility: -THETA * timeCost + Math.log(W / total), shares: w.map((x) => x / W) };
}

/** Log-weight lost by charging `fare` instead of the reference fare. */
export const fareResponse = (fare: number, refFare: number) => (FARE_SENSITIVITY * (fare - refFare)) / refFare;

export function groundUtility(g: GroundOption): number {
  return -THETA * (g.fare + VALUE_OF_TIME * g.hours) + g.comfort;
}

/** Not travelling: anchored to a reference weekly air service. Used to calibrate markets to today's traffic. */
export function noTravelUtility(refFare: number, distKm: number): number {
  return -THETA * airGeneralizedCost(refFare, distKm, 7) * 1.35;
}

/**
 * How far below daily air service at the reference fare staying home sits, in log weight, when the player
 * changes fares or service. At e^-1 about a quarter of the people who would fly with that service stay home,
 * so a market shrinks when fares rise (about 7% fewer fliers for +10% on a route nobody else flies).
 */
export const NO_TRAVEL_GAP = 1;

/**
 * Staying home, for how a market responds to the player. Unlike `noTravelUtility` it is the same distance
 * below air service on short and long routes; that one made almost nobody stay home on long routes, so fares
 * stopped mattering wherever no other airline flew.
 */
export function stayHomeUtility(refFare: number, distKm: number): number {
  return airUtility(refFare, distKm, 7) - NO_TRAVEL_GAP;
}

/** How attractive a departure time is to travellers (local minutes after midnight). */
export function timeOfDayQuality(localMin: number): number {
  const h = localMin / 60;
  if (h < 6) return 0.15;
  if (h < 7) return 0.8;
  if (h < 10) return 1.35;
  if (h < 16) return 0.85;
  if (h < 20) return 1.3;
  if (h < 22) return 0.75;
  return 0.25;
}

/** Flights longer than this (km) are long-haul: travellers like to leave late, sleep on board and land in the morning. */
export const LONG_HAUL_TIMES_KM = 4500;

/**
 * How attractive a flight's times are: its departure's time-of-day appeal on short and medium routes. On long-haul
 * flights a late-evening departure sells best and a landing in the small hours (00:30 to 05:00) badly, so
 * Los Angeles-Taipei leaves near midnight and lands at dawn, as real flights do.
 */
export function departureQuality(depLocal: number, arrLocal: number, distKm: number): number {
  if (distKm <= LONG_HAUL_TIMES_KM) return timeOfDayQuality(depLocal);
  const h = depLocal / 60, a = arrLocal / 60;
  const dep = h < 2 ? 0.9 : h < 6 ? 0.2 : h < 10 ? 1.2 : h < 16 ? 0.9 : h < 20 ? 1.1 : 1.35;
  return dep * (a >= 0.5 && a < 5 ? 0.5 : 1);
}
