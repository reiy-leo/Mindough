// @vitest-environment happy-dom
/**
 * markdown 读写和换编辑器前完全一样（Rei 2026-10-25 从 Milkdown 换成 Tiptap）。
 * markdown.fixtures.json 是换之前用 Milkdown 7 跑出来的：190 段（各种写法、以前测试里的样例、内置模板、演示数据），
 * 每段记着原文、读写一遍的结果、再读写一遍的结果。这里逐条比：Tiptap 版读写出来必须一字不差。
 */
import { describe, expect, it } from 'vitest';
import fixtures from './markdown.fixtures.json';
import { roundTrip } from './editor';

describe('和 Milkdown 的输出逐条一致', () => {
  it.each((fixtures as { input: string; out: string; out2: string }[]).map((f, i) => [i, f] as const))('#%i', (_i, f) => {
    expect(roundTrip(f.input)).toBe(f.out);
    expect(roundTrip(f.out)).toBe(f.out2);
  });
});
