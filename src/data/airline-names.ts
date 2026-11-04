// Fictional competitor airline names, themed by the airline's home region so a Paris-based airline sounds
// European and a Nairobi-based one sounds East African. Every name is kept clear of real airline and country names.

export type NameRegion = 'eastAsia' | 'southeastAsia' | 'southAsia' | 'middleEast' | 'europe' | 'eurasia' | 'africa' | 'northAmerica' | 'caribbean' | 'latinAmerica' | 'oceania';
export type NameKind = 'full' | 'low' | 'regional';

const REGION_COUNTRIES: Record<NameRegion, string> = {
  eastAsia: 'CN HK MO TW JP KR KP MN',
  southeastAsia: 'BN ID KH LA MM MY PH SG TH TL VN',
  southAsia: 'AF BD BT IN LK MV NP PK',
  middleEast: 'AE BH IL IQ IR JO KW LB OM QA SA SY YE TR EG LY TN DZ MA EH MR SD',
  europe: 'AL AT BA BE BG CH CY CZ DE DK EE ES FI FO FR GB GI GL GR HR HU IE IM IS IT LT LU LV ME MK MT NL NO PL PT RO RS SE SI SK XK',
  eurasia: 'RU BY UA MD GE AM AZ KZ KG TJ TM UZ',
  africa: 'AO BF BI BJ BW CD CF CG CI CM CV DJ ER ET GA GH GM GN GQ GW KE KM LR LS MG ML MU MW MZ NA NE NG RE RW SC SL SN SO SS ST SZ TD TG TZ UG YT ZA ZM ZW',
  northAmerica: 'US CA PM',
  caribbean: 'AG AI AW BB BM BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI',
  latinAmerica: 'AR BO BR BZ CL CO CR EC FK GF GT GY HN MX NI PA PE PY SR SV UY VE',
  oceania: 'AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS',
};

const COUNTRY_REGION = new Map<string, NameRegion>();
for (const [region, codes] of Object.entries(REGION_COUNTRIES) as [NameRegion, string][]) {
  for (const c of codes.split(' ')) COUNTRY_REGION.set(c, region);
}

/** The naming region for a country (ISO code), or undefined if it has none yet. */
export const nameRegionOf = (country: string): NameRegion | undefined => COUNTRY_REGION.get(country);

interface Pool {
  /** Hand-picked names: landscapes, plants, animals and symbols of the region. */
  full: string[];
  low: string[];
  regional: string[];
  /** Syllables for invented names that sound like the region's languages, once the hand-picked ones run out. */
  syllables: string[];
}

