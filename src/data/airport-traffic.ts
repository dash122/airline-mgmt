// Rounded 2024 annual terminal passengers, millions. Historical calibration anchors,
// not live statistics or origin/destination counts (connections are included).
// ACI: https://aci.aero/2025/07/08/worlds-busiest-airports-revealed-in-final-global-rankings/
// New York: https://www.panynj.gov/content/dam/airports/statistics/statistics-general-info/annual-atr/ATR_2024.pdf
// LAX: https://www.lawa.org/media/45736
const ACI_AND_AIRPORT_REPORTS: Readonly<Record<string, number>> = {
  ATL: 108.1, DXB: 92.3, DFW: 87.8, HND: 85.9, LHR: 83.9,
  DEN: 82.4, IST: 80.1, ORD: 80, DEL: 77.8, PVG: 76.8,
  LAX: 76.6, CAN: 76.4, ICN: 70.7, CDG: 70.3, SIN: 67.7,
  PEK: 67.7, AMS: 66.8, MAD: 66.2, JFK: 63.3, BKK: 62.2,
  FRA: 61.6, CLT: 58.8, LAS: 58.4, MCO: 57.2, MIA: 55.9,
  HKG: 53.1, SEA: 52.6, SFO: 50.2, EWR: 48.9, DOH: 52.7,
  KUL: 57.1, BCN: 55, FCO: 49.2, BOM: 54.8, YYZ: 46.8,
  SYD: 41.4, MUC: 41.6, NRT: 39.8, TPE: 44.9, GRU: 43.6,
  LGW: 43.2, LGA: 33.5, JNB: 18.7,
};

// Every other airport: Wikidata annual passenger counts (see scripts/build-reference.mjs), 2023-2024 or 85% of the best of 2016-2019.
import reference from './airport-reference.json';

const FROM_WIKIDATA: Record<string, number> = {};
for (const [code, r] of Object.entries(reference as Record<string, { pax?: number; pop?: number }>)) if (r.pax) FROM_WIKIDATA[code] = r.pax;

export const ANNUAL_TRAFFIC_M: Readonly<Record<string, number>> = { ...FROM_WIKIDATA, ...ACI_AND_AIRPORT_REPORTS };

/** Airport size tier from annual passengers (millions). */
export const tierFromTraffic = (m: number) => (m >= 35 ? 'hub' : m >= 12 ? 'major' : m >= 4 ? 'large' : m >= 1.2 ? 'medium' : 'small') as 'hub' | 'major' | 'large' | 'medium' | 'small';

/**
 * International (including Hong Kong, Macau and Taiwan to mainland China) terminal passengers, millions, about 2024.
 * Rounded from airport and ACI releases where they exist and estimated from airlines' international seat shares where
 * they don't. Hong Kong is all international; Guangzhou and Shenzhen are mostly domestic, so although they handle
 * more passengers than Hong Kong, they carry a fraction of its international traffic (Shenzhen 5.2 million in 2024).
 * Airports not listed fit their domestic and international markets together.
 */
export const INTERNATIONAL_M: Readonly<Record<string, number>> = {
  // East Asia
  HKG: 53.1, MFM: 7.4, TPE: 44.9, ICN: 70.4, GMP: 2, PUS: 9, CJU: 3,
  HND: 21, NRT: 33, KIX: 24, NGO: 4.5, FUK: 7.5, CTS: 4, OKA: 3.5,
  PVG: 33, SHA: 4, PEK: 12, PKX: 6, CAN: 14, SZX: 5.2, CTU: 2, TFU: 3.5, XMN: 4, HGH: 3.5, KMG: 3, CKG: 1.5, XIY: 1.5,
  // South-east and South Asia
  SIN: 67.7, BKK: 46, DMK: 12, HKT: 12, KUL: 38, CGK: 13, DPS: 11, MNL: 24, CEB: 4, SGN: 13, HAN: 11, DAD: 5,
  DEL: 20, BOM: 15, BLR: 6, MAA: 5, CMB: 10, DAC: 6,
  // Middle East and Africa
  DXB: 92.3, DOH: 52.7, AUH: 28.9, JED: 26, RUH: 18, DMM: 6, KWI: 15, BAH: 9, MCT: 13, AMM: 9, TLV: 21, CAI: 26,
  JNB: 9, CPT: 3, ADD: 11, NBO: 6, CMN: 9, LOS: 4,
  // Europe
  LHR: 79.2, LGW: 40, STN: 29, LTN: 16, MAN: 27, EDI: 10, DUB: 33, CDG: 65, ORY: 19, NCE: 9, AMS: 66.8, BRU: 22,
  FRA: 56, MUC: 34, DUS: 17, BER: 21, HAM: 10, ZRH: 31, GVA: 18, VIE: 31.5, MAD: 45, BCN: 41, PMI: 22, AGP: 20,
  LIS: 31, OPO: 12, FCO: 37, MXP: 26, VCE: 10, IST: 59, SAW: 21, AYT: 34, ATH: 23, CPH: 29, ARN: 21, OSL: 15, HEL: 16,
  WAW: 20, PRG: 14, BUD: 17, OTP: 13,
  // Americas and Oceania
  JFK: 34, EWR: 16, LAX: 24, SFO: 14, MIA: 24, ORD: 14, ATL: 13, DFW: 11, IAH: 12, YYZ: 31, YVR: 14, YUL: 16,
  MEX: 19, CUN: 22, GRU: 15, GIG: 4, EZE: 10, SCL: 10, LIM: 11, BOG: 14, PTY: 13.5,
  SYD: 16, MEL: 11, BNE: 6, PER: 6, AKL: 11,
};

