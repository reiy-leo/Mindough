import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NewTaskInput } from '@mindough/core';

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
  editingId: string | null;
  openEditor: (taskId: string | null) => void;
  /** 新建任务面板：defaults 是预填值；after 表示“接在某个任务之后”（建好后连上前后关系）；related 预先勾上的相关任务。 */
  quickCreate: ComposerRequest | null;
  openQuickCreate: (defaults?: NewTaskInput, opts?: { after?: string; related?: string[]; myDay?: boolean; people?: string[] }) => void;
  closeQuickCreate: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickCreate, setQuickCreate] = useState<ComposerRequest | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
      openEditor: setEditingId,
      quickCreate,
      openQuickCreate: (d = {}, opts = {}) => setQuickCreate({ defaults: d, ...(opts.after ? { after: opts.after } : {}), ...(opts.related?.length ? { related: opts.related } : {}), ...(opts.myDay ? { myDay: true } : {}), ...(opts.people?.length ? { people: opts.people } : {}) }),
      closeQuickCreate: () => setQuickCreate(null),
      paletteOpen,
      setPaletteOpen,
    }),
    [toasts, toast, dismiss, editingId, quickCreate, paletteOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error(tr('UiProvider 缺失'));
  return v;
}
