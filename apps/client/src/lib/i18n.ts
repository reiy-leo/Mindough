/**
 * 界面语言：tr() 来自 core（中文原文即 key），这里注册界面的英文词典（i18n/en.ts）并决定当前语言。
 * 语言设置：设置 → 语言（跟随系统 / 中文 / English），存进同步的偏好（pref `locale`），本机另存一份好在启动时立即用上。
 */
import { addMessages, appName, localeFromSystem, setLocale, type Locale } from '@mindough/core';
import { EN } from '../i18n/en';

export { tr, trc, plural, getLocale, intlLocale, dataLabel, appName } from '@mindough/core';
export type LocalePref = 'system' | Locale;

addMessages(EN);

export const LOCALE_KEY = 'mindough:locale';

export function systemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh';
  return localeFromSystem(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function resolveLocale(pref: LocalePref): Locale {
  return pref === 'system' ? systemLocale() : pref;
}

/** 启动时：地址栏 ?lang=（截图 / 调试）> 本机存的 > 跟随系统。 */
export function initialLocalePref(): LocalePref {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (q === 'zh' || q === 'en') return q;
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_KEY) : null;
  return saved === 'zh' || saved === 'en' || saved === 'system' ? saved : 'system';
}

export function applyLocalePref(pref: LocalePref): Locale {
  const l = resolveLocale(pref);
  setLocale(l);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    applyAppTitle(document);
  }
  return l;
}

/**
 * 网页标题与「添加到主屏幕」的名字随界面语言：中文「思想团」、英文「Mindough」（Rei 2026-10-24）。
 * index.html 里写的是 Mindough（还没跑 JS 时、爬虫看到的）；manifest 只有一种语言，保持 Mindough。
 */
export function applyAppTitle(doc: Pick<Document, 'querySelector'> & { title: string }): void {
  const name = appName();
  doc.title = name;
  doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
}
