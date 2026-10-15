/**
 * 金额字段（money）：金额 + 币种，不做换算。币种表、显示格式（Intl，zh-CN，按币种的小数位）、
 * 旧价格（数字 / 「$12.5」「£30」「1299 元」）的识别，以及「上次用的币种」。界面文案见 docs/COPY.md。
 */
import type { FieldValue, LibraryItem, MoneyValue } from './types';

export interface Currency {
  code: string;
  /** 中文名。 */
  name: string;
  /** 常用符号（选择列表里显示；格式化以 Intl 为准）。 */
  symbol: string;
  /** 搜索用的别名。 */
  aliases?: string[];
}

/** 常用币种：先放最常用的几个，其余按地区。 */
export const CURRENCIES: Currency[] = [
  { code: 'CNY', name: '人民币', symbol: '¥', aliases: ['rmb', '元', '块', '人民币'] },
  { code: 'USD', name: '美元', symbol: '$', aliases: ['us$', '美金', 'dollar'] },
  { code: 'SGD', name: '新加坡元', symbol: 'S$', aliases: ['新币', '坡币'] },
  { code: 'GBP', name: '英镑', symbol: '£', aliases: ['pound'] },
  { code: 'EUR', name: '欧元', symbol: '€', aliases: ['euro'] },
  { code: 'JPY', name: '日元', symbol: '¥', aliases: ['円', '日币', 'yen'] },
  { code: 'HKD', name: '港币', symbol: 'HK$', aliases: ['港元', '港纸'] },
  { code: 'TWD', name: '新台币', symbol: 'NT$', aliases: ['台币'] },
  { code: 'MOP', name: '澳门元', symbol: 'MOP$', aliases: ['澳门币'] },
  { code: 'KRW', name: '韩元', symbol: '₩', aliases: ['韩币', 'won'] },
  { code: 'TRY', name: '土耳其里拉', symbol: '₺', aliases: ['里拉', 'lira'] },
  { code: 'PHP', name: '菲律宾比索', symbol: '₱', aliases: ['菲律宾币', '比索', 'peso'] },
  { code: 'MYR', name: '马来西亚林吉特', symbol: 'RM', aliases: ['马币', '令吉', 'ringgit'] },
  { code: 'THB', name: '泰铢', symbol: '฿', aliases: ['baht'] },
  { code: 'VND', name: '越南盾', symbol: '₫', aliases: ['越南币'] },
  { code: 'IDR', name: '印尼盾', symbol: 'Rp', aliases: ['印尼卢比', 'rupiah'] },
  { code: 'INR', name: '印度卢比', symbol: '₹', aliases: ['rupee'] },
  { code: 'AUD', name: '澳元', symbol: 'A$', aliases: ['澳币'] },
  { code: 'NZD', name: '新西兰元', symbol: 'NZ$', aliases: ['纽币'] },
  { code: 'CAD', name: '加元', symbol: 'C$', aliases: ['加币'] },
  { code: 'CHF', name: '瑞士法郎', symbol: 'CHF', aliases: ['法郎'] },
  { code: 'AED', name: '阿联酋迪拉姆', symbol: 'AED', aliases: ['迪拉姆', 'dirham'] },
  { code: 'RUB', name: '卢布', symbol: '₽', aliases: ['ruble'] },
];

export const DEFAULT_CURRENCY = 'CNY';
const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));
export const currencyOf = (code: string) => byCode.get(code.toUpperCase());

/** 搜币种：代码、中文名、符号、别名都能搜（「美」「usd」「$」「里拉」）。 */
export function searchCurrencies(query: string): Currency[] {
  const q = query.trim().toLowerCase();
  if (!q) return CURRENCIES;
  return CURRENCIES.filter((c) => [c.code, c.name, c.symbol, ...(c.aliases ?? [])].some((s) => s.toLowerCase().includes(q)));
}

/** 字段值 → 金额（容错：旧数据是数字、文字；认不出返回 null）。数字和没写币种的默认人民币。 */
export function moneyOf(v: FieldValue | undefined, fallbackCurrency = DEFAULT_CURRENCY): MoneyValue | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { amount: v, currency: fallbackCurrency } : null;
  if (typeof v === 'string') return parseMoney(v, fallbackCurrency);
  if (!Array.isArray(v) && typeof v === 'object') {
    const m = v as Partial<MoneyValue>;
    if (typeof m.amount === 'number' && Number.isFinite(m.amount)) return { amount: m.amount, currency: typeof m.currency === 'string' && currencyOf(m.currency) ? m.currency.toUpperCase() : fallbackCurrency };
  }
  return null;
}

