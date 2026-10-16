import { describe, expect, it } from 'vitest';
import { fitBox, layoutShape, normalizeImage } from './image';

describe('图片统一宽高', () => {
  it('海报：宽图居中裁成 2:3，画成 600×900', () => {
    expect(fitBox(1000, 1000, 'poster')).toEqual({ sx: (1000 - 1000 * (2 / 3)) / 2, sy: 0, sw: 1000 * (2 / 3), sh: 1000, dw: 600, dh: 900 });
  });
  it('横幅：竖图上下裁成 16:9，画成 1280×720', () => {
    const b = fitBox(900, 1600, 'banner');
    expect(b.sw).toBe(900);
    expect(b.sh).toBeCloseTo(900 * 9 / 16);
    expect(b.sy).toBeCloseTo((1600 - 900 * 9 / 16) / 2);
    expect([b.dw, b.dh]).toEqual([1280, 720]);
  });
  it('方形 / 圆形 600×600；小图也放大到统一尺寸', () => {
    expect(fitBox(120, 80, 'square')).toMatchObject({ sx: 20, sw: 80, sh: 80, dw: 600, dh: 600 });
    expect(fitBox(300, 300, 'round')).toMatchObject({ dw: 600, dh: 600 });
  });
  it('没形状：不裁，长边缩到 1600 以内，小图不动', () => {
    expect(fitBox(3200, 1600, null)).toEqual({ sx: 0, sy: 0, sw: 3200, sh: 1600, dw: 1600, dh: 800 });
    expect(fitBox(800, 600, null)).toMatchObject({ dw: 800, dh: 600 });
  });
  it('版式对应形状', () => {
    expect(['poster', 'banner', 'round', 'icon_name', 'text'].map(layoutShape)).toEqual(['poster', 'banner', 'round', 'square', 'square']);
  });
  it('解不了的（不是图片 / svg）原样返回', async () => {
    const txt = new Blob(['x'], { type: 'text/plain' });
    expect((await normalizeImage(txt, 'poster')).blob).toBe(txt);
    const svg = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    expect((await normalizeImage(svg, 'poster')).blob).toBe(svg);
  });
});
