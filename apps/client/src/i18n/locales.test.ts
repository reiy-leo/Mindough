// @vitest-environment node
/**
 * 多语言词典的守门测试（Rei 2026-10-25「支持西、葡、俄、日、德、法、印尼」）：
 * 1. 每种语言的词典和英文一样全：不缺 key、不多 key（MESSAGES 对 core + 界面，DATA 对内置数据）。
 * 2. 没有空值（英文本来就是空的除外）。
 * 3. 占位符一致：译文里的 {参数} 都在中文原文里；原文的参数只有英文也没用到时才可以不写。
 * 4. 复数写法读得通；俄语的复数要写 one / few / many 三种。
 * 5. 切到某种语言后 tr 用它的译文，缺的 key 退回英文。
 * 6. 法语 : ; ? ! » 前面、« 后面用不换行空格（: 用 U+00A0，其余 U+202F），免得标点折到下一行。
 */
import { describe, expect, it } from 'vitest';
import { addLocaleMessages, dataKeys, formatMessage, LOCALES, messageKeys, setLocale, tr, type Locale, type MessageValue } from '@mindough/core';
import { EN } from './en';
import { CORE_EN } from '../../../../packages/core/src/i18n-en';
import { DATA_EN } from '../../../../packages/core/src/i18n-data-en';
import '../lib/i18n';
import * as es from './locales/es';
import * as ptBR from './locales/pt-BR';
import * as ru from './locales/ru';
import * as ja from './locales/ja';
import * as de from './locales/de';
import * as fr from './locales/fr';
import * as id from './locales/id';

const MODULES: Record<string, { MESSAGES: Record<string, MessageValue>; DATA: Record<string, string> }> = { es, 'pt-BR': ptBR, ru, ja, de, fr, id };
const ALL_EN: Record<string, MessageValue> = { ...CORE_EN, ...EN };
const M = '\u0001';
const zhOf = (k: string) => (k.includes('|') ? k.slice(k.indexOf('|') + 1) : k);
const keyParams = (k: string) => new Set([...zhOf(k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));

/** 渲染一个值，看用到了哪些参数：参数填成记号，复数分支按 n 取。 */
function usedParams(v: MessageValue, names: Set<string>, l: Locale, n = 3): Set<string> {
  const p: Record<string, string | number> = {};
  for (const x of names) p[x] = `${M}${x}${M}`;
  p.count = n;
  const out = typeof v === 'function' ? v(p) : formatMessage(v, p, l);
  return new Set([...out.matchAll(new RegExp(`${M}(\\w+)${M}`, 'g'))].map((m) => m[1]!));
}

describe('多语言词典', () => {
  it('九种语言：中文、英文 + 七种按需加载', () => {
    expect(LOCALES).toEqual(['zh', 'en', 'es', 'pt-BR', 'ru', 'ja', 'de', 'fr', 'id']);
    expect(Object.keys(MODULES).sort()).toEqual(LOCALES.filter((l) => l !== 'zh' && l !== 'en').sort());
  });

  for (const [lang, mod] of Object.entries(MODULES)) {
    const l = lang as Locale;
    describe(lang, () => {
      it('key 和英文一样全', () => {
        const want = new Set(messageKeys());
        const have = new Set(Object.keys(mod.MESSAGES));
        expect([...want].filter((k) => !have.has(k))).toEqual([]);
        expect([...have].filter((k) => !want.has(k))).toEqual([]);
        const wantD = new Set(dataKeys());
        const haveD = new Set(Object.keys(mod.DATA));
        expect([...wantD].filter((k) => !haveD.has(k))).toEqual([]);
        expect([...haveD].filter((k) => !wantD.has(k))).toEqual([]);
      });

      it('没有空值', () => {
        const empty = Object.entries(mod.MESSAGES).filter(([k, v]) => v === '' && ALL_EN[k] !== '').map(([k]) => k);
        const emptyD = Object.entries(mod.DATA).filter(([k, v]) => !v.trim() && DATA_EN[k]?.trim()).map(([k]) => k);
        expect([...empty, ...emptyD]).toEqual([]);
      });

      it('占位符和原文一致', () => {
        const bad: string[] = [];
        for (const [k, v] of Object.entries(mod.MESSAGES)) {
          const names = keyParams(k);
          if (!names.size) {
            if (typeof v === 'string' && /\{\w+\}/.test(v)) bad.push(`${k} → 多了参数：${v}`);
            continue;
          }
          const en = ALL_EN[k];
          const enUsed = en === undefined ? names : new Set([...usedParams(en, names, 'en', 1), ...usedParams(en, names, 'en', 3)]);
          const used = new Set([...usedParams(v, names, l, 1), ...usedParams(v, names, l, 3), ...usedParams(v, names, l, 5)]);
          for (const x of names) if (!used.has(x) && enUsed.has(x)) bad.push(`${k} → 少了 {${x}}：${String(v)}`);
          if (typeof v === 'string') {
            const raw = new Set([...v.matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)(?:\}|, plural,)/g)].map((m) => m[1]!));
            for (const x of raw) if (!names.has(x)) bad.push(`${k} → 原文没有 {${x}}：${v}`);
          }
        }
        expect(bad).toEqual([]);
      });

      it('复数写法读得通' + (l === 'ru' ? '（俄语写全 one / few / many）' : ''), () => {
        const bad: string[] = [];
        for (const [k, v] of Object.entries(mod.MESSAGES)) {
          if (typeof v !== 'string' || !v.includes(', plural,')) continue;
          for (const n of [0, 1, 2, 5, 21, 1000000]) {
            try {
              const s = formatMessage(v, { count: n, ...Object.fromEntries([...keyParams(k)].map((x) => [x, n])) }, l);
              if (s.includes(', plural,')) bad.push(`${k} → 没展开：${s}`);
            } catch (e) {
              bad.push(`${k} → ${String(e)}`);
            }
          }
          if (l === 'ru') for (const m of v.matchAll(/\{\w+, plural,([^]*?)\}\}/g)) if (!/\bfew\s*\{/.test(m[1]!) || !/\bmany\s*\{/.test(m[1]!)) bad.push(`${k} → 俄语复数缺 few / many：${v}`);
        }
        expect(bad).toEqual([]);
      });
    });
  }

  it('切换语言后 tr 用译文，缺的 key 退回英文', () => {
    addLocaleMessages('es', es.MESSAGES, es.DATA);
    addLocaleMessages('ru', ru.MESSAGES, ru.DATA);
    try {
      setLocale('es');
      expect(tr('我的一天')).toBe(es.MESSAGES['我的一天']);
      expect(tr('{n} 件任务', { n: 1 })).toMatch(/^1 /);
      addLocaleMessages('es', {}, {});
      expect(tr('只在测试里出现的句子')).toBe('只在测试里出现的句子');
      setLocale('ru');
      const few = tr('{n} 件任务', { n: 3 });
      const many = tr('{n} 件任务', { n: 5 });
      expect(few).not.toBe(many.replace('5', '3'));
    } finally {
      setLocale('zh');
    }
  });
  it('法语标点前用不换行空格', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries({ ...fr.MESSAGES, ...fr.DATA })) {
      const out = typeof v === 'function' ? v({ n: 5, count: 5, unit: '', verb: 'x', names: 'y' }) : v;
      if (/ [:;?!»]|« /.test(out)) bad.push(`${k} → ${out}`);
    }
    expect(bad).toEqual([]);
  });
});
