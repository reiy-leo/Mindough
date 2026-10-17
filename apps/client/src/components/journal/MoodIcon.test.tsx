// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MOOD_IDS } from '@mindough/core';
import { MoodIcon } from './MoodIcon';

describe('心情图标', () => {
  it('12 个各画各的、颜色走 --mood 令牌（类名），不写死颜色', () => {
    const svgs = MOOD_IDS.map((id) => renderToStaticMarkup(<MoodIcon mood={id} />));
    expect(new Set(svgs).size).toBe(12);
    for (const [i, svg] of svgs.entries()) {
      expect(svg).toContain(`mood-${MOOD_IDS[i]}`);
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}/i);
      expect(svg).toContain('aria-hidden="true"');
    }
  });
  it('点选时带 is-playing；不认识的 id 画成「一般」', () => {
    expect(renderToStaticMarkup(<MoodIcon mood="happy" playing />)).toContain('is-playing');
    expect(renderToStaticMarkup(<MoodIcon mood="future-mood" />)).toBe(renderToStaticMarkup(<MoodIcon mood="okay" />));
  });
});
