// The few hand-set numbers behind the demand model. Everything else comes from open data.
// Annual air passengers in each group of markets, millions, counting both directions.
// APPROXIMATE (about 2024), to be replaced with sourced statistics.
export const AIR_TARGETS_M: Record<string, number> = {
  'JP-JP': 100, // Japan domestic
  'TW-TW': 5.5, // Taiwan domestic incl. outlying islands
  'JP-TW': 14,
  'HK-TW': 6,
  'HK-JP': 6.5,
  'MO-TW': 1.5,
  'JP-MO': 0.6,
  'HK-MO': 0.05, // almost everyone takes the bridge or ferry
};

/** Relative propensity to travel, by country (income and travel habits). */
export const TRAVEL_PROPENSITY: Record<string, number> = { JP: 1, TW: 1, HK: 1.4, MO: 1.2 };

/** Island residents and visitors rely on flights, so islands generate more air trips per person. */
export const ISLAND_PROPENSITY = 2.5;

/** Exponent on each city's size in the gravity model (below 1 so megacities don't swamp everything). */
export const MASS_EXPONENT = 0.85;
/** Exponent on distance in the gravity model. */
export const DISTANCE_EXPONENT = 0.9;

/** Ground travel: speeds (km/h) and fares (NT$ per km) on the road or rail route (1.25 x straight line). */
export const GROUND = {
  detour: 1.25,
  accessHours: 0.75,
  hsr: { speed: 230, farePerKm: 4.5, comfort: 0.5, name: '高鐵/新幹線' }, // city-centre stations, no security
  conventional: { speed: 75, farePerKm: 2.2, comfort: 0, name: '鐵路/公路' },
  bridge: { hours: 1.5, fare: 450, comfort: 0.3, name: '港珠澳大橋/渡輪' }, // Hong Kong - Macau
  ferry: { speed: 35, farePerKm: 3, maxKm: 120, comfort: -1, name: '渡輪' }, // weather, seasickness, few sailings
};
