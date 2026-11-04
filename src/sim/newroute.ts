// Planning one new route between two airports: where to fly, on which aircraft, and what it would earn.
import { AIRCRAFT, type AircraftModel } from '../data/aircraft';
import { AIRPORTS, AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { marketBetween, pairKey } from './markets';
import { distanceKm } from './geo';
import { estimateNonstop } from './airports';
import { insertRoundTrip, leaseFor, placementOptions, placeOn, typesFor, type Placement } from './schedule';
import { blockMinutes, defaultAircraft, localMinutes, rotationInfo, routePairs, routeProblem, simulate, timeOfDayQuality, utcFromLocal, type Aircraft, type NetworkResult, type Plan } from './simulate';

/** Chinese country names, for searching "日本" or "泰國" and for the destination list. */
export const COUNTRY_ZH: Record<string, string> = {
  TW: '台灣', HK: '香港', MO: '澳門', CN: '中國', JP: '日本', KR: '韓國', KP: '北韓', MN: '蒙古',
  TH: '泰國', VN: '越南', PH: '菲律賓', SG: '新加坡', MY: '馬來西亞', ID: '印尼', KH: '柬埔寨', LA: '寮國', MM: '緬甸', BN: '汶萊', TL: '東帝汶',
  IN: '印度', PK: '巴基斯坦', BD: '孟加拉', LK: '斯里蘭卡', NP: '尼泊爾', MV: '馬爾地夫', BT: '不丹',
  AE: '阿聯', SA: '沙烏地', QA: '卡達', OM: '阿曼', KW: '科威特', BH: '巴林', IR: '伊朗', IQ: '伊拉克', IL: '以色列', JO: '約旦', TR: '土耳其',
  KZ: '哈薩克', UZ: '烏茲別克', RU: '俄羅斯',
  GB: '英國', IE: '愛爾蘭', FR: '法國', DE: '德國', NL: '荷蘭', BE: '比利時', CH: '瑞士', AT: '奧地利', IT: '義大利', ES: '西班牙', PT: '葡萄牙',
  GR: '希臘', PL: '波蘭', CZ: '捷克', HU: '匈牙利', RO: '羅馬尼亞', SE: '瑞典', NO: '挪威', FI: '芬蘭', DK: '丹麥', IS: '冰島',
  US: '美國', CA: '加拿大', MX: '墨西哥', BR: '巴西', AR: '阿根廷', CL: '智利', PE: '秘魯', CO: '哥倫比亞',
  AU: '澳洲', NZ: '紐西蘭', GU: '關島', MP: '北馬里亞納', PW: '帛琉', FJ: '斐濟',
  EG: '埃及', ZA: '南非', KE: '肯亞', ET: '衣索比亞', MA: '摩洛哥', NG: '奈及利亞', TZ: '坦尚尼亞',
};
export const countryName = (a: Airport) => COUNTRY_ZH[a.country] ?? a.country;

const SIZE_RANK = { hub: 0, major: 1, large: 2, medium: 3, small: 4 } as const;

/** Airports matching what the player typed: code, name, city or country. Exact codes first, then names that start with the text. */
export function searchAirports(query: string, limit = 30): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { a: Airport; s: number }[] = [];
  for (const a of AIRPORTS) {
    const code = a.code.toLowerCase();
    const s = code === q ? 0
      : a.name.startsWith(query.trim()) ? 1
      : code.startsWith(q) ? 2
      : a.name.includes(query.trim()) || a.metro.toLowerCase().startsWith(q) ? 3
      : countryName(a).includes(query.trim()) ? 4
      : -1;
    if (s >= 0) scored.push({ a, s });
  }
  return scored.sort((x, y) => x.s - y.s || SIZE_RANK[x.a.size] - SIZE_RANK[y.a.size] || y.a.catchment - x.a.catchment).slice(0, limit).map((x) => x.a);
}