/**
 * Share of terminal passengers changing planes there, about 2024. They count twice at the hub and are not travellers
 * to or from its city, so the demand model fits each city's own trips to the rest, and the hub's flights carry the
 * transfers on top. Hong Kong was about 28% in late 2025; Doha and the US airline hubs are mostly transfers.
 */
export const TRANSFER_SHARE: Readonly<Record<string, number>> = {
  HKG: 0.28, TPE: 0.18, ICN: 0.15, NRT: 0.2, HND: 0.08, PVG: 0.1, PEK: 0.12, CAN: 0.12, SIN: 0.3, BKK: 0.15, KUL: 0.2,
  MNL: 0.12, DEL: 0.15, DXB: 0.5, DOH: 0.7, AUH: 0.55, IST: 0.45, ADD: 0.65, JNB: 0.2, NBO: 0.3, CAI: 0.2, JED: 0.15,
  LHR: 0.27, CDG: 0.3, AMS: 0.37, FRA: 0.5, MUC: 0.35, ZRH: 0.3, VIE: 0.25, HEL: 0.3, MAD: 0.25, LIS: 0.25, FCO: 0.12,
  CPH: 0.15, ARN: 0.12, WAW: 0.2, BRU: 0.12,
  ATL: 0.6, DFW: 0.55, ORD: 0.45, DEN: 0.45, CLT: 0.7, IAH: 0.5, PHX: 0.3, MSP: 0.4, DTW: 0.45, SLC: 0.45, SEA: 0.2,
  SFO: 0.2, LAX: 0.15, JFK: 0.15, EWR: 0.25, MIA: 0.3, YYZ: 0.3, YVR: 0.2, MEX: 0.2, PTY: 0.6, BOG: 0.25, LIM: 0.3,
  GRU: 0.3, SYD: 0.12, AKL: 0.15,
};
/** Share of passengers transferring at an airport. */
export const transferShare = (code: string) => TRANSFER_SHARE[code] ?? 0;

/**
 * International share of passengers at the airports of countries with big domestic markets, where the airport has
 * no figure of its own above. Haikou, Chengdu or Denver fly almost only domestic routes; fitted as a whole, their few
 * international markets came out as big as Hong Kong's.
 */
export const COUNTRY_INTERNATIONAL_SHARE: Readonly<Record<string, number>> = {
  CN: 0.04, US: 0.04, IN: 0.06, BR: 0.04, RU: 0.12, ID: 0.08, AU: 0.06, CA: 0.15, MX: 0.15, TR: 0.25, IR: 0.1,
  VN: 0.12, PH: 0.08, AR: 0.08, CO: 0.1, CL: 0.1, PE: 0.1, KR: 0.1, SA: 0.25, NG: 0.1, ZA: 0.08, KZ: 0.25, NZ: 0.15,
  TH: 0.12, MY: 0.2, JP: 0.05, NO: 0.3, SE: 0.5, ES: 0.6, IT: 0.6, FR: 0.5, DE: 0.75, GB: 0.8, EG: 0.6, PK: 0.4,
};
