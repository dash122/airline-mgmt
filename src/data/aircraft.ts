// Real aircraft types. Seats are typical airline layouts; costs are rough real-world figures in NT$
// (market lease rates, and fuel, crew and maintenance per block hour at about NT$32 per US$).

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
  /** Runway length both ends must have, beyond what the size class requires (the A380 needs about 3 km). */
  minRunwayM?: number;
}

const spec = (s: AircraftSpec) => s;

export const AIRCRAFT = {
  ATR72: spec({ id: 'ATR72', name: 'ATR 72-600', cls: 'turboprop', seats: 70, rangeKm: 1500, speedKmh: 510, turnMin: 25, ownershipPerWeek: 1_450_000, costPerBlockHour: 42_000, costPerDeparture: 8_000 }),
  Q400: spec({ id: 'Q400', name: 'Dash 8-400', cls: 'turboprop', seats: 78, rangeKm: 2000, speedKmh: 600, turnMin: 25, ownershipPerWeek: 1_550_000, costPerBlockHour: 58_000, costPerDeparture: 9_000 }),
  E190: spec({ id: 'E190', name: 'Embraer E190', cls: 'regional', seats: 100, rangeKm: 4000, speedKmh: 820, turnMin: 35, ownershipPerWeek: 1_400_000, costPerBlockHour: 83_000, costPerDeparture: 15_000 }),
  B738: spec({ id: 'B738', name: 'Boeing 737-800', cls: 'narrowbody', seats: 186, rangeKm: 5400, speedKmh: 830, turnMin: 40, ownershipPerWeek: 2_000_000, costPerBlockHour: 115_000, costPerDeparture: 28_000 }),
  B38M: spec({ id: 'B38M', name: 'Boeing 737 MAX 8', cls: 'narrowbody', seats: 178, rangeKm: 6500, speedKmh: 830, turnMin: 40, ownershipPerWeek: 2_900_000, costPerBlockHour: 99_000, costPerDeparture: 27_000 }),
  A20N: spec({ id: 'A20N', name: 'Airbus A320neo', cls: 'narrowbody', seats: 180, rangeKm: 6300, speedKmh: 830, turnMin: 40, ownershipPerWeek: 2_900_000, costPerBlockHour: 96_000, costPerDeparture: 27_000 }),
  A21N: spec({ id: 'A21N', name: 'Airbus A321neo', cls: 'narrowbody', seats: 220, rangeKm: 7400, speedKmh: 830, turnMin: 45, ownershipPerWeek: 3_400_000, costPerBlockHour: 112_000, costPerDeparture: 32_000 }),
  A333: spec({ id: 'A333', name: 'Airbus A330-300', cls: 'widebody', seats: 300, rangeKm: 11700, speedKmh: 870, turnMin: 70, ownershipPerWeek: 4_600_000, costPerBlockHour: 208_000, costPerDeparture: 55_000 }),
  B789: spec({ id: 'B789', name: 'Boeing 787-9', cls: 'widebody', seats: 290, rangeKm: 14000, speedKmh: 900, turnMin: 70, ownershipPerWeek: 8_200_000, costPerBlockHour: 192_000, costPerDeparture: 55_000 }),
  A359: spec({ id: 'A359', name: 'Airbus A350-900', cls: 'widebody', seats: 320, rangeKm: 15000, speedKmh: 900, turnMin: 75, ownershipPerWeek: 8_400_000, costPerBlockHour: 208_000, costPerDeparture: 60_000 }),
  B772: spec({ id: 'B772', name: 'Boeing 777-200ER', cls: 'widebody', seats: 310, rangeKm: 13000, speedKmh: 890, turnMin: 75, ownershipPerWeek: 3_200_000, costPerBlockHour: 256_000, costPerDeparture: 62_000 }),
  B77W: spec({ id: 'B77W', name: 'Boeing 777-300ER', cls: 'widebody', seats: 368, rangeKm: 13600, speedKmh: 890, turnMin: 80, ownershipPerWeek: 6_200_000, costPerBlockHour: 282_000, costPerDeparture: 70_000 }),
  // Added later: the wider range of types a planner can lease. Seats are typical two- or three-class layouts.
  A21X: spec({ id: 'A21X', name: 'Airbus A321XLR', cls: 'narrowbody', seats: 210, rangeKm: 8700, speedKmh: 830, turnMin: 45, ownershipPerWeek: 3_700_000, costPerBlockHour: 116_000, costPerDeparture: 33_000 }),
  BCS3: spec({ id: 'BCS3', name: 'Airbus A220-300', cls: 'narrowbody', seats: 140, rangeKm: 6300, speedKmh: 830, turnMin: 35, ownershipPerWeek: 2_200_000, costPerBlockHour: 74_000, costPerDeparture: 21_000 }),
  E75L: spec({ id: 'E75L', name: 'Embraer E175', cls: 'regional', seats: 78, rangeKm: 4100, speedKmh: 830, turnMin: 30, ownershipPerWeek: 1_200_000, costPerBlockHour: 60_000, costPerDeparture: 11_000 }),
  A339: spec({ id: 'A339', name: 'Airbus A330-900neo', cls: 'widebody', seats: 290, rangeKm: 13300, speedKmh: 870, turnMin: 70, ownershipPerWeek: 5_000_000, costPerBlockHour: 185_000, costPerDeparture: 52_000 }),
  B78X: spec({ id: 'B78X', name: 'Boeing 787-10', cls: 'widebody', seats: 330, rangeKm: 11750, speedKmh: 900, turnMin: 75, ownershipPerWeek: 8_000_000, costPerBlockHour: 205_000, costPerDeparture: 57_000 }),
  A35K: spec({ id: 'A35K', name: 'Airbus A350-1000', cls: 'widebody', seats: 350, rangeKm: 16100, speedKmh: 900, turnMin: 80, ownershipPerWeek: 9_000_000, costPerBlockHour: 225_000, costPerDeparture: 65_000 }),
  B779: spec({ id: 'B779', name: 'Boeing 777-9', cls: 'widebody', seats: 400, rangeKm: 13650, speedKmh: 890, turnMin: 85, ownershipPerWeek: 9_000_000, costPerBlockHour: 290_000, costPerDeparture: 72_000 }),
  A388: spec({ id: 'A388', name: 'Airbus A380-800', cls: 'widebody', seats: 480, rangeKm: 15400, speedKmh: 900, turnMin: 110, ownershipPerWeek: 9_500_000, costPerBlockHour: 330_000, costPerDeparture: 85_000, minRunwayM: 3000 }),
};

export type AircraftModel = keyof typeof AIRCRAFT;
export const MODEL_ORDER = Object.keys(AIRCRAFT) as AircraftModel[];
