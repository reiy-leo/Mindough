// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyMaterialClass, materialWindowOptions, syncWindowMaterial, VIBRANT_CLASS } from './vibrancy';

/** 最小的 html 元素：classList + dataset。 */
function fakeEl() {
  const classes = new Set<string>();
  return {
    classes,
    dataset: {} as Record<string, string>,
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
  } as unknown as HTMLElement & { classes: Set<string> };
}

describe('窗口材质（Rei 2026-10-26：侧边栏背景要像原生 app 一样透出壁纸）', () => {
  it('有材质才加 is-vibrant 和 data-material', () => {
    const el = fakeEl();
    applyMaterialClass(el, 'vibrancy');
    expect(el.classes.has(VIBRANT_CLASS)).toBe(true);
    expect(el.dataset.material).toBe('vibrancy');
    applyMaterialClass(el, 'mica');
    expect(el.dataset.material).toBe('mica');
  });

  it('没有材质（Win10、Linux、网页版）就去掉，照旧纯色', () => {
    const el = fakeEl();
    applyMaterialClass(el, 'mica');
    applyMaterialClass(el, 'none');
    expect(el.classes.has(VIBRANT_CLASS)).toBe(false);
    expect(el.dataset.material).toBeUndefined();
  });

  it('网页版：不问原生端，新窗口也不带透明', async () => {
    expect(await syncWindowMaterial('dark')).toBe('none');
    expect(await materialWindowOptions()).toEqual({});
  });
});