const POOLS: Record<NameRegion, Pool> = {
  eastAsia: {
    full: ['雲帆', '海燕', '晨曦', '青嵐', '長風', '銀翼', '紅鶴', '白鷺', '曙光', '朱鷺', '雪松', '南星', '碧海', '蒼穹', '晴空', '旭日', '玉蘭', '松濤', '琥珀', '月桂', '翠羽', '錦帆', '秋楓', '櫻雲', '霞光', '青鸞'],
    low: ['樂翔', '輕羽', '跳島', '好旅', '嗨飛', '微風', '啾啾', '小步', '輕舟', '泡泡'],
    regional: ['群島', '山海', '澄海', '海峽', '岬角', '環島', '列嶼', '溪谷'],
    syllables: [],
  },
  southeastAsia: {
    full: ['椰風', '季風', '珊瑚', '金塔', '蓮影', '犀鳥', '赤道', '南洋', '稻浪', '茉莉', '白象', '香蘭', '翡翠灣', '雨林'],
    low: ['椰子', '芒果', '嘟嘟', '叮咚', '榴槤', '小猴'],
    regional: ['千島', '群嶼', '湄河', '海岸'],
    syllables: ['蘇', '蘭', '瑪', '拉', '迪', '薩', '納', '塔', '卡', '普', '娜', '雅', '甘', '旺'],
  },
  southAsia: {
    full: ['孔雀', '檀香', '番紅花', '菩提', '雪峰', '藍寶石', '茶園', '季雨', '蓮座', '恆光', '綠寶'],
    low: ['風箏', '彩紗', '小象', '香料'],
    regional: ['山谷', '河谷', '雪域'],
    syllables: ['阿', '蘇', '拉', '瑪', '迪', '薩', '維', '卡', '蘭', '納', '尼', '哈', '蒂', '普', '吉', '雅'],
  },
  middleEast: {
    full: ['綠洲', '沙丘', '新月', '駝鈴', '椰棗', '乳香', '獵鷹', '金沙', '晨星', '香柏', '藍門', '星沙', '薔薇', '玫瑰石', '琉璃', '細沙'],
    low: ['飛毯', '駱駝', '薄荷', '小鷹', '燈火'],
    regional: ['沙漠', '谷地', '綠谷'],
    syllables: ['阿', '薩', '哈', '米', '拉', '納', '蒂', '賈', '扎', '法', '蘇', '里', '迪', '雅', '努', '希'],
  },
  europe: {
    full: ['橄欖', '薰衣草', '鳶尾', '橡樹', '峽灣', '鬱金香', '葡萄園', '燈塔', '白崖', '石楠', '金雀花', '風車', '冰川', '北極光', '椴樹', '桂冠', '玫瑰窗', '銀樺', '天鵝', '夜鶯', '山毛櫸', '雲雀'],
    low: ['海鷗', '紙飛機', '汽水', '氣球', '單車', '喜鵲', '嗡嗡', '麻雀'],
    regional: ['海島', '湖區', '半島', '林地', '高原', '海角', '峽谷'],
    syllables: ['阿', '維', '諾', '瓦', '拉', '莉', '亞', '塔', '斯', '卡', '蘭', '多', '菲', '歐', '倫', '特', '瑪', '莎', '貝', '爾', '伊', '索', '薇', '奧', '里', '琳'],
  },
  eurasia: {
    full: ['白樺', '雪豹', '駿馬', '絲路', '石榴', '草原', '雪原', '金鷹', '杉林', '藍頂', '杏花'],
    low: ['套娃', '小熊'],
    regional: ['苔原', '河灘', '山口'],
    syllables: ['斯', '拉', '沃', '娃', '米', '爾', '卡', '托', '諾', '伊', '洛', '塔', '季', '科', '薩', '汗'],
  },
  africa: {
    full: ['猴麵包樹', '金合歡', '莽原', '斑馬', '羚羊', '火烈鳥', '織布鳥', '犀牛', '獅鬃', '赤土', '鼓聲', '象群', '日落', '雨季', '紅木', '黑檀', '藍鶴', '長頸鹿', '獵豹', '太陽鳥', '星空', '大裂谷'],
    low: ['跳羚', '狐獴', '小斑馬', '蜜獾'],
    regional: ['大湖', '高地', '三角洲', '瀑布'],
    syllables: ['坎', '巴', '馬', '蘇', '魯', '恩', '戈', '瓦', '亞', '奇', '卡', '扎', '姆', '利', '薩', '邦', '圖', '納', '科', '班', '奧', '蓋'],
  },
  northAmerica: {
    full: ['紅杉', '野牛', '大草原', '楓林', '北星', '白頭鷹', '金麥穗', '灰熊'],
    low: ['牛仔', '浣熊'],
    regional: ['松林', '冰湖', '河狸'],
    syllables: ['艾', '倫', '克', '斯', '頓', '蘭', '德', '麥', '森', '菲', '爾', '布', '萊', '哈', '特', '威'],
  },
  caribbean: {
    full: ['信風', '海龜', '椰林', '蜂鳥', '藍洞', '海星', '珊瑚礁', '木槿', '甘蔗', '海螺', '雷鬼', '鋼鼓', '白沙', '落日灣', '鵜鶘', '飛魚', '椰島'],
    low: ['朗姆', '小海龜'],
    regional: ['群礁', '小島'],
    syllables: ['聖', '瑪', '莉', '洛', '薩', '卡', '納', '貝', '拉', '托', '蒂', '米', '索', '露'],
  },
  latinAmerica: {
    full: ['太陽門', '羊駝', '咖啡', '巨嘴鳥', '美洲豹', '仙人掌', '南十字', '探戈', '羽蛇', '綠咬鵑', '瑪黛茶', '龍舌蘭', '火地', '南風', '大河', '彩陶'],
    low: ['森巴', '小羊駝', '跳跳豆', '莎莎', '嘉年華', '可可'],
    regional: ['高原', '峽谷', '海岸線'],
    syllables: ['聖', '洛', '薩', '琳', '達', '蒂', '卡', '米', '拉', '索', '爾', '維', '塔', '佩', '羅', '馬', '尼', '奧', '露'],
  },
  oceania: {
    full: ['尤加利', '信天翁', '礁湖', '浪花', '鸚鵡', '獨木舟', '星海', '南天', '雞蛋花', '椰影', '海豚', '鯨歌', '珍珠', '環礁', '黑沙'],
    low: ['無尾熊', '袋熊', '衝浪'],
    regional: ['內陸', '群礁'],
    syllables: ['卡', '莫', '阿', '納', '瑪', '圖', '伊', '洛', '蘭', '奇', '普', '哈', '瓦', '努', '塔', '基'],
  },
};

// East Asian invented names pair a colour or sky word with a bird, wing or sail, like the hand-picked ones.
const EAST_ASIA_FIRST = ['雲', '海', '晨', '青', '銀', '紅', '白', '碧', '晴', '玉', '翠', '錦', '霞', '星', '月', '松'];
const EAST_ASIA_SECOND = ['帆', '燕', '嵐', '翼', '鶴', '鷺', '羽', '河', '舟', '峰', '灣', '鷗'];