// 前缀 / 后缀 → 币种。长的在前（「HK$」先于「$」）。单独的「¥」「$」按人民币 / 美元。
const SIGNS: Array<[RegExp, string]> = [
  [/^(?:us\$|usd)/i, 'USD'],
  [/^(?:s\$|sgd)/i, 'SGD'],
  [/^(?:hk\$|hkd)/i, 'HKD'],
  [/^(?:nt\$|twd)/i, 'TWD'],
  [/^(?:a\$|au\$|aud)/i, 'AUD'],
  [/^(?:c\$|ca\$|cad)/i, 'CAD'],
  [/^(?:nz\$|nzd)/i, 'NZD'],
  [/^(?:mop\$?)/i, 'MOP'],
  [/^(?:jp¥|jpy|円)/i, 'JPY'],
  [/^(?:rmb|cny|cn¥|￥|¥)/i, 'CNY'],
  [/^\$/, 'USD'],
  [/^(?:£|gbp)/i, 'GBP'],
  [/^(?:€|eur)/i, 'EUR'],
  [/^(?:₩|krw)/i, 'KRW'],
  [/^(?:₺|try|tl)/i, 'TRY'],
  [/^(?:₱|php)/i, 'PHP'],
  [/^(?:rm|myr)/i, 'MYR'],
  [/^(?:฿|thb)/i, 'THB'],
  [/^(?:₫|vnd)/i, 'VND'],
  [/^(?:rp|idr)/i, 'IDR'],
  [/^(?:₹|inr)/i, 'INR'],
  [/^(?:chf)/i, 'CHF'],
  [/^(?:aed)/i, 'AED'],
  [/^(?:₽|rub)/i, 'RUB'],
];

function currencyFromSign(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  for (const [re, code] of SIGNS) {
    const m = re.exec(t);
    if (m && m[0].length === t.length) return code;
  }
  // 中文名 / 别名：「1299 元」「30 英镑」「500 日元」
  const lower = t.toLowerCase();
  for (const c of CURRENCIES) if (c.name === t || c.aliases?.some((a) => a.toLowerCase() === lower)) return c.code;
  return null;
}

/** 解析一段价格文字：「$12.5」「£30」「1,299 元」「SGD 15」「12.5」。认不出返回 null。 */
export function parseMoney(text: string, fallbackCurrency = DEFAULT_CURRENCY): MoneyValue | null {
  const s = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const m = /^([^\d\-.]*?)\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*([^\d]*)$/.exec(s);
  if (!m) return null;
  const amount = Number(m[2]!.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const pre = m[1]!.trim();
  const post = m[3]!.trim();
  // NFKC 会把全角 ￥ 变成 ¥
  const a = pre ? currencyFromSign(pre) : null;
  const b = post ? currencyFromSign(post) : null;
  // 前后有认不出的字（「大概 100」「100 左右」）：不猜
  if ((pre && !a) || (post && !b)) return null;
  const cur = a ?? b;
  return { amount, currency: cur ?? fallbackCurrency };
}

/** 显示：Intl（zh-CN）按币种的小数位；整数金额不补 .00（「¥1,299」「US$12.50」「JP¥1,200」）。 */
export function formatMoney(m: MoneyValue): string {
  const currency = currencyOf(m.currency)?.code ?? m.currency;
  try {
    const base = new Intl.NumberFormat('zh-CN', { style: 'currency', currency });
    const max = base.resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(m.amount) ? 0 : max, maximumFractionDigits: max }).format(m.amount);
  } catch {
    return `${m.amount} ${currency}`;
  }
}

/** 上次用的币种：最近改过的资料里带金额的那条的币种；都没有就是人民币。 */
export function recentCurrency(items: readonly Pick<LibraryItem, 'fields' | 'updated_at' | 'deleted'>[], keys?: readonly string[]): string {
  let best: { at: string; cur: string } | null = null;
  for (const it of items) {
    if (it.deleted) continue;
    for (const [k, v] of Object.entries(it.fields)) {
      if (keys && !keys.includes(k)) continue;
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const m = moneyOf(v);
      if (m && (!best || it.updated_at > best.at)) best = { at: it.updated_at, cur: m.currency };
    }
  }
  return best?.cur ?? DEFAULT_CURRENCY;
}
