import type { Airport } from './airports';

// Existing competitor networks, separate from potential demand and player route permissions.
// Frequencies and airline identities remain simulated, not live timetable data.
// Macau airport operator: https://www.camacau.com/en/OurBusiness/OperationalRoutes
// AACM approved passenger routes (April 2026; includes Fukuoka):
// https://www.aacm.gov.mo/static/2026/04/01/e56b0c34-fb2a-410a-aee1-c2a5bde80765.pdf
// This maintained snapshot covers Japan, Taiwan, Hong Kong and Macau.
// Other country pairs continue to use the demand approximation.
const NETWORKS: Readonly<Record<string, readonly string[]>> = {
  MFM: ['TPE', 'KHH', 'RMQ', 'NRT', 'KIX', 'FUK'],
};

// Itami's scheduled passenger network is domestic:
// https://assets.kansai-airports.co.jp/f9ef800b-e-w24.pdf
const DOMESTIC_ONLY = new Set(['ITM']);

/** Whether the baseline may generate existing nonstop competitor service. */
export function hasCompetitorRoute(a: Airport, b: Airport): boolean {
  if (a.country !== b.country && (DOMESTIC_ONLY.has(a.code) || DOMESTIC_ONLY.has(b.code))) return false;
  if (!['JP', 'TW', 'HK', 'MO'].includes(a.country) || !['JP', 'TW', 'HK', 'MO'].includes(b.country)) return true;
  // Check both ends so the policy is independent of airport ordering.
  return (!NETWORKS[a.code] || NETWORKS[a.code].includes(b.code))
    && (!NETWORKS[b.code] || NETWORKS[b.code].includes(a.code));
}
