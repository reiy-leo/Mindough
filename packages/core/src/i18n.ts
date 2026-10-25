/**
 * 界面语言（Rei 2026-10-16：「添加中英文支持」）。
 *
 * 做法（gettext 式）：中文原文就是 key——代码里写 `tr('还在等 {n} 件事', { n })`，中文界面原样填参数；
 * 英文从 addMessages 注册的词典里取，值可以是字符串（同样的 {参数}）或函数（处理英文复数、语序）。
 * 词典里没有的 key 退回中文（测试会检查源码里每个 tr() 的 key 都有英文）。
 *
 * - core 的说法（日期、重复、完成方式…）的英文在 i18n-en.ts；内置数据（类型 / 字段 / 选项 / 打卡分类 / 网站名）在 i18n-data-en.ts；界面的在 apps/client/src/i18n/en.ts。
 * - 内部枚举值（待办 / 进行中 / 完成 / 关闭 / 可开始 / 被阻塞）和存进数据库的名字不翻译；内置类型 / 分类显示时，
 *   名字还是种子里的中文（用户没改过）才翻译，改过就照用户写的显示（displayName）。
 * - 日期、数字一律用 Intl，按 intlLocale()；一周仍从周一开始。
 */
export type Locale = 'zh' | 'en';
export type Params = Record<string, string | number | null | undefined>;
export type EnValue = string | ((p: Params) => string);

import { CORE_EN } from './i18n-en';
import { DATA_EN } from './i18n-data-en';

let current: Locale = 'zh';
const EN: Record<string, EnValue> = { ...CORE_EN };
/** 内置数据（类型名、字段名、选项、打卡分类、网站名、正文模板）的英文：显示时经 dataLabel 换。 */
const DATA: Record<string, string> = { ...DATA_EN };
const listeners = new Set<(l: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  for (const f of listeners) f(l);
}

export function onLocaleChange(f: (l: Locale) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 注册英文词典（key = 中文原文）。 */
export function addMessages(dict: Record<string, EnValue>): void {
  Object.assign(EN, dict);
}

export function hasMessage(zh: string): boolean {
  return zh in EN;
}

/**
 * 内置数据的显示名：存着的名字还是内置的中文（用户没改过）就按当前语言显示，否则照用户写的。
 * 用在类型名、字段名 / 占位、选项、打卡分类名、网站名、内置正文模板上。数据库里存的永远是原样。
 */
export function dataLabel(s: string | null | undefined): string {
  if (!s) return s ?? '';
  return current === 'en' && s in DATA ? DATA[s]! : s;
}

export function hasDataMessage(zh: string): boolean {
  return zh in DATA;
}

const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k] ?? '') : m)) : s);

/** 翻译：中文原文 → 当前语言。 */
export function tr(zh: string, params?: Params): string {
  if (current === 'en') {
    const v = EN[zh];
    if (typeof v === 'function') return v(params ?? {});
    if (typeof v === 'string') return fill(v, params);
  }
  return fill(zh, params);
}

/**
 * 带语境的翻译（gettext 的 pgettext）：同一个中文在不同位置英文不同时用，如导航里的「打卡」= Check-ins、按钮上的「打卡」= Check In。
 * 英文词典的 key 写成「语境|中文」；没有就退回普通的 tr(zh)。中文界面原样显示 zh。
 */
export function trc(ctx: string, zh: string, params?: Params): string {
  if (current === 'en') {
    const v = EN[`${ctx}|${zh}`];
    if (typeof v === 'function') return v(params ?? {});
    if (typeof v === 'string') return fill(v, params);
  }
  return tr(zh, params);
}

/**
 * App 名字（Rei 2026-10-24 定）：英文「Mindough」，中文「念头团」。界面上凡是要写 app 名的地方用 appName()，随界面语言切换；
 * 安装包名、bundle id、PWA manifest、导出文件夹名、User-Agent 这些不随语言的地方固定用 APP_NAME_EN。
 */
export const APP_NAME_EN = 'Mindough';
export function appName(): string {
  return tr('念头团');
}

/** 英文单复数：plural(3, 'task', 'tasks') → 'tasks'。 */
export function plural(n: number, one: string, other: string): string {
  return new Intl.PluralRules('en').select(n) === 'one' ? one : other;
}

/** Intl 用的语言标签。 */
export function intlLocale(l: Locale = current): string {
  return l === 'en' ? 'en-US' : 'zh-CN';
}

/**
 * 界面是不是中文（简体或繁体）：农历相关的设置和界面只在中文界面出现（Rei 2026-10-25）。
 * 现在只有 zh / en 两种语言；以后加 zh-Hant（或 zh-TW / zh-HK 这类标签）时，凡是 zh 开头的都算中文，不用再改调用方。
 */
export function isChineseLocale(locale: string = current): boolean {
  const l = locale.toLowerCase();
  return l === 'zh' || l.startsWith('zh-') || l.startsWith('zh_');
}

/** 系统语言 → 我们支持的语言（中文系的都算中文，其余英文）。 */
export function localeFromSystem(langs: readonly string[]): Locale {
  for (const l of langs) {
    const x = l.toLowerCase();
    if (x.startsWith('zh')) return 'zh';
    if (x.startsWith('en')) return 'en';
  }
  return 'en';
}
