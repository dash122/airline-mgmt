// Competitor airlines. They are fictional and generated from the airport and market data, so they work
// for any set of airports. They fly fixed schedules and do not react to the player: each market's
// existing service (Market.rivalFreq) is split between the airlines that would plausibly fly it.
import { AIRCRAFT, classRank, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../data/airports';
import { timeOfDayQuality } from './choice';
import { marketBetween, marketsAt, pairKey, type Market } from './markets';

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
/** How busy an airport is, from its size tier and catchment. Cheap, so it works for any number of airports. */
const busyness = (a: Airport) => SIZE_WEIGHT[a.size] * 1e8 + a.catchment * a.tourism;

/** People in a country's airport catchments before it has a low-cost airline, and airports before it has a regional one. */
const LOW_COST_MIN_CATCHMENT = 10_000_000;
const REGIONAL_MIN_AIRPORTS = 4;

function buildAirlines(): Airline[] {
  const byCountry = new Map<string, Airport[]>();
  for (const a of AIRPORTS) byCountry.set(a.country, [...(byCountry.get(a.country) ?? []), a]);
  const countries = [...byCountry.keys()].sort();
  const used = new Set<string>();
  const out: Airline[] = [];
  const make = (country: string, kind: AirlineKind, bases: string[], name: string) => {
    const s = KIND_SETTINGS[kind];
    out.push({ id: `${country}-${kind}`, name, kind, country, color: COLORS[hash(`${country}${kind}`) % COLORS.length], bases, fareMult: s.fareMult, quality: s.quality });
  };
  for (const c of countries) {
    const list = [...byCountry.get(c)!].sort((x, y) => busyness(y) - busyness(x));
    // One airport per metro, busiest first.
    const metros: Airport[] = [];
    for (const a of list) if (!metros.some((m) => m.metro === a.metro)) metros.push(a);
    if (!metros.length) continue;
    const people = list.reduce((s, a) => s + a.catchment, 0);
    const top = metros[0], second = metros[1];
    // The main hub, other big airports in the same city, and a second city if it is nearly as big.
    const fullBases = [top.code, ...list.filter((a) => a.metro === top.metro && a.code !== top.code && a.size === top.size).map((a) => a.code)];
    if (second && second.size === top.size) fullBases.push(second.code);
    make(c, 'full', fullBases, `${pickFullName(c, used)}航空`);
    if (people > LOW_COST_MIN_CATCHMENT) {
      make(c, 'low', metros.slice(0, 3).map((a) => a.code), `${pickName([NAME_POOLS[nameAreaOf(c)].low, comboNames(nameAreaOf(c))], `${c}low`, used)}航空`);
    }
    const small = list.filter((a) => a.size === 'medium' || a.size === 'small');
    if (small.length >= REGIONAL_MIN_AIRPORTS) {
      make(c, 'regional', list.map((a) => a.code), `${pickName([NAME_POOLS[nameAreaOf(c)].regional, NAME_POOLS[nameAreaOf(c)].full, comboNames(nameAreaOf(c))], `${c}regional`, used)}航空`);
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
      return hub ? 1 : atBase ? 0.6 : 0;
    case 'low':
      return atBase ? 0.7 : distKm < 2500 ? 0.2 : 0;
    case 'regional': {
      if (a.country !== b.country || a.country !== al.country) return 0;
      const thin = [a, b].some((x) => x.size === 'medium' || x.size === 'small');
      return thin ? 1.2 : 0.15;
    }
  }
}

function canFly(type: AircraftModel, a: Airport, b: Airport, distKm: number): boolean {
  const s = AIRCRAFT[type];
  return distKm <= s.rangeKm && classRank(s.cls) <= Math.min(classRank(a.maxClass), classRank(b.maxClass));
}

/** Low-cost airlines fly single-aisle jets, and widebodies only on longer routes (like the long-haul low-cost arms in Asia). */
const LOW_COST_WIDEBODY_KM = 2500;

/** Smallest aircraft in the airline's fleet that carries the expected load, or the largest that can fly it. */
function pickType(al: Airline, a: Airport, b: Airport, distKm: number, seatsNeeded: number): AircraftModel | null {
  const fleet = KIND_SETTINGS[al.kind].fleet
    .filter((t) => canFly(t, a, b, distKm) && !(al.kind === 'low' && AIRCRAFT[t].cls === 'widebody' && distKm < LOW_COST_WIDEBODY_KM)).sort((x, y) => AIRCRAFT[x].seats - AIRCRAFT[y].seats);
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
    out.push(Math.round((first + step * (i + 0.5) + jitter) / 5) * 5);
  }
  return out;
}

const OTHER: Airline = { id: 'other', name: '其他航空', kind: 'full', country: '', color: '#8a9aa6', bases: [], fareMult: 1, quality: 0 };
const AVERAGE_LOAD = 0.8;

function buildServices(airlines: Airline[], m: Market): RivalService[] {
  {
    if (m.rivalFreq <= 0) return [];
    const A = AIRPORT_BY_CODE[m.a], B = AIRPORT_BY_CODE[m.b];
    let cands = airlines.map((al) => ({ al, w: appeal(al, A, B, m.distKm) })).filter((x) => x.w > 0);
    // Nobody based here: the home flag carriers fly it point to point.
    if (!cands.length) cands = airlines.filter((al) => al.kind === 'full' && (al.country === A.country || al.country === B.country)).map((al) => ({ al, w: 0.3 }));
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
      const seatsNeeded = (m.airDemand * (freq / m.rivalFreq)) / n / AVERAGE_LOAD;
      const type = pickType(al, A, B, m.distKm, seatsNeeded) ?? 'A20N';
      for (const [from, to] of [[m.a, m.b], [m.b, m.a]]) {
        const times = departureTimes(`${al.id}${from}${to}`, n);
        const avgQ = times.reduce((s, t) => s + timeOfDayQuality(t), 0) / times.length;
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
