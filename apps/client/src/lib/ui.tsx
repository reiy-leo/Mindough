import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NewTaskInput } from '@mindough/core';

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
  quickCreate: NewTaskInput | null;
  openQuickCreate: (defaults?: NewTaskInput) => void;
  closeQuickCreate: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const Ctx = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickCreate, setQuickCreate] = useState<NewTaskInput | null>(null);
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
      openQuickCreate: (d = {}) => setQuickCreate(d),
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
  if (!v) throw new Error('UiProvider 缺失');
  return v;
}
