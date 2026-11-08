/**
 * The simulation prices everything in NT$ and saved games keep it that way. Players see Hong Kong dollars:
 * the conversion happens here and nowhere else, so every figure on screen goes through one of these three.
 */
export const TWD_PER_HKD = 4;
export const hkd = (twd: number) => twd / TWD_PER_HKD;

/** A profit, cost or balance, short and bare: 1.2 億, 737 萬, 8,020. */
export function money(twd: number): string {
  const n = hkd(twd);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)} 億`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('zh-TW')} 萬`;
  return `${sign}${Math.round(a).toLocaleString('zh-TW')}`;
}

export const count = (n: number) => Math.round(n).toLocaleString('zh-TW');
export const pct = (n: number) => `${Math.round(n * 100)}%`;
/** A count that fits a small tile: 934,393 → 93 萬, 12,345 → 1.2 萬. */
export const short = (n: number) => (Math.abs(n) >= 1e5 ? `${Math.round(n / 1e4).toLocaleString('zh-TW')} 萬` : Math.abs(n) >= 1e4 ? `${(n / 1e4).toFixed(1)} 萬` : count(n));

/** A price someone pays or compares, with its currency: HK$2,005. */
export const price = (twd: number) => `HK$${count(hkd(twd))}`;
/** money() with the currency named, for headline figures: HK$737 萬, -HK$12 萬. */
export const hk = (twd: number) => `${twd < 0 ? '-' : ''}HK$${money(Math.abs(twd))}`;
/** hk() with an explicit plus for gains: +HK$737 萬. */
export const hkSigned = (twd: number) => `${twd >= 0 ? '+' : ''}${hk(twd)}`;
