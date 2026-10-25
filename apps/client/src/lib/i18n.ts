/**
 * 界面语言：tr() 来自 core（中文原文即 key），这里注册界面的英文词典（i18n/en.ts）、按需加载其他语言，并决定当前语言。
 * 语言设置：设置 → 语言（跟随系统 / 简体中文 / English / Español / Português (Brasil) / Русский / 日本語 / Deutsch / Français / Bahasa Indonesia），
 * 存进同步的偏好（pref `locale`），本机另存一份好在启动时立即用上。
 * 中文、英文打进主包；其他语言各一个文件（i18n/locales/<语言>.ts），用到时才加载，缺的 key 退回英文。
 */
import { addLocaleMessages, addMessages, appName, hasLocaleMessages, htmlLang, isLocale, localeFromSystem, setLocale, type Locale, type MessageValue } from '@mindough/core';
import { EN } from '../i18n/en';

export { tr, trc, plural, getLocale, intlLocale, dataLabel, appName, LOCALES, LOCALE_NAMES } from '@mindough/core';
export type LocalePref = 'system' | Locale;

addMessages(EN);

export const LOCALE_KEY = 'mindough:locale';

interface LocaleModule {
  MESSAGES: Record<string, MessageValue>;
  DATA: Record<string, string>;
}
const LOADERS: Partial<Record<Locale, () => Promise<LocaleModule>>> = {
  es: () => import('../i18n/locales/es'),
  'pt-BR': () => import('../i18n/locales/pt-BR'),
  ru: () => import('../i18n/locales/ru'),
  ja: () => import('../i18n/locales/ja'),
  de: () => import('../i18n/locales/de'),
  fr: () => import('../i18n/locales/fr'),
  id: () => import('../i18n/locales/id'),
};

/** 加载一种语言的词典（已经有了就直接返回）。加载失败时这种语言的字退回英文。 */
export async function loadLocale(l: Locale): Promise<void> {
  if (hasLocaleMessages(l)) return;
  const load = LOADERS[l];
  if (!load) return;
  const m = await load();
  addLocaleMessages(l, m.MESSAGES, m.DATA);
}

export const isLocalePref = (v: unknown): v is LocalePref => v === 'system' || isLocale(v);

export function systemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh';
  return localeFromSystem(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function resolveLocale(pref: LocalePref): Locale {
  return pref === 'system' ? systemLocale() : pref;
}

/** 地址栏 ?lang=（截图 / 调试）：zh、en、es、pt-BR、ru、ja、de、fr、id。 */
export function urlLocale(): Locale | null {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  return isLocale(q) ? q : null;
}

/** 启动时：地址栏 ?lang= > 本机存的 > 跟随系统。 */
export function initialLocalePref(): LocalePref {
  const q = urlLocale();
  if (q) return q;
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_KEY) : null;
  return isLocalePref(saved) ? saved : 'system';
}

/** 切到设置的语言并返回它；词典还没加载的先不切（调用方先 loadLocale）。 */
export function applyLocalePref(pref: LocalePref): Locale {
  const want = resolveLocale(pref);
  const l = hasLocaleMessages(want) ? want : 'en';
  setLocale(l);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = htmlLang(l);
    applyAppTitle(document);
  }
  return l;
}

/**
 * 网页标题与「添加到主屏幕」的名字随界面语言：中文「念头团」、其他语言「Mindough」（Rei 2026-10-24）。
 * index.html 里写的是 Mindough（还没跑 JS 时、爬虫看到的）；manifest 只有一种语言，保持 Mindough。
 */
export function applyAppTitle(doc: Pick<Document, 'querySelector'> & { title: string }): void {
  const name = appName();
  doc.title = name;
  doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
}
