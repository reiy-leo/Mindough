// @vitest-environment happy-dom
/**
 * 我的一天快速添加后立即打开（Rei 2026-10-26「从这里添加任务后立即打开任务」）：
 * 建好、进今天、选中；空白不建；连着加以最后一件为准；手机收起键盘，宽屏光标留在添加框；新行滚进视野。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterQuickAdd, quickAddToday, type QuickAddDeps } from './quick-add';

function deps() {
  let n = 0;
  const log: string[] = [];
  const d: QuickAddDeps & { log: string[]; opened: (string | null)[] } = {
    log,
    opened: [],
    createTask: (i) => {
      const id = `t${++n}`;
      log.push(`create ${id} ${i.body_md}`);
      return { id };
    },
    addToMyDay: (id, date) => log.push(`myday ${id} ${date}`),
    openEditor: (id) => {
      log.push(`open ${id}`);
      d.opened.push(id);
    },
  };
  return d;
}

describe('quickAddToday', () => {
  it('建任务、放进今天，再打开它', () => {
    const d = deps();
    expect(quickAddToday(d, '  买牛奶  ', '2026-10-26')).toBe('t1');
    expect(d.log).toEqual(['create t1 买牛奶', 'myday t1 2026-10-26', 'open t1']);
  });

  it('空白不建也不打开', () => {
    const d = deps();
    expect(quickAddToday(d, '   ', '2026-10-26')).toBeNull();
    expect(d.log).toEqual([]);
  });

  it('连着加几件：详情停在最后一件', () => {
    const d = deps();
    quickAddToday(d, '一', '2026-10-26');
    quickAddToday(d, '二', '2026-10-26');
    quickAddToday(d, '三', '2026-10-26');
    expect(d.opened.at(-1)).toBe('t3');
  });
});

describe('afterQuickAdd', () => {
  let frames: FrameRequestCallback[] = [];
  const flush = () => {
    while (frames.length) frames.shift()!(0);
  };
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    document.body.innerHTML = '<main class="main"><input id="add" /><div class="list"></div></main>';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });
  const input = () => document.getElementById('add') as HTMLInputElement;
  const addRow = (id: string) => {
    const row = document.createElement('div');
    row.dataset.taskId = id;
    const spy = vi.fn();
    row.scrollIntoView = spy;
    document.querySelector('.list')!.append(row);
    return spy;
  };

  it('手机：添加框交出焦点（收起软键盘）', () => {
    input().focus();
    expect(document.activeElement).toBe(input());
    afterQuickAdd('t1', input(), 'mobile');
    expect(document.activeElement).not.toBe(input());
  });

  it('宽屏：光标留在添加框，可以接着写', () => {
    input().focus();
    afterQuickAdd('t1', input(), 'desktop');
    expect(document.activeElement).toBe(input());
  });

  it('新行下一帧才出现也能滚到', () => {
    afterQuickAdd('t1', input(), 'desktop');
    frames.shift()!(0); // 第一帧：行还没渲染
    const spy = addRow('t1');
    flush();
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('连着加：只滚最后一件', () => {
    const a = addRow('t1');
    const b = addRow('t2');
    afterQuickAdd('t1', input(), 'desktop');
    afterQuickAdd('t2', input(), 'desktop');
    flush();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