/**
 * Real airline names and brands, and country names, in Chinese. A name containing any of these is never used, so an
 * invented name can't read as a real airline (卡達 is Qatar, 維珍 is Virgin) or as a country.
 */
const BLOCKED = [
  '國泰', '長榮', '中華', '華航', '星宇', '立榮', '華信', '港龍', '春秋', '吉祥', '東方', '南方', '國航', '海南', '廈門', '深圳',
  '四川', '山東', '祥鵬', '華夏', '首都', '天津', '西部', '長龍', '奧凱', '九元', '幸福', '金鵬', '全日空', '日航', '天馬', '樂桃',
  '捷星', '酷航', '亞航', '虎航', '宿霧', '菲航', '泰航', '越航', '新航', '勝安', '馬航', '嘉魯達', '獅航', '大韓', '韓亞', '濟州',
  '德威', '易斯達', '阿聯酋', '阿提哈德', '海灣', '漢莎', '法航', '英航', '荷航', '維珍', '瑞航', '芬航', '易捷', '瑞安', '維茲',
  '土航', '俄航', '澳航', '紐航', '加航', '達美', '聯合', '西南', '捷藍', '阿拉斯加', '夏威夷', '阿維安卡', '伊比利亞', '葡航',
  '拉塔姆', '皇家', '鷹航', '富士', '東海', '北歐',
  '卡達', '馬利', '巴西', '古巴', '伊朗', '阿曼', '蘇丹', '薩摩亞', '東加', '斐濟', '海地', '秘魯', '智利', '巴拿馬', '貝南',
  '馬拉威', '尼日', '加納', '剛果', '葉門', '約旦', '敘利亞', '印度', '寮國', '泰國', '越南', '緬甸', '汶萊', '蒙古', '俄羅斯',
  '烏克蘭', '波蘭', '法國', '德國', '英國', '西班牙', '義大利', '荷蘭', '瑞士', '瑞典', '挪威', '丹麥', '芬蘭', '希臘', '埃及',
  '利比亞', '肯亞', '安哥拉', '南非', '查德', '多哥', '迦納', '加彭', '蓋亞那', '蘇利南', '貝里斯', '澳洲', '索馬利亞', '巴林',
  '亞美尼亞', '喬治亞', '阿富汗', '尼泊爾', '不丹', '馬爾地夫', '新加坡', '馬來', '印尼', '菲律賓', '柬埔寨', '日本', '韓國',
  '朝鮮', '台灣', '香港', '澳門', '中國', '美國', '加拿大', '墨西哥', '阿根廷', '烏拉圭', '巴拉圭', '委內瑞拉', '哥倫比亞',
  '厄瓜多', '玻利維亞', '牙買加', '巴哈馬', '多明尼加', '波多黎各', '塞內加爾', '甘比亞', '幾內亞', '盧安達', '烏干達',
  '尚比亞', '辛巴威', '納米比亞', '波札那', '莫三比克', '馬達加斯加', '模里西斯', '奈及利亞', '喀麥隆', '摩洛哥', '突尼西亞',
  '卡拉', '沙拉', '瑪莎拉',
];
const isBlocked = (name: string) => BLOCKED.some((b) => name.includes(b));

/** Small deterministic string hash (FNV-1a). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** An invented name in the region's style, the `n`th candidate for this key. */
function invented(region: NameRegion, key: string, n: number): string {
  const h = hash(`${key}#${n}`), h2 = hash(`${n}#${key}`);
  if (region === 'eastAsia') return EAST_ASIA_FIRST[h % EAST_ASIA_FIRST.length] + EAST_ASIA_SECOND[h2 % EAST_ASIA_SECOND.length];
  const syl = POOLS[region].syllables;
  const len = 2 + (h % 2);
  let out = '';
  for (let i = 0; i < len; i++) {
    const s = syl[hash(`${key}#${n}#${i}`) % syl.length];
    if (out.endsWith(s)) continue;
    out += s;
  }
  return out.length >= 2 ? out : out + syl[h2 % syl.length];
}

/**
 * A unique airline name for a country's airline of one kind. Hand-picked names for the region come first, then
 * invented names in the region's style; `used` holds every name taken so far (with the 航空 suffix).
 */
export function airlineName(country: string, kind: NameKind, used: Set<string>): string {
  const region = nameRegionOf(country) ?? 'europe';
  const key = `${country}${kind}`;
  const pool = POOLS[region][kind];
  const take = (stem: string) => {
    const name = `${stem}航空`;
    if (used.has(name) || isBlocked(stem)) return null;
    used.add(name);
    return name;
  };
  const start = hash(key) % Math.max(pool.length, 1);
  for (let i = 0; i < pool.length; i++) {
    const got = take(pool[(start + i) % pool.length]);
    if (got) return got;
  }
  for (let n = 0; n < 100_000; n++) {
    const got = take(invented(region, key, n));
    if (got) return got;
  }
  throw new Error(`No airline name left for ${key}`);
}
