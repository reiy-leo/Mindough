import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NewTaskInput } from '@mindough/core';
import { hashWithTask, taskInHash } from './router';
import { useSettings } from './settings';
import { isMiniWindow } from './windows';

import { tr } from './i18n';
export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: number;
  message: ReactNode;
  tone?: 'info' | 'success' | 'error';
  actions?: ToastAction[];
}

interface UiCtx {
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismiss: (id: number) => void;
  /**
   * 选中的任务（三列布局右列 / 手机推入的详情页 / 小窗里的弹窗）。主窗口里它就是 hash 上的 ?task=<id>：
   * 刷新还在，换页面就取消。
   */
  editingId: string | null;
  /** 选中一件任务（null = 取消选中）。手机上从没选中到选中会进一条浏览记录，系统返回键就回到列表。 */
  openEditor: (taskId: string | null) => void;
  /** 手机详情页的「返回」、右滑：选中时进过浏览记录就退回去，否则直接取消选中。 */
  closeDetail: () => void;
  /** 新建任务面板：defaults 是预填值；after 表示“接在某个任务之后”（建好后连上前后关系）；related 预先勾上的相关任务。 */
  quickCreate: ComposerRequest | null;
  openQuickCreate: (defaults?: NewTaskInput, opts?: { after?: string; related?: string[]; myDay?: boolean; people?: string[] }) => void;
  closeQuickCreate: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** 从滴答清单导入的窗口（菜单栏 文件 → 导入 → 滴答清单、设置 → 数据、⌘K）。 */
  didaImportOpen: boolean;
  setDidaImportOpen: (open: boolean) => void;
}

export interface ComposerRequest {
  defaults: NewTaskInput;
  after?: string;
  /** 从「我的一天」新建：建好放进今天（别处新建默认进待安排）。 */
  myDay?: boolean;
  related?: string[];
  /** 预先关联的人物（从人物页「新建相关任务」）。 */
  people?: string[];
}

const Ctx = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mini = useMemo(() => isMiniWindow(), []);
  const [editingId, setEditingId] = useState<string | null>(() => (mini ? null : taskInHash(location.hash)));
  const { layout } = useSettings();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    if (mini) return;
    const on = () => setEditingId(taskInHash(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, [mini]);
  const openEditor = useCallback(
    (id: string | null) => {
      if (mini) return setEditingId(id);
      const cur = taskInHash(location.hash);
      if (cur !== id) {
        const url = `${location.pathname}${location.search}${hashWithTask(location.hash, id)}`;
        // 手机：列表 → 详情是「推进去」，进一条记录；换一件 / 桌面上只替换，不攒记录
        if (id && !cur && layoutRef.current === 'mobile') history.pushState({ mdDetail: true }, '', url);
        else history.replaceState(id ? history.state : null, '', url);
      }
      setEditingId(id);
    },
    [mini],
  );
  const closeDetail = useCallback(() => {
    if (!mini && taskInHash(location.hash) && (history.state as { mdDetail?: boolean } | null)?.mdDetail) history.back();
    else openEditor(null);
  }, [mini, openEditor]);
  const [quickCreate, setQuickCreate] = useState<ComposerRequest | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [didaImportOpen, setDidaImportOpen] = useState(false);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>, ms = 5000) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const value = useMemo<UiCtx>(
    () => ({
      toasts,
      toast,
      dismiss,
      editingId,
      openEditor,
      closeDetail,
      quickCreate,
      openQuickCreate: (d = {}, opts = {}) => setQuickCreate({ defaults: d, ...(opts.after ? { after: opts.after } : {}), ...(opts.related?.length ? { related: opts.related } : {}), ...(opts.myDay ? { myDay: true } : {}), ...(opts.people?.length ? { people: opts.people } : {}) }),
      closeQuickCreate: () => setQuickCreate(null),
      paletteOpen,
      setPaletteOpen,
      didaImportOpen,
      setDidaImportOpen,
    }),
    [toasts, toast, dismiss, editingId, openEditor, closeDetail, quickCreate, paletteOpen, didaImportOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 不在 UiProvider 里时是 null（编辑器单独用的时候不报错）。 */
export function useUiOptional(): UiCtx | null {
  return useContext(Ctx);
}

export function useUi(): UiCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error(tr('UiProvider 缺失'));
  return v;
}
