/**
 * 界面语言的根：决定当前语言、换语言时整棵界面重新挂载（key = 语言），并把 React Aria 的 I18nProvider 跟上。
 * 语言设置存在同步的偏好 pref `locale`（跟随系统 / 中文 / English，各设备一致）；本机另存一份，启动时立即用上（不闪中文）。
 * 地址栏 ?lang=zh|en 临时覆盖（截图 / 调试），不写进设置。
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { getLocale, intlLocale } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { applyLocalePref, LOCALE_KEY, type LocalePref } from './i18n';

const PREF_KEY = 'locale';
const isPref = (v: unknown): v is LocalePref => v === 'system' || v === 'zh' || v === 'en';
const urlLang = (): LocalePref | null => {
  const q = new URLSearchParams(location.search).get('lang');
  return q === 'zh' || q === 'en' ? q : null;
};
const localPref = (): LocalePref => {
  const v = localStorage.getItem(LOCALE_KEY);
  return isPref(v) ? v : 'system';
};

/** 设置里用：当前的语言设置与修改。 */
export function useLocalePref(): [LocalePref, (p: LocalePref) => void] {
  const store = useStore();
  const synced = store.pref(PREF_KEY);
  const pref = isPref(synced) ? synced : localPref();
  return [
    pref,
    (p) => {
      localStorage.setItem(LOCALE_KEY, p);
      store.setPref(PREF_KEY, p);
    },
  ];
}

export function LocaleRoot({ children }: { children: ReactNode }) {
  const store = useStore();
  const synced = store.pref(PREF_KEY);
  const pref = urlLang() ?? (isPref(synced) ? synced : localPref());
  // 系统语言变了（跟随系统时）也要重新渲染
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('languagechange', on);
    return () => window.removeEventListener('languagechange', on);
  }, []);
  // 渲染前就切好（tr 是全局的，子组件这一轮就读到新语言）
  const locale = applyLocalePref(pref);
  useEffect(() => {
    // 别的设备改了语言、同步下来：本机这份也跟上，下次启动直接用
    if (isPref(synced) && !urlLang()) localStorage.setItem(LOCALE_KEY, synced);
  }, [synced]);
  return (
    <I18nProvider locale={intlLocale(locale)}>
      <Fragment key={locale}>{children}</Fragment>
    </I18nProvider>
  );
}

export { getLocale };
