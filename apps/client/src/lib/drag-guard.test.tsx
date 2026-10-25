// @vitest-environment happy-dom
/**
 * 拖动排序后不留高亮、不选中（Rei 2026-10-25「拖拽调整顺序后不要highlight」）：
 * 鼠标 / 触屏拖完，焦点离开列表、交互方式改回 pointer；键盘拖动保留焦点；拖动中和刚放下时的点按不算点开。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const modality = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('react-aria-components', () => ({ setInteractionModality: (m: string) => modality.calls.push(m) }));

import { PRESS_SUPPRESS_MS, isDragPress, noteInput, resetDragGuard, useReorderGuard } from './drag-guard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let guard: ReturnType<typeof useReorderGuard<HTMLDivElement>> | null = null;
function List() {
  guard = useReorderGuard<HTMLDivElement>();
  return (
    <div ref={guard.ref} role="grid">
      <div role="row" tabIndex={-1} id="row">
        <button id="main">行</button>
      </div>
    </div>
  );
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  resetDragGuard();
  modality.calls.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<List />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const el = (id: string) => document.getElementById(id) as HTMLElement;

describe('拖动排序后不留高亮', () => {
  it('鼠标拖完：焦点离开列表，交互方式改回 pointer', () => {
    noteInput('pointer');
    act(() => guard!.handlers.onDragStart());
    // React Aria 放下后把焦点挪到被拖的行
    el('row').focus();
    expect(document.activeElement).toBe(el('row'));
    act(() => guard!.handlers.onDragEnd());
    act(() => vi.advanceTimersByTime(200));
    expect(document.activeElement).not.toBe(el('row'));
    expect(el('row').contains(document.activeElement)).toBe(false);
    expect(modality.calls).toContain('pointer');
  });

  it('React Aria 晚到 50ms 才挪焦点，也会清掉', () => {
    noteInput('pointer');
    act(() => guard!.handlers.onDragStart());
    act(() => guard!.handlers.onDragEnd());
    act(() => vi.advanceTimersByTime(50));
    el('main').focus();
    act(() => vi.advanceTimersByTime(150));
    expect(document.activeElement).not.toBe(el('main'));
  });

  it('键盘拖动：焦点留着，不改交互方式', () => {
    noteInput('keyboard');
    act(() => guard!.handlers.onDragStart());
    el('row').focus();
    act(() => guard!.handlers.onDragEnd());
    act(() => vi.advanceTimersByTime(200));
    expect(document.activeElement).toBe(el('row'));
    expect(modality.calls).toEqual([]);
  });

  it('列表外的焦点不动', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    noteInput('pointer');
    act(() => guard!.handlers.onDragStart());
    act(() => guard!.handlers.onDragEnd());
    act(() => vi.advanceTimersByTime(200));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe('拖动不选中被拖的行', () => {
  it('拖动中、刚放下的点按都不算点开；过一会儿恢复', () => {
    expect(isDragPress()).toBe(false);
    act(() => guard!.handlers.onDragStart());
    expect(isDragPress()).toBe(true);
    act(() => guard!.handlers.onDragEnd());
    const t = performance.now();
    expect(isDragPress(t)).toBe(true);
    expect(isDragPress(t + PRESS_SUPPRESS_MS + 10)).toBe(false);
  });
});
