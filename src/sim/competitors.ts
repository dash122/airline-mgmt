// Competitor airlines. They are fictional and generated from the airport and market data, so they work
// for any set of airports. They fly fixed schedules and do not react to the player: each market's
// existing service (Market.rivalFreq) is split between the airlines that would plausibly fly it.
import { AIRCRAFT, classRank, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../data/airports';
import { ANNUAL_TRAFFIC_M } from '../data/airport-traffic';
import { departureQuality } from './choice';
import { flightMinutes } from './flighttime';
import { distanceKm } from './geo';
import { isLeisureAirport, LONG_HAUL_KM, marketBetween, marketsAt, pairKey, rivalPaxPerFlight, type Market } from './markets';

export type AirlineKind = 'full' | 'low' | 'regional';

export interface Airline {
  id: string;
  name: string;
  kind: AirlineKind;
  country: string;
  color: string;
  /** Airports it runs flights from. The first is its main hub. */
  bases: string[];
  /** Its fares as a multiple of the market reference fare. */
  fareMult: number;
  /** How much travellers value its product, in NT$ per trip (service, seats, lounges, reliability). */
  quality: number;
  /** The aircraft types it operates: its own mix of makers and sizes, so rivals differ in what they fly. */
  fleet: AircraftModel[];
}

/** One airline's service in one direction of a market. */
export interface RivalService {
  airline: Airline;
  from: string;
  to: string;
  /** Flights a week in this direction. */
  freq: number;
  /** Local departure times (minutes after midnight); with fewer than 7 flights a week, one time used on some days. */
  times: number[];
  /** Flights a week weighted by how attractive their departure times are. */
  effFreq: number;
  fare: number;
  type: AircraftModel;
}

export const KIND_NAMES: Record<AirlineKind, string> = { full: '全服務', low: '廉價', regional: '區域' };

const KIND_SETTINGS: Record<AirlineKind, { fareMult: number; quality: number; fleet: AircraftModel[]; maxKm: number }> = {
  full: { fareMult: 1.1, quality: 400, fleet: ['A20N', 'A21N', 'B789', 'A359', 'B77W'], maxKm: 15000 },
  low: { fareMult: 0.78, quality: -500, fleet: ['A20N', 'A21N', 'A333'], maxKm: 4500 },
  regional: { fareMult: 1, quality: 0, fleet: ['ATR72', 'Q400', 'E190'], maxKm: 1200 },
};

/**
 * An airline's own fleet, picked by a hash of its id. Real airlines standardise on one maker's family (an A320 or a
 * 737 operator, an Airbus or Boeing widebody one) and fill the gaps with a smaller jet, so the mix differs between
 * airlines. A flagship A380 goes to a few big-hub full-service airlines whose main hub has the runway for it.
 */
function houseFleet(id: string, kind: AirlineKind, bases: string[]): AircraftModel[] {
  const pick = <T,>(tag: string, xs: T[]) => xs[hash(`${id}${tag}`) % xs.length];
  const airbus = hash(`${id}narrow`) % 2 === 0;
  switch (kind) {
    case 'full': {
      const narrow: AircraftModel[] = airbus ? ['A20N', 'A21N'] : ['B738', 'B38M'];
      if (hash(`${id}small`) % 2 === 0) narrow.unshift('BCS3');
      const wide: AircraftModel[] = pick('wide', [['A339', 'A359', 'A35K'], ['B789', 'B78X', 'B77W'], ['A333', 'A359', 'B77W'], ['B772', 'B789', 'B779'], ['A333', 'B789', 'A35K']]);
      const hub = AIRPORT_BY_CODE[bases[0]];
      const flagship = hub && hub.runwayM >= 3000 && trafficOf(hub) >= 40 && hash(`${id}a380`) % 3 === 0;
      return [...narrow, ...(airbus && hash(`${id}xlr`) % 2 === 0 ? ['A21X' as const] : []), ...wide, ...(flagship ? ['A388' as const] : [])];
    }
    case 'low':
      return [...(airbus ? ['A20N', 'A21N'] as const : ['B738', 'B38M'] as const), ...(airbus && hash(`${id}xlr`) % 2 === 0 ? ['A21X' as const] : []), pick('wide', ['A333', 'A339'] as AircraftModel[])];
    case 'regional':
      return [pick('prop', ['ATR72', 'Q400'] as AircraftModel[]), pick('jet', ['E75L', 'E190'] as AircraftModel[]), ...(hash(`${id}both`) % 3 === 0 ? ['Q400' as const] : [])];
  }
}

// Fictional names, picked to sound like they belong where the airline is based (shown in Traditional Chinese, as
// the rest of the game). Kept clear of real airline names.
export type NameArea = 'sino' | 'japan' | 'korea' | 'seasia' | 'southasia' | 'mideast' | 'steppe' | 'europe' | 'africa' | 'northam' | 'latam' | 'oceania';
type Pools = Record<AirlineKind, string[]>;

export const NAME_POOLS: Record<NameArea, Pools> = {
  sino: {
    full: ['雲帆', '海燕', '晨曦', '青嵐', '長風', '銀翼', '紅鶴', '白鷺', '曙光', '朱鷺', '南星', '碧海', '蒼穹', '晴空', '旭日', '玉蘭', '松濤', '琥珀', '月桂', '翠羽', '星河', '錦帆'],
    low: ['樂翔', '輕羽', '跳島', '好旅', '嗨飛', '微風', '啾啾', '小步', '輕舟', '彩虹', '泡泡', '飛跳'],
    regional: ['群島', '山海', '澄海', '海峽', '岬角', '環島', '列嶼', '溪谷'],
  },
  japan: { full: ['青葉', '朝凪', '紫雲', '瑞雲', '千鳥', '若竹', '櫻花', '月見'], low: ['蒲公英', '鈴蘭', '金魚', '小鞠'], regional: ['瀨戶', '島風', '里山', '海猫'] },
  korea: { full: ['白頭', '漢拏', '無窮花', '青瓷', '鶴林'], low: ['喜鵲', '小松鼠', '柿子'], regional: ['多島', '海松', '山茶'] },
  seasia: {
    full: ['椰風', '蘭花', '稻浪', '湄公', '婆羅', '熱帶', '雞蛋花'],
    low: ['小椰', '跳跳象', '香蕉', '浪花', '榴槤', '小犀鳥'], regional: ['列島', '海灣', '漁港', '稻田'],
  },
  southasia: { full: ['蓮花', '菩提', '茉莉', '香料', '紗麗', '象牙'], low: ['小象', '薑黃', '芒果'], regional: ['河谷', '山城', '茶園'] },
  mideast: { full: ['新月', '駝鈴', '乳香', '沙漠玫瑰', '雪杉'], low: ['小駱駝', '沙鷗', '飛毯'], regional: ['綠谷', '沙丘', '海岸'] },
  steppe: { full: ['草原', '天山', '駿馬', '金鷹', '雪豹', '絲路'], low: ['小馬', '雲雀'], regional: ['牧場', '湖畔'] },
  europe: {
    full: ['橡樹', '石楠', '白鸛', '燕鷗', '薰衣草', '橄欖', '北海', '白樺', '琥珀海', '大西洋岸', '古堡', '葡萄園', '白崖', '冰川', '聖燈', '雄鹿', '銀鷗', '鐘塔', '月桂冠', '藍湖', '金麥', '玫瑰窗', '海岸松', '天鵝', '風車', '銀河港', '綠島', '紅松', '雪絨'],
    low: ['藍鴿', '金雀', '輕帆', '小燕', '飛鴿', '歐風', '微笑', '紅狐', '刺蝟', '松鼠', '小鹿', '跳蛙', '黃蜂', '紙鶴', '藍莓'],
    regional: ['湖區', '海岬', '山谷', '島鏈', '溪谷', '高原', '漁村', '古橋'],
  },
  africa: {
    full: ['金合歡', '猴麵包樹', '斑馬', '羚羊', '紅土', '大河', '落日', '角馬', '鳳凰木', '象群', '獵豹', '雨季', '紅鶴湖', '可可', '芒果樹'],
    low: ['跳羚', '小斑馬', '狐獴', '織布鳥', '蜂虎', '小河馬'], regional: ['草原', '綠谷', '湖畔', '沙洲', '高原湖'],
  },
  northam: { full: ['紅杉', '五大湖', '灰狼', '野牛', '阿帕拉契'], low: ['浣熊', '知更鳥', '野莓', '花栗鼠'], regional: ['松林', '海灣', '湖濱', '峽谷'] },
  latam: {
    full: ['蜂鳥', '巨嘴鳥', '仙人掌', '火山', '羽蛇', '藍海灣', '鳳梨', '可可樹', '雨燕', '金剛鸚鵡', '加勒比風', '珊瑚礁', '香蕉灣', '月亮島', '棕櫚', '海龜', '藍洞', '翡翠', '甘蔗', '朗姆'],
    low: ['鸚鵡', '小羊駝', '辣椒', '芒果', '蜂巢', '小樹懶', '跳跳豆'], regional: ['海灣', '島嶼', '高原', '漁港'],
  },
  oceania: {
    full: ['南十字', '珊瑚海', '藍山', '椰島', '信風', '環礁', '鸚鵡螺', '扶桑花', '海龜灣', '獨木舟', '星辰島', '鯨歌', '軍艦鳥', '礁湖', '火山島', '貝殼'],
    low: ['無尾熊', '小企鵝', '笑翠鳥', '袋熊'], regional: ['礁島', '群嶼', '內陸', '海角'],
  },
};

const AREA_COUNTRIES: Record<NameArea, string> = {
  sino: 'TW HK MO CN SG',
  japan: 'JP',
  korea: 'KR KP',
  seasia: 'PH MY TH ID VN KH LA MM BN TL',
  southasia: 'IN PK BD LK NP BT MV AF',
  mideast: 'AE IR YE JO SA SY BH IQ LB QA OM KW IL CY TR',
  steppe: 'KZ TM UZ KG TJ MN',
  europe: 'DK RU NO IS NL SE GR RO IT RS DE FR BA BG BY BE SK HU GB ES HR IE PT PL GI AT CH FI IM CZ LT SI LU MT MK XK LV MD ME AL EE UA FO GL GE AM AZ',
  africa: 'EG DZ NG CI GH ET MA MZ BW LY ZA CF GM BI ML BF SO GQ ZW CV CG GN BJ TZ TN CM SN YT UG KE EH CD SL DJ SS RW SD GA TG ZM MG MU LS AO MR TD NE GW LR RE SC SZ ST NA MW',
  northam: 'US CA BM',
  latam: 'MX CO AR PY CL PE BR VE BZ GF BO CU CW HT BQ AG AW BB BS KY GY GD GT JM CR DO NI SR TC TT GP PA HN SV PR KN VI VC SX LC MQ UY EC',
  oceania: 'AU NZ WS KI SB FM MH NC AS PF CK TO VU WF FJ PG GU MP PW CC',
};
/** Names tied to one country (its rivers, regions, landmarks), tried before the area's shared pool. */
export const COUNTRY_NAMES: Record<string, string[]> = {
  GB: ['高地', '泰晤士', '約克', '石楠原'], FR: ['塞納', '普羅旺斯', '布列塔尼', '勃艮第'], DE: ['萊茵', '易北', '巴伐利亞', '黑森林'],
  IT: ['托斯卡尼', '維蘇威', '亞平寧'], ES: ['卡斯提爾', '安達魯西亞', '庇里牛斯'], PT: ['杜羅', '里斯本灣'], NL: ['鬱金香', '低地'],
  RU: ['伏爾加', '白夜', '烏拉爾'], PL: ['維斯瓦', '琥珀'], AT: ['蒂羅爾', '多瑙'], CH: ['阿爾卑斯', '萊芒湖'], CZ: ['波希米亞', '伏爾塔瓦'],
  RO: ['喀爾巴阡', '多瑙三角洲'], GR: ['奧林帕斯', '橄欖海'], NO: ['峽灣', '午夜陽光'], SE: ['麋鹿', '群島海'], FI: ['千湖', '馴鹿'], IE: ['翡翠島', '三葉草'],
  US: ['白頭鷹', '洛磯', '大峽谷', '密西西比'], CA: ['楓葉', '北極熊', '育空'], MX: ['阿卡普科', '龍舌蘭'], BR: ['亞馬遜', '森巴', '伊瓜蘇'], AR: ['潘帕斯', '探戈', '巴塔哥尼亞'],
  PE: ['印加', '的的喀喀'], CL: ['安地斯雪', '阿塔卡馬'], CO: ['咖啡園', '翡翠'], AU: ['尤加利', '大堡礁', '烏魯魯'], NZ: ['奇異鳥', '銀蕨'],
  ZA: ['好望', '桌山'], EG: ['金字塔', '尼羅風'], KE: ['馬賽', '大裂谷'], MA: ['阿特拉斯', '藍城'], TZ: ['乞力馬扎羅'], NG: ['尼日爾河'],
  IN: ['恆河', '孔雀'], TH: ['金象', '湄南'], VN: ['蓮池', '下龍'], ID: ['千島', '婆羅浮屠'], PH: ['椰林', '珊瑚'], MY: ['雨林', '犀鳥'],
  TR: ['安納托利亞', '博斯普魯斯'], AE: ['金沙', '珍珠灣'], SA: ['綠洲', '椰棗'], IR: ['波斯玫瑰', '石榴'],
};

const AREA_OF = new Map<string, NameArea>(Object.entries(AREA_COUNTRIES).flatMap(([area, cs]) => cs.split(' ').map((c) => [c, area as NameArea] as const)));
/** Where an airline's name comes from: its country's part of the world (East Asian names where unknown). */
export const nameAreaOf = (country: string): NameArea => AREA_OF.get(country) ?? 'sino';
/** Characters for two-character names when an area's pools run out (金 + 羚 → 金羚), with a regional flavour. */
const COMBO_PARTS: Partial<Record<NameArea, [string[], string[]]>> = {
  europe: [['銀', '白', '藍', '北', '金', '橡', '松', '霧'], ['鷗', '鹿', '帆', '灣', '堡', '橋', '鷹', '原']],
  africa: [['金', '紅', '綠', '大', '晨', '暮', '沙', '銀'], ['羚', '鷹', '河', '原', '木', '岸', '日', '獅']],
  latam: [['金', '藍', '翠', '火', '晨', '日', '雨', '銀'], ['鸚', '鷹', '灣', '林', '峰', '島', '浪', '蝶']],
  mideast: [['金', '沙', '月', '珠', '綠', '白', '晨', '銀'], ['鷹', '駝', '泉', '灣', '棕', '星', '帆', '岸']],
};
const GENERIC_PARTS: [string[], string[]] = [['金', '銀', '藍', '晨', '青', '紅', '白', '星'], ['鷹', '帆', '灣', '雲', '林', '峰', '島', '翼']];
const comboCache = new Map<NameArea, string[]>();
const comboNames = (area: NameArea) => {
  let list = comboCache.get(area);
  if (!list) {
    const [pre, post] = COMBO_PARTS[area] ?? GENERIC_PARTS;
    comboCache.set(area, list = pre.flatMap((x) => post.map((y) => x + y)));
  }
  return list;
};
/** Added to a name when its area's pool runs out, so names stay unique without numbers. */
const NAME_SUFFIXES = ['之星', '之翼', '快線', '國際', '聯合'];
const COLORS = ['#c0392b', '#8e44ad', '#16a085', '#d35400', '#2c7be5', '#b8860b', '#6d4c41', '#00897b', '#c2185b', '#5e35b1', '#558b2f', '#0277bd', '#ef6c00', '#7b1fa2', '#2e7d32', '#ad1457'];

/** Small deterministic string hash. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A full-service airline's name: its country's own first, else one from its part of the world. */
function pickFullName(country: string, used: Set<string>): string {
  const own = COUNTRY_NAMES[country]?.find((n) => !used.has(n));
  if (own) { used.add(own); return own; }
  const area = nameAreaOf(country), p = NAME_POOLS[area];
  return pickName([p.full, p.regional, comboNames(area)], `${country}full`, used);
}


/** Country names are kept for their own country, so a neighbour never takes them first. */
let reserved: Set<string> | null = null;

/** The first free name in the pools, in order (a hashed start in each); then the first pool's names with a suffix. */
function pickName(pools: string[][], key: string, used: Set<string>): string {
  reserved ??= new Set(Object.values(COUNTRY_NAMES).flat());
  for (const pool of pools) {
    const start = hash(key) % pool.length;
    for (let i = 0; i < pool.length; i++) {
      const n = pool[(start + i) % pool.length];
      if (!used.has(n) && !reserved.has(n)) { used.add(n); return n; }
    }
  }
  // Pools used up: the same names with a suffix (橡樹 → 橡樹之星).
  const pool = pools[0];
  const start = hash(key) % pool.length;
  for (const suffix of NAME_SUFFIXES) {
    for (let i = 0; i < pool.length; i++) {
      const n = `${pool[(start + i) % pool.length]}${suffix}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
  }
  const n = `${pool[start]}${used.size}`;
  used.add(n);
  return n;
}

const SIZE_WEIGHT = { hub: 5, major: 4, large: 3, medium: 2, small: 1 } as const;
/** Annual passengers in millions, or 0 where the game has no figure. */
const trafficOf = (a: Airport) => ANNUAL_TRAFFIC_M[a.code] ?? 0;
/**
 * How busy an airport is: its real traffic first, then its size tier and catchment. Population alone made
 * Chongqing (whose municipality counts 32 million people) China's main hub instead of Shanghai, Guangzhou or Beijing.
 */
const busyness = (a: Airport) => trafficOf(a) * 1e9 + SIZE_WEIGHT[a.size] * 1e8 + a.catchment * a.tourism;

/** People in a country's airport catchments before it has a low-cost airline, and airports before it has a regional one. */
const LOW_COST_MIN_CATCHMENT = 10_000_000;
const REGIONAL_MIN_AIRPORTS = 4;
/**
 * A country's annual air passengers (millions) before it has a second and a third full-service airline, and a second
 * low-cost one. Japan, the UK and Spain get two full-service airlines; the US and China get three, each with its own
 * hubs, and two low-cost airlines.
 */
const SECOND_FULL_M = 250, THIRD_FULL_M = 600, SECOND_LOW_M = 600;
/** Annual passengers (millions) at a city's main airport before a full-service airline can make it a hub. */
const HUB_CITY_M = 25;
/**
 * Each full-service airline gets its own main hub only where the country's next hub city is at least this share of
 * the busiest one's traffic (Dallas and Denver next to Atlanta). Otherwise they share the main city: Osaka is far
 * smaller than Tokyo, so both Japanese airlines fly from Tokyo, as both British ones fly from London.
 */
const OWN_HUB_SHARE = 0.5;
/** Most cities a full-service airline runs as hubs or bases, and a low-cost airline as bases. */
const MAX_FULL_BASES = 5, MAX_LOW_BASES = 6;
/** Annual passengers (millions) a low-cost airline needs per base: a country with 120 million passengers gets 3. */
const LOW_BASE_PER_M = 40;

function buildAirlines(): Airline[] {
  const byCountry = new Map<string, Airport[]>();
  for (const a of AIRPORTS) byCountry.set(a.country, [...(byCountry.get(a.country) ?? []), a]);
  const countries = [...byCountry.keys()].sort();
  const used = new Set<string>();
  const out: Airline[] = [];
  const make = (country: string, kind: AirlineKind, n: number, bases: string[], name: string) => {
    const s = KIND_SETTINGS[kind];
    const id = n === 0 ? `${country}-${kind}` : `${country}-${kind}-${n + 1}`;
    out.push({ id, name, kind, country, color: COLORS[hash(id) % COLORS.length], bases, fareMult: s.fareMult, quality: s.quality, fleet: [...new Set(houseFleet(id, kind, bases))] });
  };
  for (const c of countries) {
    const list = [...byCountry.get(c)!].sort((x, y) => busyness(y) - busyness(x));
    // One airport per metro, busiest first.
    const metros: Airport[] = [];
    for (const a of list) if (!metros.some((m) => m.metro === a.metro)) metros.push(a);
    if (!metros.length) continue;
    const people = list.reduce((s, a) => s + a.catchment, 0);
    const traffic = list.reduce((s, a) => s + trafficOf(a), 0);
    // A city's big airports work as one base (Tokyo's Haneda and Narita, New York's JFK and Newark).
    const cityBase = (top: Airport) => [top.code, ...list.filter((a) => a.metro === top.metro && a.code !== top.code && a.size === top.size).map((a) => a.code)];

    // Full-service airlines. Where the country has a hub city for each, every airline gets its own main hub and the
    // other hub cities are dealt out in turn; otherwise they share the main city, as Japan's and the UK's do.
    const fullCount = traffic >= THIRD_FULL_M ? 3 : traffic >= SECOND_FULL_M ? 2 : 1;
    // Holiday airports (Mallorca) are low-cost and charter bases, not hubs.
    const hubCities = metros.filter((a) => trafficOf(a) >= HUB_CITY_M && !isLeisureAirport(a));
    const fullBases: Airport[][] = Array.from({ length: fullCount }, () => []);
    const ownHubs = fullCount > 1 && hubCities.length >= fullCount
      && trafficOf(hubCities[fullCount - 1]) >= OWN_HUB_SHARE * trafficOf(hubCities[0]);
    if (ownHubs) {
      hubCities.slice(0, fullCount * MAX_FULL_BASES).forEach((a, i) => fullBases[i % fullCount].push(a));
    } else {
      for (const b of fullBases) b.push(metros[0]);
      // A second city if it is nearly as big, as before.
      if (metros[1] && metros[1].size === metros[0].size && !isLeisureAirport(metros[1])) fullBases[0].push(metros[1]);
      hubCities.slice(1).forEach((a, i) => { const b = fullBases[i % fullCount]; if (!b.includes(a) && b.length < MAX_FULL_BASES) b.push(a); });
    }
    fullBases.forEach((b, n) => make(c, 'full', n, b.flatMap(cityBase), `${pickFullName(c, used)}航空`));

    // Low-cost airlines: bases in the busiest cities, more of them in bigger markets, dealt out between airlines.
    if (people > LOW_COST_MIN_CATCHMENT) {
      const lowCount = traffic >= SECOND_LOW_M ? 2 : 1;
      const perAirline = Math.max(3, Math.min(MAX_LOW_BASES, Math.round(traffic / LOW_BASE_PER_M / lowCount)));
      const lowBases: string[][] = Array.from({ length: lowCount }, () => []);
      metros.slice(0, perAirline * lowCount).forEach((a, i) => lowBases[i % lowCount].push(a.code));
      lowBases.forEach((b, n) => make(c, 'low', n, b, `${pickName([NAME_POOLS[nameAreaOf(c)].low, comboNames(nameAreaOf(c))], `${c}low${n || ''}`, used)}航空`));
    }
    const small = list.filter((a) => a.size === 'medium' || a.size === 'small');
    if (small.length >= REGIONAL_MIN_AIRPORTS) {
      make(c, 'regional', 0, list.map((a) => a.code), `${pickName([NAME_POOLS[nameAreaOf(c)].regional, NAME_POOLS[nameAreaOf(c)].full, comboNames(nameAreaOf(c))], `${c}regional`, used)}航空`);
    }
  }
  return out;
}

/** How strongly an airline would want to fly this market (0 = never). */
function appeal(al: Airline, a: Airport, b: Airport, distKm: number): number {
  const s = KIND_SETTINGS[al.kind];
  if (distKm > s.maxKm) return 0;
  const atBase = al.bases.includes(a.code) || al.bases.includes(b.code);
  const home = al.country === a.country || al.country === b.country;
  if (!home) return 0;
  const hub = al.bases[0] === a.code || al.bases[0] === b.code;
  switch (al.kind) {
    case 'full':
      return hub ? 1 : atBase ? 0.75 : 0;
    case 'low':
      // Low-cost airlines fly from their bases only; routes between two other cities go to the airline based nearest.
      return hub ? 0.8 : atBase ? 0.7 : 0;
    case 'regional': {
      if (a.country !== b.country || a.country !== al.country) return 0;
      const thin = [a, b].some((x) => x.size === 'medium' || x.size === 'small');
      return thin ? 1.2 : 0.15;
    }
  }
}

/** The home-country full-service or low-cost airline with a base closest to either end of a market. */
function nearestAirline(airlines: Airline[], A: Airport, B: Airport, distKm: number): Airline | undefined {
  let best: Airline | undefined, bestKm = Infinity;
  for (const al of airlines) {
    if (al.kind === 'regional' || distKm > KIND_SETTINGS[al.kind].maxKm || (al.country !== A.country && al.country !== B.country)) continue;
    for (const code of al.bases) {
      const base = AIRPORT_BY_CODE[code];
      const km = Math.min(distanceKm(base.lat, base.lon, A.lat, A.lon), distanceKm(base.lat, base.lon, B.lat, B.lon));
      // Full-service airlines win ties, so long routes from small cities stay with them.
      const score = km + (al.kind === 'low' ? 1 : 0);
      if (score < bestKm) { bestKm = score; best = al; }
    }
  }
  return best;
}

function canFly(type: AircraftModel, a: Airport, b: Airport, distKm: number): boolean {
  const s = AIRCRAFT[type];
  return distKm <= s.rangeKm && classRank(s.cls) <= Math.min(classRank(a.maxClass), classRank(b.maxClass))
    && (s.minRunwayM ?? 0) <= Math.min(a.runwayM, b.runwayM);
}

/** Low-cost airlines fly single-aisle jets, and widebodies only on longer routes (like the long-haul low-cost arms in Asia). */
const LOW_COST_WIDEBODY_KM = 2500;

/** Smallest aircraft in the airline's fleet that carries the expected load, or the largest that can fly it. */
function pickType(al: Airline, a: Airport, b: Airport, distKm: number, seatsNeeded: number): AircraftModel | null {
  const usable = (types: AircraftModel[]) => types
    .filter((t) => canFly(t, a, b, distKm) && !(al.kind === 'low' && AIRCRAFT[t].cls === 'widebody' && distKm < LOW_COST_WIDEBODY_KM)).sort((x, y) => AIRCRAFT[x].seats - AIRCRAFT[y].seats);
  // Its own fleet first; an airline without a suitable type there (a long route beyond its range) leases the kind's standard one.
  let fleet = usable(al.fleet);
  if (!fleet.length) fleet = usable(KIND_SETTINGS[al.kind].fleet);
  if (!fleet.length) return null;
  return fleet.find((t) => AIRCRAFT[t].seats >= seatsNeeded) ?? fleet[fleet.length - 1];
}


/** Departure times spread over the day, with a little jitter so airlines don't all leave together. */
function departureTimes(key: string, freq: number): number[] {
  const perDay = Math.max(1, Math.round(freq / 7));
  const first = 7 * 60, last = 21 * 60 + 30;
  const step = (last - first) / perDay;
  const out: number[] = [];
  for (let i = 0; i < perDay; i++) {
    const jitter = (hash(`${key}#${i}`) % 51) - 25;
    const time = Math.round((first + step * (i + 0.5) + jitter) / 5) * 5;
    out.push(Math.max(FIRST_DEP, Math.min(LAST_DEP, time)));
  }
  return out;
}

const DAY_MIN = 24 * 60;
const wrap = (min: number) => ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
const round5 = (min: number) => Math.round(min / 5) * 5;
/** Earliest and latest local departure a rival schedules. */
const FIRST_DEP = 6 * 60, LAST_DEP = 23 * 60 + 30;
/**
 * Departure waves at an airline's hubs and bases (local time). Flights in arrive about an hour before a wave and
 * flights out leave in it, so travellers can connect, as at real hubs.
 */
export const HUB_WAVES = [7 * 60 + 30, 10 * 60 + 30, 13 * 60 + 30, 16 * 60 + 30, 19 * 60 + 30];
/** Minutes before a wave that feeder flights land. */
const WAVE_FEED_MIN = 60;

/** Cruise speed of a rival's jet, for its timetable. */
const RIVAL_JET_KMH = 850;

/** Local arrival time (minutes after midnight) of a departure at `dep` local time. */
function arrivalLocal(from: Airport, to: Airport, dep: number): number {
  return wrap(dep + flightMinutes(from, to, RIVAL_JET_KMH) + to.utcOffset - from.utcOffset);
}

/**
 * `count` times from `slots`: spread out when there are fewer than slots (the middle one of each equal share), and
 * several to a slot, 25 minutes apart, when there are more (a busy route's flights in every wave).
 */
function spread(slots: number[], count: number): number[] {
  if (count <= slots.length) return Array.from({ length: count }, (_, i) => slots[Math.floor(((i + 0.5) * slots.length) / count)]);
  return Array.from({ length: count }, (_, i) => slots[i % slots.length] + Math.floor(i / slots.length) * 25);
}

/**
 * When a rival's flights leave, local time at `from`.
 * - Long-haul: the times travellers like best (`departureQuality`): late evening where that lands at a sensible
 *   hour, otherwise in the morning.
 * - From a hub or base: in its departure waves. Into one: landing about an hour before a wave.
 * - Elsewhere: spread over the day.
 */
function scheduleTimes(al: Airline, from: Airport, to: Airport, distKm: number, freq: number): number[] {
  const perDay = Math.max(1, Math.round(freq / 7));
  const key = `${al.id}${from.code}${to.code}`;
  const jitter = (i: number, span: number) => hash(`${key}#${i}`) % span;
  if (distKm > LONG_HAUL_KM) {
    const slots: { dep: number; q: number }[] = [];
    // Flight duration is independent of the departure slot. Computing it in
    // every slot repeats eight great-circle samples over 70 times per service.
    const duration = flightMinutes(from, to, RIVAL_JET_KMH) + to.utcOffset - from.utcOffset;
    for (let dep = FIRST_DEP; dep <= LAST_DEP; dep += 15) slots.push({ dep, q: departureQuality(dep, wrap(dep + duration), distKm) });
    // Best slots first, at least two hours apart.
    slots.sort((x, y) => y.q - x.q || x.dep - y.dep);
    const out: number[] = [];
    for (const s of slots) {
      if (out.length >= perDay) break;
      if (out.every((t) => Math.abs(t - s.dep) >= 120)) out.push(s.dep);
    }
    return out.map((t, i) => Math.min(LAST_DEP, round5(t + jitter(i, 40)))).sort((x, y) => x - y);
  }
  const within = (ts: number[]) => ts.map((t) => Math.min(LAST_DEP, Math.max(FIRST_DEP, round5(t)))).sort((x, y) => x - y);
  if (al.bases.includes(from.code)) return within(spread(HUB_WAVES, perDay).map((w, i) => w + jitter(i, 20)));
  if (al.bases.includes(to.code)) {
    // Times at `from` that land about an hour before each wave at the hub, where those are sensible local times.
    const block = flightMinutes(from, to, RIVAL_JET_KMH) + to.utcOffset - from.utcOffset;
    const feeds = HUB_WAVES.map((w) => wrap(w - WAVE_FEED_MIN - block)).filter((d) => d >= FIRST_DEP + 30 && d <= LAST_DEP - 60).sort((x, y) => x - y);
    if (feeds.length >= Math.min(perDay, 3)) return within(spread(feeds, perDay).map((d, i) => d - jitter(i, 20)));
  }
  return departureTimes(key, freq);
}

const OTHER: Airline = { id: 'other', name: '其他航空', kind: 'full', country: '', color: '#8a9aa6', bases: [], fareMult: 1, quality: 0, fleet: [] };
const AVERAGE_LOAD = 0.8;

function buildServices(airlines: Airline[], m: Market): RivalService[] {
  {
    if (m.rivalFreq <= 0) return [];
    const A = AIRPORT_BY_CODE[m.a], B = AIRPORT_BY_CODE[m.b];
    let cands = airlines.map((al) => ({ al, w: appeal(al, A, B, m.distKm) })).filter((x) => x.w > 0);
    // Nobody based at either end: the home airline based nearest flies it, as an outstation route from its network.
    if (!cands.length) {
      const near = nearestAirline(airlines, A, B, m.distKm);
      if (near) cands = [{ al: near, w: 1 }];
    }
    const W = cands.reduce((s, x) => s + x.w, 0);
    let alloc = cands.map((x) => ({ al: x.al, freq: (m.rivalFreq * x.w) / (W || 1) }));
    // Drop token service: an airline needs at least 3 flights a week to be in a market.
    if (alloc.length > 1) {
      const kept = alloc.filter((x) => x.freq >= 3);
      const keptSum = kept.reduce((s, x) => s + x.freq, 0);
      alloc = kept.length ? kept.map((x) => ({ al: x.al, freq: (x.freq * m.rivalFreq) / keptSum })) : [alloc.sort((x, y) => y.freq - x.freq)[0]];
      if (!kept.length) alloc[0].freq = m.rivalFreq;
    }
    if (!alloc.length) alloc = [{ al: OTHER, freq: m.rivalFreq }];
    const list: RivalService[] = [];
    for (const { al, freq } of alloc) {
      const n = Math.max(1, Math.round(freq));
      // Every airline in the market flies about the market's typical aircraft size.
      const seatsNeeded = rivalPaxPerFlight(m.airDemand, m.distKm) / AVERAGE_LOAD;
      const type = pickType(al, A, B, m.distKm, seatsNeeded) ?? 'A20N';
      const [outFrom, outTo] = al.bases.includes(m.a) ? [m.a, m.b] : al.bases.includes(m.b) ? [m.b, m.a] : [m.a, m.b];
      const outbound = scheduleTimes(al, AIRPORT_BY_CODE[outFrom], AIRPORT_BY_CODE[outTo], m.distKm, n);
      const pairedReturn = m.distKm <= LONG_HAUL_KM && (al.bases.includes(m.a) !== al.bases.includes(m.b))
        ? outbound.map((dep) => {
          const origin = AIRPORT_BY_CODE[outFrom], destination = AIRPORT_BY_CODE[outTo];
          const arrival = dep + flightMinutes(origin, destination, RIVAL_JET_KMH) + destination.utcOffset - origin.utcOffset;
          return Math.max(FIRST_DEP, Math.min(LAST_DEP, wrap(arrival + 45)));
        }).sort((x, y) => x - y)
        : null;
      for (const [from, to] of [[m.a, m.b], [m.b, m.a]]) {
        const times = from === outFrom
          ? outbound
          : pairedReturn ?? scheduleTimes(al, AIRPORT_BY_CODE[from], AIRPORT_BY_CODE[to], m.distKm, n);
        const F = AIRPORT_BY_CODE[from], T = AIRPORT_BY_CODE[to];
        const avgQ = times.reduce((s, t) => s + departureQuality(t, arrivalLocal(F, T, t), m.distKm), 0) / times.length;
        list.push({ airline: al, from, to, freq: n, times, effFreq: n * avgQ, fare: Math.round(m.refFare * al.fareMult), type });
      }
    }
    return list;
  }
}

let airlineCache: Airline[] | null = null;
export const airlines = () => (airlineCache ??= buildAirlines());

const serviceCache = new Map<string, RivalService[]>();

/** Competitor services between two airports, both directions. */
export function rivalsBetween(a: string, b: string): RivalService[] {
  const key = pairKey(a, b);
  let list = serviceCache.get(key);
  if (!list) {
    const m = marketBetween(a, b);
    list = m ? buildServices(airlines(), m) : [];
    serviceCache.set(key, list);
  }
  return list;
}

/** Competitor services from one airport to another, one direction. */
export const rivalsFrom = (from: string, to: string): RivalService[] => rivalsBetween(from, to).filter((s) => s.from === from);

const airportRivals = new Map<string, { to: string; services: RivalService[] }[]>();

/** Every competitor departure from an airport, grouped by destination, busiest first. */
export function rivalsAt(code: string): { to: string; services: RivalService[] }[] {
  const cached = airportRivals.get(code);
  if (cached) return cached;
  const out: { to: string; services: RivalService[] }[] = [];
  for (const m of marketsAt(code)) {
    if (m.rivalFreq <= 0) continue;
    const to = m.a === code ? m.b : m.a;
    const services = rivalsFrom(code, to);
    if (services.length) out.push({ to, services });
  }
  out.sort((x, y) => sumFreq(y.services) - sumFreq(x.services));
  airportRivals.set(code, out);
  return out;
}

/** Airlines flying from an airport, with weekly departures and destinations. */
export function airlinesAt(code: string): { airline: Airline; flights: number; destinations: number }[] {
  const by = new Map<string, { airline: Airline; flights: number; destinations: number }>();
  for (const { services } of rivalsAt(code)) {
    for (const s of services) {
      const e = by.get(s.airline.id) ?? { airline: s.airline, flights: 0, destinations: 0 };
      e.flights += s.freq;
      e.destinations += 1;
      by.set(s.airline.id, e);
    }
  }
  return [...by.values()].sort((x, y) => y.flights - x.flights);
}

const sumFreq = (xs: RivalService[]) => xs.reduce((s, x) => s + x.freq, 0);
