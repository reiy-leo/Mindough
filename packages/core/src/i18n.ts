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
 * - 日期、数字一律用 Intl，按 intlLocale()；一周从哪天开始看 weekStartsOn()（Intl 的地区数据，中文仍是周一）。
 * - 其他语言（Rei 2026-10-25：西、葡（巴西）、俄、日、德、法、印尼）：每种一份完整词典（客户端 apps/client/src/i18n/locales/），
 *   按需加载后 addLocaleMessages 注册；值是字符串，复数写 {n, plural, …}（formatMessage）。缺的 key 退回英文。
 */
export type Locale = 'zh' | 'en' | 'es' | 'pt-BR' | 'ru' | 'ja' | 'de' | 'fr' | 'id';
export type Params = Record<string, string | number | null | undefined>;
export type EnValue = string | ((p: Params) => string);
/** 其他语言的译文：字符串（可以带 {n, plural, one {…} other {…}}），少数要逻辑的写函数。 */
export type MessageValue = EnValue;

import { CORE_EN } from './i18n-en';
import { DATA_EN } from './i18n-data-en';

/**
 * 支持的界面语言（Rei 2026-10-25「支持西、葡、俄、日、德、法、印尼」）。顺序就是设置里的顺序；
 * 名字用各自的语言写（Español、日本語…），不随界面语言变。
 */
export const LOCALES: readonly Locale[] = ['zh', 'en', 'es', 'pt-BR', 'ru', 'ja', 'de', 'fr', 'id'];
export const LOCALE_NAMES: Record<Locale, string> = {
  zh: '简体中文', // i18n-ignore 语言名用它自己的语言写
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  ja: '日本語', // i18n-ignore 语言名用它自己的语言写
  de: 'Deutsch',
  fr: 'Français',
  id: 'Bahasa Indonesia',
};
export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

let current: Locale = 'zh';
const EN: Record<string, EnValue> = { ...CORE_EN };
/** 内置数据（类型名、字段名、选项、打卡分类、网站名、正文模板）的英文：显示时经 dataLabel 换。 */
const DATA: Record<string, string> = { ...DATA_EN };
/** 其他语言（es、pt-BR、ru、ja、de、fr、id）的词典：客户端按需加载后用 addLocaleMessages 注册。 */
const MSG: Partial<Record<Locale, Record<string, MessageValue>>> = {};
const LDATA: Partial<Record<Locale, Record<string, string>>> = {};
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

/** 注册其他语言的词典：messages 是界面 + core 的说法，data 是内置数据的名字。缺的 key 退回英文。 */
export function addLocaleMessages(l: Locale, messages: Record<string, MessageValue>, data: Record<string, string> = {}): void {
  Object.assign((MSG[l] ??= {}), messages);
  Object.assign((LDATA[l] ??= {}), data);
}

/** 这种语言的词典有没有注册过（中文、英文一直都有）。 */
export function hasLocaleMessages(l: Locale): boolean {
  return l === 'zh' || l === 'en' || !!MSG[l];
}

export function hasMessage(zh: string): boolean {
  return zh in EN;
}

/** 英文词典的全部 key（测试用：检查每种语言都齐）。 */
export function messageKeys(): string[] {
  return Object.keys(EN);
}
export function dataKeys(): string[] {
  return Object.keys(DATA);
}

/**
 * 内置数据的显示名：存着的名字还是内置的中文（用户没改过）就按当前语言显示，否则照用户写的。
 * 用在类型名、字段名 / 占位、选项、打卡分类名、网站名、内置正文模板上。数据库里存的永远是原样。
 * 其他语言没有这个名字时退回英文。
 */
export function dataLabel(s: string | null | undefined): string {
  if (!s) return s ?? '';
  if (current === 'zh' || !(s in DATA)) return s;
  return (current !== 'en' && LDATA[current]?.[s]) || DATA[s]!;
}

/** 内置数据的英文名（不看当前语言；没有就原样）。搜索用：任何语言下都能用英文名搜到内置类型。 */
export function dataEnglish(s: string): string {
  return DATA[s] ?? s;
}

export function hasDataMessage(zh: string): boolean {
  return zh in DATA;
}

const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k] ?? '') : m)) : s);

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(n: number, l: Locale): string {
  const tag = intlLocale(l);
  let r = pluralRules.get(tag);
  if (!r) pluralRules.set(tag, (r = new Intl.PluralRules(tag)));
  return r.select(n);
}

/**
 * 译文里的复数：`{n, plural, one {# tarea} few {# задачи} many {# задач} other {# tareas}}`（ICU MessageFormat 的一小部分）。
 * 分类按 Intl.PluralRules（俄语 one / few / many / other，日语、印尼语只有 other）；`=0` 这类精确值优先。
 * `#` 换成参数原样（trx 里参数是元素占位时，数字看 p.count）。分支里可以再写 {别的参数}。
 */
