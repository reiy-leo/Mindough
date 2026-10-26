import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { MousePointerClick } from 'lucide-react';
import { useUi } from '../../lib/ui';
import { clampDetailWidth, DETAIL_W_DEFAULT, DETAIL_W_KEY, loadDetailWidth, nextTaskId } from '../../lib/detail-pane';
import { TaskDetail, useSelectedTask } from './TaskDetail';
import { tr } from '../../lib/i18n';
import { scrollIntoContainer } from '../../lib/root-scroll';

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** 焦点在弹窗、菜单、浮层里：方向键和 Esc 归它们。 */
function inOverlay(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .popover, .modal');
}

/** 列表里能选的任务（当前页面里按显示顺序，同一件只算一次）。 */
function visibleTaskIds(): string[] {
  const ids: string[] = [];
  document.querySelectorAll<HTMLElement>('.main [data-task-id]').forEach((el) => {
    const id = el.dataset.taskId;
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

/** 右列宽度：可拖，记在本机（localStorage，不同步）。 */
function useDetailWidth() {
  const [w, setW] = useState(() => loadDetailWidth(localStorage.getItem(DETAIL_W_KEY), window.innerWidth));
  // 窗口变窄时收一收，别把列表挤没
  useEffect(() => {
    const on = () => setW((cur) => clampDetailWidth(cur, window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const save = (v: number) => {
    const next = clampDetailWidth(v, window.innerWidth);
    setW(next);
    localStorage.setItem(DETAIL_W_KEY, String(next));
  };
  return [w, setW, save] as const;
}

/**
 * 三列布局的右列（Rei 2026-10-23）：侧边栏 | 列表 | 任务详情。
 * 点列表里一件任务就在这里显示，没选时是安静的空状态；左边的分隔条拖动调宽（双击恢复默认），
 * Esc 或右上角关闭取消选中，↑ ↓ 在列表里换一件（不在输入框里时）。中等宽度没选中时整列收起，见 styles/app.css。
 */
export function DetailPane() {
  const ui = useUi();
  const task = useSelectedTask();
  const [width, setWidth, saveWidth] = useDetailWidth();
  const drag = useRef<{ x: number; w: number } | null>(null);

  // 键盘：Esc 取消选中、↑ ↓ 换一件
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || ui.paletteOpen || ui.quickCreate) return;
      if (isTyping(e.target) || inOverlay(e.target)) return;
      if (document.querySelector('.overlay')) return;
      if (e.key === 'Escape' && ui.editingId) {
        e.preventDefault();
        ui.openEditor(null);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // 焦点在列表以外能用方向键的东西上（滑块、分隔条…）时不抢
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('[role="slider"], [role="separator"], [role="radiogroup"], [role="tablist"], [role="grid"], .react-flow')) return;
        const next = nextTaskId(visibleTaskIds(), ui.editingId, e.key === 'ArrowDown' ? 1 : -1);
        if (!next) return;
        e.preventDefault();
        ui.openEditor(next);
        requestAnimationFrame(() => {
          const row = document.querySelector<HTMLElement>(`.main [data-task-id="${CSS.escape(next)}"]`);
          if (row) scrollIntoContainer(row, { block: 'nearest' });
        });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [ui]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('is-resizing');
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 分隔条在右列左边：往左拖变宽
    setWidth(clampDetailWidth(d.w + (d.x - e.clientX), window.innerWidth));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.documentElement.classList.remove('is-resizing');
    saveWidth(width);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') saveWidth(width + step);
    else if (e.key === 'ArrowRight') saveWidth(width - step);
    else if (e.key === 'Home') saveWidth(DETAIL_W_DEFAULT);
    else return;
    e.preventDefault();
  };

  return (
    <aside className={`detail-pane${task ? ' has-task' : ''}`} style={{ width }} aria-label={tr('任务详情')}>
      <div
        className="pane-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={tr('调整详情宽度')}
        aria-valuenow={width}
        aria-valuemin={clampDetailWidth(0, window.innerWidth)}
        aria-valuemax={clampDetailWidth(9999, window.innerWidth)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => saveWidth(DETAIL_W_DEFAULT)}
        onKeyDown={onKeyDown}
      />
      <div className="detail-pane-box">
        {task ? (
          <TaskDetail mode="pane" />
        ) : (
          <div className="pane-empty">
            <MousePointerClick size={32} strokeWidth={1.5} aria-hidden />
            <p>{tr('选一件任务查看详情')}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
