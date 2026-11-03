// Airport data for milestone 1 (Taiwan, Hong Kong / Macau, Japan).
// Figures are APPROXIMATE (roughly 2024 public annual passenger totals and metro populations),
// entered by hand as placeholders. They are to be replaced with sourced data later.

import type { AircraftClass } from './aircraft';

export type Country = 'TW' | 'HK' | 'MO' | 'JP';

export interface Airport {
  code: string;
  name: string; // Traditional Chinese
  city: string; // city key; airports in the same city never form a market with each other
  country: Country;
  lat: number;
  lon: number;
  /** Annual passengers, millions (approximate). */
  annualPaxM: number;
  /** Share of the airport's traffic that stays inside the game map (approximate). */
  inRegionShare: number;
  /** Weekly departures the player may add (slot limit). */
  slotCap: number;
  /** Largest aircraft class the runway takes. */
  maxClass: AircraftClass;
  /** Weight on domestic markets (some gateways mostly fly abroad). Default 1. */
  domesticWeight?: number;
  /** Weight on international markets (some city airports mostly fly at home). Default 1. */
  intlWeight?: number;
}

export const AIRPORTS: Airport[] = [
  // Taiwan
  { code: 'TPE', name: '台北桃園', city: 'taipei', country: 'TW', lat: 25.08, lon: 121.23, annualPaxM: 44.9, inRegionShare: 0.45, slotCap: 140, maxClass: 'widebody', domesticWeight: 0.1 },
  { code: 'TSA', name: '台北松山', city: 'taipei', country: 'TW', lat: 25.07, lon: 121.55, annualPaxM: 5.6, inRegionShare: 0.95, slotCap: 70, maxClass: 'widebody', intlWeight: 0.3 },
  { code: 'RMQ', name: '台中', city: 'taichung', country: 'TW', lat: 24.26, lon: 120.62, annualPaxM: 2.6, inRegionShare: 0.8, slotCap: 70, maxClass: 'narrowbody' },
  { code: 'TNN', name: '台南', city: 'tainan', country: 'TW', lat: 22.95, lon: 120.21, annualPaxM: 0.4, inRegionShare: 0.95, slotCap: 42, maxClass: 'narrowbody' },
  { code: 'KHH', name: '高雄', city: 'kaohsiung', country: 'TW', lat: 22.58, lon: 120.35, annualPaxM: 6.8, inRegionShare: 0.6, slotCap: 105, maxClass: 'widebody', domesticWeight: 0.6 },
  { code: 'HUN', name: '花蓮', city: 'hualien', country: 'TW', lat: 24.02, lon: 121.62, annualPaxM: 0.3, inRegionShare: 0.95, slotCap: 42, maxClass: 'narrowbody' },
  { code: 'TTT', name: '台東', city: 'taitung', country: 'TW', lat: 22.75, lon: 121.1, annualPaxM: 0.4, inRegionShare: 1, slotCap: 42, maxClass: 'narrowbody' },
  { code: 'MZG', name: '澎湖', city: 'penghu', country: 'TW', lat: 23.57, lon: 119.63, annualPaxM: 2.0, inRegionShare: 1, slotCap: 70, maxClass: 'narrowbody' },
  { code: 'KNH', name: '金門', city: 'kinmen', country: 'TW', lat: 24.43, lon: 118.36, annualPaxM: 2.4, inRegionShare: 1, slotCap: 70, maxClass: 'narrowbody' },
  { code: 'LZN', name: '馬祖南竿', city: 'matsu', country: 'TW', lat: 26.16, lon: 119.96, annualPaxM: 0.3, inRegionShare: 1, slotCap: 28, maxClass: 'turboprop' },
  // Hong Kong / Macau
  { code: 'HKG', name: '香港', city: 'hongkong', country: 'HK', lat: 22.31, lon: 113.92, annualPaxM: 53, inRegionShare: 0.3, slotCap: 140, maxClass: 'widebody' },
  { code: 'MFM', name: '澳門', city: 'macau', country: 'MO', lat: 22.15, lon: 113.59, annualPaxM: 7.4, inRegionShare: 0.35, slotCap: 70, maxClass: 'widebody' },
  // Japan
  { code: 'HND', name: '東京羽田', city: 'tokyo', country: 'JP', lat: 35.55, lon: 139.78, annualPaxM: 85, inRegionShare: 0.85, slotCap: 140, maxClass: 'widebody', intlWeight: 0.4 },
  { code: 'NRT', name: '東京成田', city: 'tokyo', country: 'JP', lat: 35.77, lon: 140.39, annualPaxM: 39, inRegionShare: 0.35, slotCap: 140, maxClass: 'widebody', domesticWeight: 0.3 },
  { code: 'KIX', name: '大阪關西', city: 'osaka', country: 'JP', lat: 34.43, lon: 135.24, annualPaxM: 30, inRegionShare: 0.5, slotCap: 140, maxClass: 'widebody', domesticWeight: 0.4 },
  { code: 'ITM', name: '大阪伊丹', city: 'osaka', country: 'JP', lat: 34.79, lon: 135.44, annualPaxM: 15, inRegionShare: 1, slotCap: 70, maxClass: 'widebody', intlWeight: 0 },
  { code: 'NGO', name: '名古屋中部', city: 'nagoya', country: 'JP', lat: 34.86, lon: 136.81, annualPaxM: 10, inRegionShare: 0.7, slotCap: 105, maxClass: 'widebody' },
  { code: 'FUK', name: '福岡', city: 'fukuoka', country: 'JP', lat: 33.59, lon: 130.45, annualPaxM: 25, inRegionShare: 0.75, slotCap: 105, maxClass: 'widebody' },
  { code: 'CTS', name: '札幌新千歲', city: 'sapporo', country: 'JP', lat: 42.78, lon: 141.69, annualPaxM: 23, inRegionShare: 0.9, slotCap: 105, maxClass: 'widebody' },
  { code: 'OKA', name: '沖繩那霸', city: 'okinawa', country: 'JP', lat: 26.2, lon: 127.65, annualPaxM: 21, inRegionShare: 0.95, slotCap: 105, maxClass: 'widebody' },
  { code: 'SDJ', name: '仙台', city: 'sendai', country: 'JP', lat: 38.14, lon: 140.92, annualPaxM: 3.4, inRegionShare: 0.95, slotCap: 70, maxClass: 'widebody' },
  { code: 'HIJ', name: '廣島', city: 'hiroshima', country: 'JP', lat: 34.44, lon: 132.92, annualPaxM: 2.8, inRegionShare: 0.95, slotCap: 70, maxClass: 'widebody' },
  { code: 'KMJ', name: '熊本', city: 'kumamoto', country: 'JP', lat: 32.84, lon: 130.86, annualPaxM: 3.2, inRegionShare: 0.95, slotCap: 70, maxClass: 'widebody' },
  { code: 'KOJ', name: '鹿兒島', city: 'kagoshima', country: 'JP', lat: 31.8, lon: 130.72, annualPaxM: 5.5, inRegionShare: 0.95, slotCap: 70, maxClass: 'widebody' },
  { code: 'NGS', name: '長崎', city: 'nagasaki', country: 'JP', lat: 32.92, lon: 129.91, annualPaxM: 3.2, inRegionShare: 0.95, slotCap: 70, maxClass: 'narrowbody' },
  { code: 'MYJ', name: '松山(愛媛)', city: 'matsuyama', country: 'JP', lat: 33.83, lon: 132.7, annualPaxM: 3.0, inRegionShare: 0.95, slotCap: 70, maxClass: 'narrowbody' },
  { code: 'ISG', name: '石垣', city: 'ishigaki', country: 'JP', lat: 24.4, lon: 124.25, annualPaxM: 2.6, inRegionShare: 1, slotCap: 42, maxClass: 'narrowbody' },
  { code: 'UKB', name: '神戶', city: 'osaka', country: 'JP', lat: 34.63, lon: 135.22, annualPaxM: 3.2, inRegionShare: 1, slotCap: 42, maxClass: 'narrowbody', intlWeight: 0 },
];

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

/** Bases the player can start from. */
export const BASES = ['TPE', 'KHH', 'HKG', 'KIX', 'FUK', 'HND'];
