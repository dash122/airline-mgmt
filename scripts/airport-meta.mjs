// Hand-maintained metadata the open datasets don't have: Traditional Chinese names, metro groups,
// high-speed rail access, tourism pull and slot overrides.

export const NAMES = {
  // Taiwan
  TPE: '台北桃園', TSA: '台北松山', RMQ: '台中', CYI: '嘉義', TNN: '台南', KHH: '高雄', HUN: '花蓮', TTT: '台東',
  KYD: '蘭嶼', MZG: '澎湖', KNH: '金門', LZN: '馬祖南竿', MFK: '馬祖北竿',
  // Hong Kong / Macau
  HKG: '香港', MFM: '澳門',
  // Hokkaido
  CTS: '札幌新千歲', OKD: '札幌丘珠', HKD: '函館', AKJ: '旭川', OBO: '帶廣', KUH: '釧路', MMB: '女滿別', SHB: '中標津',
  WKJ: '稚內', MBE: '紋別', OIR: '奧尻', RIS: '利尻',
  // Tohoku
  AOJ: '青森', MSJ: '三澤', HNA: '花卷', AXT: '秋田', ONJ: '大館能代', GAJ: '山形', SYO: '庄內', SDJ: '仙台', FKS: '福島',
  // Kanto / Izu islands
  HND: '東京羽田', NRT: '東京成田', IBR: '茨城', HAC: '八丈島', OIM: '大島', MYE: '三宅島',
  // Chubu / Hokuriku
  NGO: '名古屋中部', NKM: '名古屋小牧', FSZ: '靜岡', MMJ: '松本', KIJ: '新潟', SDS: '佐渡', TOY: '富山', KMQ: '小松', NTQ: '能登',
  // Kansai
  ITM: '大阪伊丹', KIX: '大阪關西', UKB: '神戶', SHM: '南紀白濱', TJH: '但馬',
  // Chugoku / Shikoku
  OKJ: '岡山', HIJ: '廣島', IWK: '岩國', UBJ: '山口宇部', TTJ: '鳥取', YGJ: '米子', IZO: '出雲', IWJ: '石見', OKI: '隱岐',
  TAK: '高松', TKS: '德島', KCZ: '高知', MYJ: '松山(愛媛)',
  // Kyushu
  FUK: '福岡', KKJ: '北九州', HSG: '佐賀', NGS: '長崎', KMJ: '熊本', OIT: '大分', KMI: '宮崎', KOJ: '鹿兒島',
  AXJ: '天草', IKI: '壹岐', TSJ: '對馬', FUJ: '福江', TNE: '種子島', KUM: '屋久島',
  // Amami / Okinawa
  ASJ: '奄美', KKX: '喜界', TKN: '德之島', OKE: '沖永良部', RNJ: '與論',
  OKA: '沖繩那霸', UEO: '久米島', AGJ: '粟國', KTD: '北大東', MMD: '南大東', MMY: '宮古', SHI: '下地島', TRA: '多良間',
  ISG: '石垣', OGN: '與那國',
};

/** Airports in one metro share their catchment cities and never form a market with each other. */
export const METROS = {
  taipei: ['TPE', 'TSA'],
  tokyo: ['HND', 'NRT'],
  osaka: ['ITM', 'KIX', 'UKB'],
  nagoya: ['NGO', 'NKM'],
  sapporo: ['CTS', 'OKD'],
  miyako: ['MMY', 'SHI'],
  matsu: ['LZN', 'MFK'],
};

/** Airports whose city sits on a high-speed rail line (Shinkansen or Taiwan HSR). */
export const HSR = new Set([
  'TPE', 'TSA', 'RMQ', 'CYI', 'TNN', 'KHH',
  'HND', 'NRT', 'NGO', 'NKM', 'FSZ', 'ITM', 'KIX', 'UKB', 'OKJ', 'HIJ', 'IWK', 'UBJ', 'KKJ', 'FUK', 'HSG', 'NGS', 'KMJ', 'KOJ',
  'SDJ', 'FKS', 'HNA', 'AOJ', 'MSJ', 'AXT', 'GAJ', 'KIJ', 'TOY', 'KMQ', 'MMJ', 'HKD',
]);

/** Tourism pull by ISO region (multiplies how many trips a place attracts). Approximate. */
export const TOURISM_BY_REGION = {
  'JP-47': 2.5, // Okinawa
  'JP-01': 1.6, // Hokkaido
  'JP-46': 1.3, // Kagoshima incl. Amami islands
  'JP-13': 1.2, // Tokyo
  'JP-27': 1.3, // Osaka (also Kyoto visitors)
  'TW-PEN': 3, // Penghu
  'TW-X-KM': 1.5, // Kinmen
  'TW-LIE': 2, // Matsu
  'TW-HUA': 1.6, // Hualien
  'TW-TTT': 1.6, // Taitung incl. Orchid Island
};

/** Weekly departure caps for the busiest airports; others follow airport size. */
export const SLOT_OVERRIDES = { HND: 160, NRT: 140, HKG: 160, TPE: 140, KIX: 140, FUK: 120, CTS: 120, OKA: 120, ITM: 100, TSA: 80 };

/** Airport size tiers. Others follow OurAirports' type (large / medium / small). */
export const TIERS = {
  HND: 'hub', NRT: 'hub', KIX: 'hub', ITM: 'hub', NGO: 'hub', FUK: 'hub', CTS: 'hub', OKA: 'hub', HKG: 'hub', TPE: 'hub',
  TSA: 'major', KHH: 'major', SDJ: 'major', HIJ: 'major', KOJ: 'major', KMJ: 'major', NGS: 'major', MYJ: 'major', KMI: 'major', MFM: 'major',
  IBR: 'medium', NKM: 'medium', FSZ: 'medium', HSG: 'medium', OKD: 'medium', UKB: 'medium', SHI: 'small',
};

/** Islands joined to the mainland by bridges (treated as mainland for ground travel). */
export const BRIDGED = { AXJ: 'jp-main', IWK: 'jp-main', KIJ: 'jp-main' };