export function formatMessage(s: string, p: Params = {}, l: Locale = current): string {
  if (!s.includes(', plural,')) return fill(s, p);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const m = /\{(\w+), plural,/g;
    m.lastIndex = i;
    const hit = m.exec(s);
    if (!hit) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, hit.index);
    const name = hit[1]!;
    let j = hit.index + hit[0].length;
    const options: Record<string, string> = {};
    // 读「类别 {内容}」直到这一层的 }
    for (;;) {
      while (s[j] === ' ') j++;
      if (s[j] === '}' || j >= s.length) {
        j++;
        break;
      }
      const km = /^(=?\w+)\s*\{/.exec(s.slice(j));
      if (!km) throw new Error(`bad plural in: ${s}`);
      j += km[0].length;
      let depth = 1;
      const st = j;
      while (j < s.length && depth) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        j++;
      }
      options[km[1]!] = s.slice(st, j - 1);
    }
    const raw = p[name];
    let num = Number(raw);
    if (raw === null || raw === undefined || raw === '' || Number.isNaN(num)) num = Number(p.count ?? 0);
    const branch = options[`=${num}`] ?? options[pluralCategory(num, l)] ?? options.other ?? '';
    out += formatMessage(branch.replace(/#/g, String(raw ?? num)), p, l);
    i = j;
  }
  return fill(out, p);
}

function lookup(key: string): EnValue | undefined {
  if (current === 'zh') return undefined;
  if (current !== 'en') {
    const v = MSG[current]?.[key];
    if (v !== undefined) return v;
  }
  return EN[key];
}

function render(v: EnValue, params?: Params): string {
  return typeof v === 'function' ? v(params ?? {}) : formatMessage(v, params);
}

/** 翻译：中文原文 → 当前语言。没有译文时退回英文，英文也没有就用中文。 */
export function tr(zh: string, params?: Params): string {
  const v = lookup(zh);
  return v === undefined ? fill(zh, params) : render(v, params);
}

/**
 * 带语境的翻译（gettext 的 pgettext）：同一个中文在不同位置译法不同时用，如导航里的「打卡」= Check-ins、按钮上的「打卡」= Check In。
 * 词典的 key 写成「语境|中文」；没有就退回普通的 tr(zh)。中文界面原样显示 zh。
 */
export function trc(ctx: string, zh: string, params?: Params): string {
  const v = lookup(`${ctx}|${zh}`);
  return v === undefined ? tr(zh, params) : render(v, params);
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
const INTL_TAG: Record<Locale, string> = { zh: 'zh-CN', en: 'en-US', es: 'es-ES', 'pt-BR': 'pt-BR', ru: 'ru-RU', ja: 'ja-JP', de: 'de-DE', fr: 'fr-FR', id: 'id-ID' };
export function intlLocale(l: Locale = current): string {
  return INTL_TAG[l] ?? 'en-US';
}

/** html lang 属性。 */
export function htmlLang(l: Locale = current): string {
  return l === 'zh' ? 'zh-CN' : l;
}

/**
 * 一周从哪天开始：0 = 周日，1 = 周一。按 Intl 的地区数据（en-US、pt-BR、ja、id 从周日开始，其他从周一）；
 * 浏览器没有 getWeekInfo（Firefox）时用同样的表。
 */
const SUNDAY_FIRST: ReadonlySet<Locale> = new Set(['en', 'pt-BR', 'ja', 'id']);
export function weekStartsOn(l: Locale = current): 0 | 1 {
  try {
    const loc = new Intl.Locale(intlLocale(l)) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info && typeof info.firstDay === 'number') return info.firstDay === 7 ? 0 : 1;
  } catch {
    /* 老浏览器 */
  }
  return SUNDAY_FIRST.has(l) ? 0 : 1;
}

/** 从一周第一天起的七个星期几（0 = 周日）：[1…6, 0] 或 [0…6]。 */
export function weekOrder(l: Locale = current): number[] {
  return weekStartsOn(l) === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
}

/**
 * 界面是不是中文（简体或繁体）：农历相关的设置和界面只在中文界面出现（Rei 2026-10-25）。
 * 现在中文只有简体（zh）；以后加 zh-Hant（或 zh-TW / zh-HK 这类标签）时，凡是 zh 开头的都算中文，不用再改调用方。
 */
export function isChineseLocale(locale: string = current): boolean {
  const l = locale.toLowerCase();
  return l === 'zh' || l.startsWith('zh-') || l.startsWith('zh_');
}

/**
 * 系统语言 → 我们支持的语言：按系统的语言顺序找第一个认得的。中文系的都算简体中文，葡萄牙语（含 pt-PT）都用巴西葡萄牙语，
 * 印尼语认 id 和旧代码 in；一个都认不出就用英文。
 */
export function localeFromSystem(langs: readonly string[]): Locale {
  for (const l of langs) {
    const x = l.toLowerCase().replace('_', '-');
    const base = x.split('-')[0];
    if (base === 'zh') return 'zh';
    if (base === 'en') return 'en';
    if (base === 'es') return 'es';
    if (base === 'pt') return 'pt-BR';
    if (base === 'ru') return 'ru';
    if (base === 'ja') return 'ja';
    if (base === 'de') return 'de';
    if (base === 'fr') return 'fr';
    if (base === 'id' || base === 'in') return 'id';
  }
  return 'en';
}
