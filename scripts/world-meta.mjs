// Hand-kept facts for the airports outside Taiwan, Hong Kong, Macau and Japan: which world region each
// country is in, and which cities have high-speed rail. Approximate; extend as needed.

/** The four places with fully hand-curated airports (names, metros, tiers) in airport-meta.mjs. */
export const CURATED = ['TW', 'HK', 'MO', 'JP'];

/** World regions used for calibration groups: EA East Asia, SEA Southeast Asia, SAS South and Central Asia,
 *  ME Middle East and Caucasus, EU Europe incl. Russia, AF Africa, NA North America, LAT Latin America
 *  and the Caribbean, OC Oceania. */
const R = (region, codes) => Object.fromEntries(codes.split(' ').map((c) => [c, region]));
export const REGION_OF = {
  ...R('EA', 'JP TW HK MO KR KP CN MN'),
  ...R('SEA', 'SG MY TH VN PH ID KH LA MM BN TL'),
  ...R('SAS', 'IN PK BD LK NP BT MV AF KZ UZ TM KG TJ'),
  ...R('ME', 'AE SA QA KW BH OM YE IQ IR IL JO LB SY TR AM AZ GE CY PS'),
  ...R('EU', 'GB IE FR DE ES PT IT NL BE LU CH AT DK SE NO FI IS PL CZ SK HU RO BG GR HR SI RS BA ME MK AL XK MD UA BY LT LV EE MT RU FO GI IM JE GG AD MC LI SM VA'),
  ...R('NA', 'US CA MX GL BM PM'),
  ...R('LAT', 'BR AR CL CO PE VE EC BO PY UY GY SR GF CU DO HT JM BS BB TT PR PA CR GT HN SV NI BZ AW CW SX MQ GP KY TC VG VI AG DM GD KN LC VC AI MF BL BQ'),
  ...R('OC', 'AU NZ PG FJ NC PF WS TO VU SB KI FM MH PW NR TV CK GU MP AS NU WF'),
};
// Everything else (Africa) falls back to the continent in OurAirports.

/** Countries big enough that domestic travel is its own calibration group. */
export const DOMESTIC = ['US', 'CN', 'IN', 'BR', 'RU', 'ID', 'JP', 'TW'];

/** Airports on high-speed rail lines outside the curated four places. */
export const HSR_WORLD = new Set((
  // China
  'PEK PKX SHA PVG CAN SZX CTU TFU CKG WUH CSX NKG HGH XIY TAO TSN SHE DLC HRB CGO KMG KWE NNG FOC XMN HFE NGB WNZ SJW TYN CGQ TNA NCG KHN ' +
  // Korea
  'ICN GMP PUS TAE KWJ USN ' +
  // France, Spain, Italy, Germany, Benelux, Switzerland, Austria
  'CDG ORY LYS MRS NCE BOD NTE LIL SXB TLS MPL RNS MAD BCN SVQ VLC AGP ZAZ FCO CIA MXP LIN BLQ FLR NAP VCE TRN ' +
  'FRA MUC HAM DUS CGN STR BER LEJ NUE HAJ AMS BRU RTM ZRH GVA BSL VIE SZG ' +
  // Turkey, Saudi Arabia, Morocco, Uzbekistan, Russia, Sweden, US Northeast Corridor
  'IST SAW ESB JED MED CMN TNG TAS SKD LED SVO DME VKO ARN GOT BOS JFK EWR LGA PHL BWI DCA IAD'
).split(' '));

/** Hand-set country-level travel propensity relative to Japan = 1 (income and travel habits). Default 0.6. */
export const PROPENSITY = {
  ...Object.fromEntries('US CA AU NZ GB IE DE FR NL BE LU CH AT DK SE NO FI IS IL SG KR AE QA KW BH SA'.split(' ').map((c) => [c, 1.4])),
  ...Object.fromEntries('ES IT PT GR CZ PL HU HR SI SK EE LT LV MT CY OM RU TR MY CN CL AR UY PA CR MX BR RO BG RS'.split(' ').map((c) => [c, 0.9])),
  ...Object.fromEntries('IN PK BD LK NP ID PH VN KH LA MM EG MA DZ TN NG KE ET TZ UG GH SN CI CM AO MZ ZM ZW MG'.split(' ').map((c) => [c, 0.4])),
};

/** The world's busiest airports by real traffic. They are always hubs, whatever their catchment says. */
export const WORLD_HUBS = new Set((
  'ATL DFW DEN ORD LAX JFK LAS MCO MIA SEA SFO CLT PHX IAH EWR BOS DTW MSP YYZ YVR MEX BOG SCL GRU LIM EZE PTY ' +
  'LHR CDG AMS FRA MAD IST FCO MUC BCN ZRH LGW DUB CPH ARN OSL HEL VIE BRU LIS SVO ' +
  'DXB DOH AUH RUH JED TLV CAI ADD JNB LOS NBO CMN ' +
  'SIN BKK KUL CGK MNL SGN ICN PEK PVG CAN CTU SZX DEL BOM BLR SYD MEL AKL'
).split(' '));