export interface Destination {
  code: string;
  distKm: number;
  /** Weekly travellers (both directions) one daily nonstop of ours would attract, before seats run out. */
  est: number;
  /** Weekly air travellers (both directions) between the two airports today. */
  marketPax: number;
  /** Weekly flights (both directions) by other airlines. */
  rivalFlights: number;
  /** The aircraft the game suggests, or null when nothing can fly it. */
  type: AircraftModel | null;
  /** Why the route can't be flown, if it can't. */
  problem: string | null;
  /** The player already flies it. */
  served: boolean;
}

/** One destination from `from`, with demand, competition and whether the player's aircraft can fly it. */
export function destination(plan: Plan, from: string, to: string, served?: Set<string>): Destination {
  const m = marketBetween(from, to);
  const type = m ? defaultAircraft(from, to) : null;
  const A = AIRPORT_BY_CODE[from], B = AIRPORT_BY_CODE[to];
  const problem = !m ? routeProblem(from, to, 'A20N') ?? '沒有旅客市場' : type ? null : routeProblem(from, to, 'B77W') ?? '沒有機型能飛';
  const distKm = m?.distKm ?? distanceKm(A.lat, A.lon, B.lat, B.lon);
  return {
    code: to, distKm, type, problem,
    est: m && type ? estimateNonstop(plan, from, to) : 0,
    marketPax: m ? m.airDemand * 2 : 0,
    rivalFlights: m ? m.rivalFreq * 2 : 0,
    served: (served ?? servedFrom(plan, from)).has(to),
  };
}

const servedFrom = (plan: Plan, code: string) =>
  new Set(routePairs(plan).filter((r) => r.a === code || r.b === code).map((r) => (r.a === code ? r.b : r.a)));

/** Every place worth flying from `from`, most travellers first. Only airports with a market (not the same city, at least 100 km away). */
export function destinationsFrom(plan: Plan, from: string): Destination[] {
  const served = servedFrom(plan, from);
  const out: Destination[] = [];
  for (const a of AIRPORTS) {
    if (a.code === from || !marketBetween(from, a.code)) continue;
    out.push(destination(plan, from, a.code, served));
  }
  return out.sort((x, y) => Number(!!x.problem) - Number(!!y.problem) || y.est - x.est);
}

export type DistanceBand = 'all' | 'short' | 'medium' | 'long' | 'open';
export const BANDS: [DistanceBand, string][] = [['all', '推薦'], ['short', '短程'], ['medium', '中程'], ['long', '長程'], ['open', '沒人直飛']];
/** Short: under 2,000 km (about 3 hours). Long: 5,000 km and more. */
export function inBand(d: Destination, band: DistanceBand): boolean {
  switch (band) {
    case 'short': return d.distKm < 2000;
    case 'medium': return d.distKm >= 2000 && d.distKm < 5000;
    case 'long': return d.distKm >= 5000;
    case 'open': return d.rivalFlights === 0;
    default: return true;
  }
}

// ---------- Choosing the aircraft ----------

export interface RouteChoice {
  id: string;
  /** An aircraft already in the fleet with a free slot, or a new lease. */
  kind: 'fleet' | 'lease';
  type: AircraftModel;
  acId?: string;
  placement?: Placement;
  utilBefore?: number;
  utilAfter?: number;
}

/** How well a round trip's two departures sell (each leg's local time-of-day appeal, added). */
function tripAppeal(p: Placement, type: AircraftModel): number {
  const back = p.dep + blockMinutes(p.from, p.to, type) + AIRCRAFT[type].turnMin;
  return timeOfDayQuality(localMinutes(p.from, p.dep)) + timeOfDayQuality(localMinutes(p.to, back));
}

/** The free slot on an aircraft where the round trip sells best: tries each popular time and keeps the most attractive. */
export function bestPlacement(plan: Plan, ac: Aircraft, from: string, to: string): Placement | null {
  let best: Placement | null = null, score = -Infinity;
  for (const [local] of TIME_PRESETS) {
    const p = placeOn(ac, from, to, utcFromLocal(from, local), plan.base);
    if (!p) continue;
    const s = tripAppeal(p, ac.type);
    if (s > score + 1e-9) { best = p; score = s; }
  }
  return best;
}

