export type AircraftClass = 'turboprop' | 'regional' | 'narrowbody' | 'widebody';

export interface AircraftSpec {
  id: AircraftClass;
  name: string;
  seats: number;
  rangeKm: number;
  speedKmh: number;
  /** Operating cost per block hour, NT$ (placeholder, to tune). */
  costPerBlockHour: number;
  /** Per-departure airport and handling fees, NT$ (placeholder). */
  costPerDeparture: number;
}

export const CLASS_ORDER: AircraftClass[] = ['turboprop', 'regional', 'narrowbody', 'widebody'];

export const AIRCRAFT: Record<AircraftClass, AircraftSpec> = {
  turboprop: { id: 'turboprop', name: '渦輪螺旋槳', seats: 70, rangeKm: 1500, speedKmh: 500, costPerBlockHour: 60_000, costPerDeparture: 10_000 },
  regional: { id: 'regional', name: '區域噴射機', seats: 100, rangeKm: 3000, speedKmh: 780, costPerBlockHour: 110_000, costPerDeparture: 20_000 },
  narrowbody: { id: 'narrowbody', name: '窄體客機', seats: 180, rangeKm: 6000, speedKmh: 830, costPerBlockHour: 190_000, costPerDeparture: 35_000 },
  widebody: { id: 'widebody', name: '廣體客機', seats: 320, rangeKm: 13000, speedKmh: 880, costPerBlockHour: 340_000, costPerDeparture: 60_000 },
};

export const classRank = (c: AircraftClass) => CLASS_ORDER.indexOf(c);
