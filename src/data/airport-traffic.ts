// Rounded 2024 annual terminal passengers, millions. Historical calibration anchors,
// not live statistics or origin/destination counts (connections are included).
// ACI: https://aci.aero/2025/07/08/worlds-busiest-airports-revealed-in-final-global-rankings/
// New York: https://www.panynj.gov/content/dam/airports/statistics/statistics-general-info/annual-atr/ATR_2024.pdf
// LAX: https://www.lawa.org/media/45736
export const ANNUAL_TRAFFIC_M: Readonly<Record<string, number>> = {
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
