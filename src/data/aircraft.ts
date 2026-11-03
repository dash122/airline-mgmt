// Real aircraft types. Seats are typical airline layouts; costs are game placeholders (NT$).

/** Runway size class: which airports a type can use. */
export type AircraftClass = 'turboprop' | 'regional' | 'narrowbody' | 'widebody';
export const CLASS_ORDER: AircraftClass[] = ['turboprop', 'regional', 'narrowbody', 'widebody'];
export const CLASS_NAMES: Record<AircraftClass, string> = { turboprop: '渦輪螺旋槳', regional: '區域噴射機', narrowbody: '窄體客機', widebody: '廣體客機' };
export const classRank = (c: AircraftClass) => CLASS_ORDER.indexOf(c);

export interface AircraftSpec {
  id: string;
  name: string;
  cls: AircraftClass;
  seats: number;
  rangeKm: number;
  speedKmh: number;
  /** Minimum minutes on the ground between flights. */
  turnMin: number;
  /** Lease cost per week, paid whether the aircraft flies or not. */
  ownershipPerWeek: number;
  /** Fuel, crew and maintenance per block hour. */
  costPerBlockHour: number;
  /** Airport and handling fees per departure. */
  costPerDeparture: number;
}

const spec = (s: AircraftSpec) => s;

export const AIRCRAFT = {
  ATR72: spec({ id: 'ATR72', name: 'ATR 72-600', cls: 'turboprop', seats: 70, rangeKm: 1500, speedKmh: 510, turnMin: 25, ownershipPerWeek: 1_100_000, costPerBlockHour: 38_000, costPerDeparture: 10_000 }),
  Q400: spec({ id: 'Q400', name: 'Dash 8-400', cls: 'turboprop', seats: 78, rangeKm: 2000, speedKmh: 600, turnMin: 25, ownershipPerWeek: 1_400_000, costPerBlockHour: 46_000, costPerDeparture: 11_000 }),
  E190: spec({ id: 'E190', name: 'Embraer E190', cls: 'regional', seats: 100, rangeKm: 4000, speedKmh: 820, turnMin: 35, ownershipPerWeek: 2_200_000, costPerBlockHour: 75_000, costPerDeparture: 20_000 }),
  B738: spec({ id: 'B738', name: 'Boeing 737-800', cls: 'narrowbody', seats: 186, rangeKm: 5400, speedKmh: 830, turnMin: 40, ownershipPerWeek: 3_200_000, costPerBlockHour: 132_000, costPerDeparture: 34_000 }),
  B38M: spec({ id: 'B38M', name: 'Boeing 737 MAX 8', cls: 'narrowbody', seats: 178, rangeKm: 6500, speedKmh: 830, turnMin: 40, ownershipPerWeek: 4_200_000, costPerBlockHour: 116_000, costPerDeparture: 33_000 }),
  A20N: spec({ id: 'A20N', name: 'Airbus A320neo', cls: 'narrowbody', seats: 180, rangeKm: 6300, speedKmh: 830, turnMin: 40, ownershipPerWeek: 4_300_000, costPerBlockHour: 117_000, costPerDeparture: 33_000 }),
  A21N: spec({ id: 'A21N', name: 'Airbus A321neo', cls: 'narrowbody', seats: 220, rangeKm: 7400, speedKmh: 830, turnMin: 45, ownershipPerWeek: 5_200_000, costPerBlockHour: 135_000, costPerDeparture: 38_000 }),
  A333: spec({ id: 'A333', name: 'Airbus A330-300', cls: 'widebody', seats: 300, rangeKm: 11700, speedKmh: 870, turnMin: 70, ownershipPerWeek: 7_800_000, costPerBlockHour: 210_000, costPerDeparture: 55_000 }),
  B789: spec({ id: 'B789', name: 'Boeing 787-9', cls: 'widebody', seats: 290, rangeKm: 14000, speedKmh: 900, turnMin: 70, ownershipPerWeek: 9_000_000, costPerBlockHour: 195_000, costPerDeparture: 55_000 }),
  A359: spec({ id: 'A359', name: 'Airbus A350-900', cls: 'widebody', seats: 320, rangeKm: 15000, speedKmh: 900, turnMin: 75, ownershipPerWeek: 10_000_000, costPerBlockHour: 215_000, costPerDeparture: 60_000 }),
  B772: spec({ id: 'B772', name: 'Boeing 777-200ER', cls: 'widebody', seats: 310, rangeKm: 13000, speedKmh: 890, turnMin: 75, ownershipPerWeek: 7_500_000, costPerBlockHour: 250_000, costPerDeparture: 60_000 }),
  B77W: spec({ id: 'B77W', name: 'Boeing 777-300ER', cls: 'widebody', seats: 368, rangeKm: 13600, speedKmh: 890, turnMin: 80, ownershipPerWeek: 11_000_000, costPerBlockHour: 265_000, costPerDeparture: 70_000 }),
};

export type AircraftModel = keyof typeof AIRCRAFT;
export const MODEL_ORDER = Object.keys(AIRCRAFT) as AircraftModel[];