/** Ways to fly one daily round trip from `from` to `to`: aircraft with room first, then every type that could be leased. */
export function routeChoices(plan: Plan, from: string, to: string): RouteChoice[] {
  const fleet = placementOptions(plan, from, to, utcFromLocal(from, 7 * 60))
    .filter((o) => o.placement)
    .map((o): RouteChoice => {
      const p = bestPlacement(plan, o.ac, from, to) ?? o.placement!;
      return { id: o.ac.id, kind: 'fleet', type: o.ac.type, acId: o.ac.id, placement: p, utilBefore: o.utilBefore, utilAfter: rotationInfo(insertRoundTrip(o.ac, p.k, p.from, p.to, p.dep)).utilisation };
    });
  const lease = typesFor(plan, from, to).map((t): RouteChoice => ({ id: `lease-${t}`, kind: 'lease', type: t }));
  return [...fleet, ...lease];
}

/** Where a choice's first flight leaves from: leased aircraft start at the base end, if there is one. */
export const departsFrom = (plan: Plan, c: RouteChoice, from: string, to: string) =>
  c.placement ? c.placement.from : to === plan.base ? to : from;

/** Earliest and latest departure (UTC minutes) the choice allows; a new aircraft can go any time. */
export const windowOf = (c: RouteChoice) => (c.placement ? { lo: c.placement.lo, hi: c.placement.hi } : { lo: -Infinity, hi: Infinity });

/** The plan with the round trip added. */
export function applyChoice(plan: Plan, c: RouteChoice, from: string, to: string, dep: number): { plan: Plan; aircraftId: string } {
  if (c.placement && c.acId) {
    const p = c.placement;
    const d = Math.max(p.lo, Math.min(p.hi, dep));
    return { plan: { ...plan, fleet: plan.fleet.map((ac) => (ac.id === c.acId ? insertRoundTrip(ac, p.k, p.from, p.to, d) : ac)) }, aircraftId: c.acId };
  }
  return leaseFor(plan, from, to, c.type, dep);
}

export interface RoutePreview {
  pax: number;
  seats: number;
  loadFactor: number;
  /** Weekly revenue minus flying cost on the new route. */
  routeProfit: number;
  /** Change in the whole network's weekly profit, lease and connections included. */
  networkDelta: number;
  /** Lease paid each week for a new aircraft (0 for an aircraft already in the fleet). */
  lease: number;
}

const profitOf = (r: NetworkResult | null) => (r ? r.revenue - r.cost : 0);

/** Run the week with the new route to see what it would carry and earn. */
export function previewChoice(plan: Plan, before: NetworkResult | null, c: RouteChoice, from: string, to: string, dep: number): RoutePreview {
  const next = applyChoice(plan, c, from, to, dep).plan;
  const after = simulate(next);
  const r = after.routes[pairKey(from, to)];
  return {
    pax: r?.pax ?? 0,
    seats: r?.seats ?? 0,
    loadFactor: r?.loadFactor ?? 0,
    routeProfit: r ? r.revenue - r.flyingCost : 0,
    networkDelta: profitOf(after) - profitOf(before),
    lease: c.kind === 'lease' ? AIRCRAFT[c.type].ownershipPerWeek : 0,
  };
}

/** One-way gate-to-gate minutes on the route for a type. */
export const flightMinutes = (from: string, to: string, type: AircraftModel | null) => blockMinutes(from, to, type ?? 'A20N');

/** Popular departure times, local at the departing airport. */
export const TIME_PRESETS: [number, string][] = [[7 * 60, '早上'], [10 * 60, '上午'], [14 * 60, '下午'], [17 * 60 + 30, '傍晚'], [20 * 60 + 30, '晚上']];
