// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MOOD_IDS } from '@mindough/core';
import { MoodWheel, wheelKey, wheelPoint } from './MoodWheel';

describe('心情轮（日记改版 B）', () => {
  it('12 张脸排成半圆：第一张在最左、最后一张在最右，中间那几张最高，左右对称', () => {
    const n = MOOD_IDS.length;
    const pts = MOOD_IDS.map((_, i) => wheelPoint(i, n));
    expect(pts[0]!.x).toBeLessThan(10);
    expect(pts[n - 1]!.x).toBeGreaterThan(90);
    for (let i = 1; i < n; i++) expect(pts[i]!.x).toBeGreaterThan(pts[i - 1]!.x);
    expect(pts[0]!.y).toBeCloseTo(pts[n - 1]!.y, 5);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(pts[5]!.y, 5);
    for (const p of pts) {
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(100);
    }
  });

  it('方向键换脸、两头接上，Home / End 到两头，别的键不管', () => {
    expect(wheelKey(0, 'ArrowRight', 12)).toBe(1);
    expect(wheelKey(0, 'ArrowDown', 12)).toBe(1);
    expect(wheelKey(0, 'ArrowLeft', 12)).toBe(11);
    expect(wheelKey(11, 'ArrowRight', 12)).toBe(0);
    expect(wheelKey(5, 'ArrowUp', 12)).toBe(4);
    expect(wheelKey(5, 'Home', 12)).toBe(0);
    expect(wheelKey(5, 'End', 12)).toBe(11);
    expect(wheelKey(5, 'Enter', 12)).toBeNull();
    expect(wheelKey(5, 'a', 12)).toBeNull();
  });

  it('是一组单选：只有选中那张 aria-checked、可以 Tab 进来；没选时第一张能 Tab 进来、中间是「点一张脸」', () => {
    const html = renderToStaticMarkup(<MoodWheel value="calm" onChange={() => {}} />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(12);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" aria-label="[^"]*" tabindex="0"/);
    const empty = renderToStaticMarkup(<MoodWheel value={null} onChange={() => {}} />);
    expect(empty).not.toContain('aria-checked="true"');
    expect(empty.indexOf('tabindex="0"')).toBeLessThan(empty.indexOf('tabindex="-1"'));
    expect(empty).toContain('mood-wheel-center is-empty');
  });

  it('窄的地方不写脸的名字', () => {
    expect(renderToStaticMarkup(<MoodWheel value={null} onChange={() => {}} compact />)).not.toContain('mood-wheel-label');
    expect(renderToStaticMarkup(<MoodWheel value={null} onChange={() => {}} />).match(/mood-wheel-label/g)).toHaveLength(12);
  });
});
