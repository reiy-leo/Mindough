/**
 * 可拖动排序的列表（我的一天、待安排、类型、字段）拖完以后不留高亮（Rei 2026-10-25「拖拽调整顺序后不要highlight」）。
 *
 * 原因：React Aria 放下后（useDroppableCollection 的 updateFocusAfterDrop）把焦点挪到被拖的行，
 * 还把交互方式强行设成「键盘」，于是行上出现 data-focus-visible，画出键盘聚焦的那圈强调色；
 * 用鼠标拖行身时，焦点还会留在行里的按钮上。
 *
 * 做法：
 * - 记下这次拖动是鼠标 / 触屏还是键盘发起的（拖之前最后一次输入）。
 * - 鼠标 / 触屏拖完：把交互方式改回 pointer，让焦点离开列表，行上就没有焦点环、没有底色。
 *   键盘拖动不动它，键盘焦点照常留着。
 * - 拖动中和刚放下的一小会儿，行上的点按不算「点开」：不选中、不打开详情、不改 ?task=。
 *   原来选中的行照旧选中（选中只看 ui.editingId，拖动不碰它）。
 */
import { useRef, type RefObject } from 'react';
import { setInteractionModality } from 'react-aria-components';

export type DragInput = 'pointer' | 'keyboard';

/** 放下后多久内的点按都算拖动的尾巴。 */
export const PRESS_SUPPRESS_MS = 350;
/** React Aria 放下后最晚 50ms 才挪焦点；等它挪完再清。 */
const CLEANUP_DELAYS = [0, 80, 160];

let lastInput: DragInput = 'pointer';
let dragging = false;
let dragEndedAt = -Infinity;
let installed = false;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pointerdown', () => (lastInput = 'pointer'), true);
  window.addEventListener('mousedown', () => (lastInput = 'pointer'), true);
  window.addEventListener('touchstart', () => (lastInput = 'pointer'), { capture: true, passive: true });
  // 原生 dragstart 只会由鼠标 / 触屏发起
  window.addEventListener('dragstart', () => (lastInput = 'pointer'), true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') lastInput = 'keyboard';
  }, true);
}
install();

/** 测试用：模拟一次输入。 */
export function noteInput(kind: DragInput) {
  lastInput = kind;
}

/** 正在拖，或刚放下没多久：行上的点按不当成「点开 / 选中」。 */
export function isDragPress(at = now()): boolean {
  return dragging || at - dragEndedAt < PRESS_SUPPRESS_MS;
}

/** 测试用：清空状态。 */
export function resetDragGuard() {
  dragging = false;
  dragEndedAt = -Infinity;
  lastInput = 'pointer';
}

/** 拖完后清掉列表里的焦点和「键盘」交互方式（只在鼠标 / 触屏拖动后调用）。 */
export function clearDropFocus(list: Element | null) {
  setInteractionModality('pointer');
  const active = document.activeElement;
  if (list && active instanceof HTMLElement && list.contains(active)) active.blur();
}

/**
 * 给 useDragAndDrop 用的 onDragStart / onDragEnd，再加一个挂在 GridList 上的 ref。
 * 用法：const guard = useReorderGuard(); useDragAndDrop({ ...guard.handlers, ... }); <GridList ref={guard.ref} ...>
 */
export function useReorderGuard<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const startInput = useRef<DragInput>('pointer');
  const handlers = {
    onDragStart: () => {
      dragging = true;
      startInput.current = lastInput;
    },
    onDragEnd: () => {
      dragging = false;
      dragEndedAt = now();
      if (startInput.current === 'keyboard') return;
      for (const ms of CLEANUP_DELAYS) window.setTimeout(() => clearDropFocus(ref.current), ms);
    },
  };
  return { ref: ref as RefObject<T>, handlers };
}
