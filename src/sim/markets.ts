// Market model: weekly one-way travel demand between every pair of airports.
// Deterministic: same data in, same markets out.
import { AIRPORTS, type Airport } from '../data/airports';
import { surfaceBetween, type SurfaceLink } from '../data/surface';
import { distanceKm } from './geo';
import { airUtility, surfaceUtility, noTravelUtility } from './choice';

export interface Market {
  a: string;
  b: string;
  distKm: number;
  /** Calibrated weekly air passengers per direction today (all airlines). */
  airDemand: number;
  /** Weekly travellers per direction who would consider the trip (all modes plus not travelling). */
  potential: number;
  /** Reference one-way fare, NT$. */
  refFare: number;
  /** Weekly flights per direction by other airlines (0 = no existing service). */
  rivalFreq: number;
  surface?: SurfaceLink;
}

export const MIN_MARKET_KM = 120;

export const refFare = (distKm: number) => Math.max(1200, Math.round((900 + 2.2 * distKm) / 10) * 10);

function crossBorderFactor(a: Airport, b: Airport): number {
  if (a.country === b.country) return (a.domesticWeight ?? 1) * (b.domesticWeight ?? 1);
  const roles = (a.intlWeight ?? 1) * (b.intlWeight ?? 1);
  if (roles === 0) return 0;
  // Small airports see little international traffic.
  const reach = Math.sqrt(Math.min(1, a.annualPaxM / 15) * Math.min(1, b.annualPaxM / 15));
  return roles * reach * baseCrossBorder(a, b);
}

function baseCrossBorder(a: Airport, b: Airport): number {
  const pair = [a.country, b.country].sort().join('-');
  const table: Record<string, number> = { 'JP-TW': 0.6, 'HK-TW': 0.7, 'MO-TW': 0.5, 'HK-JP': 0.45, 'JP-MO': 0.2, 'HK-MO': 0.8 };
  return table[pair] ?? 0.4;
}

function railPenalty(s?: SurfaceLink): number {
  if (!s) return 1;
  return Math.min(1, Math.max(0.02, Math.pow(Math.max(0, s.hours - 1.5) / 6, 1.5)));
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function buildMarkets(): Map<string, Market> {
  const n = AIRPORTS.length;
  // Gravity weights.
  const G: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = AIRPORTS[i], b = AIRPORTS[j];
      if (a.city === b.city) continue;
      const d = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (d < MIN_MARKET_KM) continue;
      const g = crossBorderFactor(a, b) * railPenalty(surfaceBetween(a.city, b.city)) * Math.pow(d, -1.2);
      G[i][j] = G[j][i] = g;
    }
  }
  // Target weekly departing O&D passengers inside the map per airport.
  const target = AIRPORTS.map((a) => (a.annualPaxM * 1e6 * a.inRegionShare) / 2 / 52);
  // Symmetric balancing: D_ij = k_i * k_j * G_ij with sum_j D_ij ~= target_i.
  const k = new Array(n).fill(1);
  for (let iter = 0; iter < 200; iter++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += k[i] * k[j] * G[i][j];
      if (s > 0) k[i] *= Math.sqrt(target[i] / s);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i][j] = k[i] * k[j] * G[i][j];

  const out = new Map<string, Market>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (G[i][j] === 0) continue;
      const a = AIRPORTS[i], b = AIRPORTS[j];
      const distKm = distanceKm(a.lat, a.lon, b.lat, b.lon);
      const airDemand = D[i][j];
      const fare = refFare(distKm);
      const surface = surfaceBetween(a.city, b.city);
      let rivalFreq = Math.round(airDemand / (180 * 0.8));
      if (rivalFreq < 3) rivalFreq = 0;
      // Infer the full travel potential so that, with today's service, air carries airDemand.
      const refFreq = rivalFreq || 7;
      const uAir = Math.exp(airUtility(fare, distKm, refFreq));
      const uSurf = surface ? Math.exp(surfaceUtility(surface)) : 0;
      const uNone = Math.exp(noTravelUtility(fare, distKm));
      const airShare = uAir / (uAir + uSurf + uNone);
      out.set(pairKey(a.code, b.code), {
        a: a.code,
        b: b.code,
        distKm,
        airDemand,
        potential: airDemand / airShare,
        refFare: fare,
        rivalFreq,
        surface,
      });
    }
  }
  return out;
}

let cache: Map<string, Market> | null = null;
export function markets(): Map<string, Market> {
  if (!cache) cache = buildMarkets();
  return cache;
}

export function marketBetween(a: string, b: string): Market | undefined {
  return markets().get(pairKey(a, b));
}
