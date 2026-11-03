// Traveller choice model. Utilities are in "log weight" units (higher is better).
import type { SurfaceLink } from '../data/surface';

/** Value of time, NT$ per hour. */
export const VALUE_OF_TIME = 450;
/** Sensitivity to generalized cost (per NT$). */
export const THETA = 1 / 2000;
/** Hours of airport access, security and boarding at both ends. */
export const AIR_ACCESS_HOURS = 2.5;
/** Hours in a week when flights depart. */
export const SERVICE_HOURS_PER_WEEK = 7 * 16;
/** Weight on log(frequency): more flights win more of the market. */
export const FREQ_WEIGHT = 1;

export const blockHours = (distKm: number, speedKmh = 820) => distKm / speedKmh + 0.5;

/** Average extra hours a traveller waits for a departure that suits them, valued at half. */
export const scheduleDelay = (freq: number) => Math.min(24, SERVICE_HOURS_PER_WEEK / (2 * Math.max(freq, 0.1))) * 0.5;

export function airGeneralizedCost(fare: number, distKm: number, freq: number): number {
  return fare + VALUE_OF_TIME * (AIR_ACCESS_HOURS + blockHours(distKm) + scheduleDelay(freq));
}

export function airUtility(fare: number, distKm: number, freq: number): number {
  return -THETA * airGeneralizedCost(fare, distKm, freq) + FREQ_WEIGHT * Math.log(freq / 7);
}

export function surfaceUtility(s: SurfaceLink): number {
  return -THETA * (s.fare + VALUE_OF_TIME * (s.hours + 0.5));
}

/** Not travelling: anchored to a reference weekly air service so demand responds to price and service. */
export function noTravelUtility(refFare: number, distKm: number): number {
  return -THETA * airGeneralizedCost(refFare, distKm, 7) * 1.35;
}
