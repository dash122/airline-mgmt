export type AircraftClass = 'turboprop' | 'regional' | 'narrowbody' | 'widebody';

export interface AircraftSpec {
  id: AircraftClass;
  name: string;
  seats: number;
  rangeKm: number;
  speedKmh: number;
  /** Minimum minutes on the ground between flights. */
  turnMin: number;
  /** Lease and ownership cost per week, NT$, paid whether the aircraft flies or not (placeholder). */
  ownershipPerWeek: number;
  /** Fuel, crew and maintenance per block hour, NT$ (placeholder). */
  costPerBlockHour: number;
  /** Airport and handling fees per departure, NT$ (placeholder). */
  costPerDeparture: number;
}

export const CLASS_ORDER: AircraftClass[] = ['turboprop', 'regional', 'narrowbody', 'widebody'];

export const AIRCRAFT: Record<AircraftClass, AircraftSpec> = {
  turboprop: { id: 'turboprop', name: '渦輪螺旋槳', seats: 70, rangeKm: 1500, speedKmh: 500, turnMin: 25, ownershipPerWeek: 1_200_000, costPerBlockHour: 40_000, costPerDeparture: 10_000 },
  regional: { id: 'regional', name: '區域噴射機', seats: 100, rangeKm: 3000, speedKmh: 780, turnMin: 35, ownershipPerWeek: 2_200_000, costPerBlockHour: 75_000, costPerDeparture: 20_000 },
  narrowbody: { id: 'narrowbody', name: '窄體客機', seats: 180, rangeKm: 6000, speedKmh: 830, turnMin: 45, ownershipPerWeek: 4_500_000, costPerBlockHour: 125_000, costPerDeparture: 35_000 },
  widebody: { id: 'widebody', name: '廣體客機', seats: 320, rangeKm: 13000, speedKmh: 880, turnMin: 75, ownershipPerWeek: 9_000_000, costPerBlockHour: 220_000, costPerDeparture: 60_000 },
};

export const classRank = (c: AircraftClass) => CLASS_ORDER.indexOf(c);
