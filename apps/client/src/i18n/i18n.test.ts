// @vitest-environment node
/// <reference types="node" />
/**
 * 中英文界面的守门测试：
 * 1. 组件 / 页面 / core 里没有漏翻的中文（不在 tr / trx / trc 里的中文字面量、JSX 文本）。数据文件、解析用的文件在白名单里。
 * 2. 每个 tr() 的 key 都有英文。
 * 3. 内置数据（类型、字段、选项、27 个打卡分类、网站名、正文模板）的每个中文都有英文。
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CHECKIN_CATEGORIES, BUILTIN_TASK_TYPES, dataLabel, hasDataMessage, hasMessage, setLocale, tr } from '@mindough/core';
import '../lib/i18n';
import { scan, scanFile, walk } from './scan';

const CLIENT = path.resolve(__dirname, '..');
const CORE = path.resolve(__dirname, '../../../../packages/core/src');

/** 不检查漏翻的文件（理由写在旁边）。 */
const SKIP = [
  '/i18n/', // 词典与扫描本身
  'i18n-en.ts',
  'i18n-data-en.ts',
  'storage/schema.ts', // 迁移名与 SQL
  'sync/memory-remote.ts', // 测试用的假云端
  'episode.ts', // 认「第二季第三集」的正则与中文数字
  'money.ts', // 币种中文名与搜索别名（显示走 currencyName）
  'timezone-names.ts', // 时区的中文城市名：只在中文界面用，英文用 IANA 名
  'timezone-names-intl.ts', // 其他语言的时区城市名（CLDR 数据，日文里有汉字）
  'lunar/names.ts', // 农历月名、日名、节气、节日：中英文界面都照中文显示（同 Apple 日历），英文说法在同文件里按语言分支
  'lunar/data.ts', // 生成的数据表（注释）
  'pinyin-polyphone.ts', // 拼音搜索的多音字表（只用来对搜索词，不显示）
  'lib/icon-keywords.ts', // 图标搜索的中文关键词（只用来对搜索词，不显示）
];
/** 数据文件：里面的中文都要在 DATA_EN（显示时 dataLabel 翻译）。 */
const DATA_FILES = ['seed/builtin-types.ts', 'seed/builtin-checkin-categories.ts', 'links.ts'];

const skip = (p: string) => SKIP.some((s) => p.includes(s)) || DATA_FILES.some((s) => p.endsWith(s));
const rel = (p: string) => path.relative(path.resolve(CLIENT, '../../..'), p);

describe('i18n', () => {
  const files = [...walk(CLIENT, skip), ...walk(CORE, skip)];
  const { keys, bare } = scan(files, hasDataMessage);

  it('组件与 core 里没有漏翻的中文', () => {
    expect(bare.map((b) => `${rel(b.file)}:${b.line} ${b.text}`)).toEqual([]);
  });

  it('每个 tr() 的 key 都有英文', () => {
    expect(keys.size).toBeGreaterThan(500);
    const missing = [...keys].filter((k) => !hasMessage(k) && !(k.includes('|') && hasMessage(k.slice(k.indexOf('|') + 1))));
    expect(missing).toEqual([]);
  });

  it('数据文件里的中文都有英文（显示时翻译）', () => {
    const missing: string[] = [];
    for (const f of DATA_FILES) for (const b of scanFile(path.join(CORE, f), true).bare) if (!hasDataMessage(b.text)) missing.push(`${f}:${b.line} ${b.text}`);
    expect(missing).toEqual([]);
  });

  it('每个内置名字都有英文：类型、字段、选项、单位、模板、27 个打卡分类', () => {
    const names: string[] = [];
    for (const t of BUILTIN_TASK_TYPES) {
      names.push(t.name);
      if (t.body_template) names.push(t.body_template);
      for (const f of t.fields) {
        names.push(f.label);
        if (f.placeholder && /[\u4e00-\u9fff]/.test(f.placeholder)) names.push(f.placeholder);
        if (f.unit && /[\u4e00-\u9fff]/.test(f.unit)) names.push(f.unit);
        for (const o of f.options ?? []) if (/[\u4e00-\u9fff]/.test(o)) names.push(o);
      }
    }
    expect(BUILTIN_CHECKIN_CATEGORIES).toHaveLength(27);
    for (const c of BUILTIN_CHECKIN_CATEGORIES) names.push(c.name);
    expect(names.filter((n) => !hasDataMessage(n) && !/^[\x20-\x7e]+$/.test(n))).toEqual([]);
  });

  it('英文界面：内置名字按英文显示，用户改过的照原样', () => {
    setLocale('en');
    try {
      expect(dataLabel('健康')).toBe('Health');
      expect(dataLabel('影视')).toBe('Movies & TV');
      expect(dataLabel('我的健身')).toBe('我的健身');
      expect(tr('我的一天')).toBe('My Day');
      expect(tr('{length} 项', { length: 1 })).toBe('1 item');
      expect(tr('{length} 项', { length: 3 })).toBe('3 items');
    } finally {
      setLocale('zh');
    }
    expect(dataLabel('健康')).toBe('健康');
    expect(tr('我的一天')).toBe('我的一天');
  });
});
