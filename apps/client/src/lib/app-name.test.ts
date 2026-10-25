// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { appName, setLocale } from '@mindough/core';
import { applyAppTitle, applyLocalePref } from './i18n';
import { menuLabels } from './app-menu';

/** 最小的 document：title + apple-mobile-web-app-title 那个 meta。 */
function fakeDoc() {
  const meta = { content: 'Mindough', setAttribute(k: string, v: string) { if (k === 'content') this.content = v; } };
  return { title: 'Mindough', meta, querySelector: (s: string) => (s.includes('apple-mobile-web-app-title') ? meta : null) } as unknown as Document & { meta: typeof meta };
}

afterEach(() => setLocale('zh'));

describe('app 名字随界面语言（Rei 2026-10-24：中文「念头团」、英文「Mindough」）', () => {
  it('中文界面：网页标题和主屏幕名都是念头团', () => {
    applyLocalePref('zh');
    expect(appName()).toBe('念头团');
    const doc = fakeDoc();
    applyAppTitle(doc);
    expect(doc.title).toBe('念头团');
    expect(doc.meta.content).toBe('念头团');
  });

  it('英文界面：Mindough', () => {
    applyLocalePref('en');
    expect(appName()).toBe('Mindough');
    const doc = fakeDoc();
    applyAppTitle(doc);
    expect(doc.title).toBe('Mindough');
    expect(doc.meta.content).toBe('Mindough');
  });

  it('切回中文跟着变；菜单栏文字也跟着变', () => {
    applyLocalePref('en');
    expect(menuLabels().about).toBe('About Mindough');
    applyLocalePref('zh');
    const doc = fakeDoc();
    applyAppTitle(doc);
    expect(doc.title).toBe('念头团');
    expect(menuLabels().about).toBe('关于念头团');
    expect(menuLabels().quit).toBe('退出念头团');
  });
});
