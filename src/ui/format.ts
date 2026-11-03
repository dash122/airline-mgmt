export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)} 億`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('zh-TW')} 萬`;
  return `${sign}${Math.round(a).toLocaleString('zh-TW')}`;
}

export const count = (n: number) => Math.round(n).toLocaleString('zh-TW');
export const pct = (n: number) => `${Math.round(n * 100)}%`;
