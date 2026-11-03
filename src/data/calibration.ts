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
  // Large domestic markets
  'US-US': 750, 'CN-CN': 700, 'IN-IN': 160, 'BR-BR': 90, 'RU-RU': 100, 'ID-ID': 80,
  // Within a world region (all other countries; EA = East Asia, SEA = Southeast Asia, SAS = South and Central Asia,
  // ME = Middle East, EU = Europe, AF = Africa, NA = North America, LAT = Latin America, OC = Oceania)
  'EU-EU': 950, 'NA-NA': 200, 'EA-EA': 150, 'SEA-SEA': 230, 'SAS-SAS': 70, 'ME-ME': 90, 'AF-AF': 60, 'LAT-LAT': 150, 'OC-OC': 70,
  // Between world regions
  'EU-NA': 110, 'EA-EU': 45, 'EU-ME': 90, 'EU-SAS': 40, 'AF-EU': 80, 'EU-SEA': 30, 'EU-LAT': 35, 'EU-OC': 6,
  'EA-NA': 40, 'LAT-NA': 85, 'ME-NA': 10, 'NA-SAS': 8, 'NA-OC': 10, 'AF-NA': 4, 'NA-SEA': 7,
  'EA-SEA': 100, 'EA-OC': 15, 'EA-SAS': 15, 'EA-ME': 12, 'OC-SEA': 30, 'SAS-SEA': 30, 'ME-SEA': 25,
  'ME-SAS': 80, 'AF-ME': 35, 'ME-OC': 5, 'OC-SAS': 8, 'AF-SAS': 6, 'AF-EA': 5, 'AF-SEA': 3,
};
/** Groups with no target above are small markets. */
export const DEFAULT_TARGET_M = 0.3;

/** Countries whose domestic travel is its own group, and the places with hand-kept country-pair groups. */
export const DOMESTIC_COUNTRIES = ['US', 'CN', 'IN', 'BR', 'RU', 'ID', 'JP', 'TW'];
export const COUNTRY_GROUPS = ['TW', 'HK', 'MO', 'JP'];


/** Relative propensity to travel, by country (income and travel habits). */
export const TRAVEL_PROPENSITY: Record<string, number> = {
  JP: 1, TW: 1, HK: 1.4, MO: 1.2,
  ...Object.fromEntries('US CA AU NZ GB IE DE FR NL BE LU CH AT DK SE NO FI IS IL SG KR AE QA KW BH SA'.split(' ').map((c) => [c, 1.4])),
  ...Object.fromEntries('ES IT PT GR CZ PL HU HR SI SK EE LT LV MT CY OM RU TR MY CN CL AR UY PA CR MX BR RO BG RS'.split(' ').map((c) => [c, 0.9])),
};
/** Everywhere else (lower incomes). */
export const DEFAULT_PROPENSITY = 0.45;

/** Island residents and visitors rely on flights, so islands generate more air trips per person. */
export const ISLAND_PROPENSITY = 2.5;

/** Exponent on each city's size in the gravity model (below 1 so megacities don't swamp everything). */
export const MASS_EXPONENT = 0.85;
/** Same, elsewhere: lower, so the biggest metros (New York, Delhi) don't swallow whole countries' air travel. */
export const WORLD_MASS_EXPONENT = 0.7;
/** Exponent on distance in the gravity model. */
export const DISTANCE_EXPONENT = 0.9;
/** Same, for pairs outside the four hand-kept places (calibrated against country totals, trips are spread more evenly). */
export const WORLD_DISTANCE_EXPONENT = 0.6;

/** Ground travel: speeds (km/h) and fares (NT$ per km) on the road or rail route (1.25 x straight line). */
export const GROUND = {
  detour: 1.25,
  accessHours: 0.75,
  hsr: { speed: 230, farePerKm: 4.5, comfort: 0.5, name: '高鐵/新幹線' }, // city-centre stations, no security
  conventional: { speed: 75, farePerKm: 2.2, comfort: 0, name: '鐵路/公路' },
  bridge: { hours: 1.5, fare: 450, comfort: 0.3, name: '港珠澳大橋/渡輪' }, // Hong Kong - Macau
  ferry: { speed: 35, farePerKm: 3, maxKm: 120, comfort: -1, name: '渡輪' }, // weather, seasickness, few sailings
};
