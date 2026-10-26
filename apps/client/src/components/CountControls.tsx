/**
 * 计数的操作件（Rei 2026-10-26「喝2000mL水的话，每次只能加1，太不合理了」）：
 * 快捷加量按钮、点数字手输、撤销上一次。列表行（CheckInControl）和任务详情共用。
 *
 * 进度照旧只由 check_in 的 add 事件累加：快捷按钮加一条；手输「1200」记成和现在的差值（可以是负数），
 * 「+330」直接加；撤销就是给那条事件打墓碑（store.undoCheckIn）。
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Input, TextField } from 'react-aria-components';
import { Plus, Undo2 } from 'lucide-react';
import { formatAmount, formatDelta, parseCountInput, quickAmounts, type Store, type Task } from '@mindough/core';
import { Button } from '../ui/primitives';
import { useUi } from '../lib/ui';
import { announceComplete } from '../lib/actions';

import { tr } from '../lib/i18n';

/** 「250 mL」「3 次」（toast 里用）。 */
function amountText(n: number, unit: string | null): string {
  return unit ? tr('{amount} {unit}', { amount: formatAmount(n), unit }) : tr('{amount} 次', { amount: formatAmount(n) });
}

/**
 * 加一个量（可以是负数）：记事件、完成就走完成提示，否则弹「已加 250 mL」带撤销。
 * onDone：只做一次的任务因此完成时调（详情弹窗 / 手机整页用来收起）。
 */
export function useCountAdd(store: Store, task: Task, today: string, onDone?: () => void) {
  const ui = useUi();
  return (amount: number, how: 'add' | 'set' = 'add') => {
    if (!amount) return;
    const prev = task.status;
    const r = store.checkIn(task.id, 'add', amount, today);
    const undo = () => store.undoCheckIn(r.event.id);
    if (r.completed) {
      announceComplete(store, ui, r.completed, prev, undo);
      onDone?.();
      return;
    }
    const message =
      r.progress.met && task.recurrence
        ? tr('今天的打卡完成了 🎉')
        : how === 'set'
          ? tr('改成了 {amount}', { amount: amountText(r.progress.value, task.unit) })
          : amount < 0
            ? tr('减了 {amount}', { amount: amountText(-amount, task.unit) })
            : tr('加了 {amount}', { amount: amountText(amount, task.unit) });
    ui.toast({ tone: r.progress.met ? 'success' : 'info', message, actions: [{ label: tr('撤销'), onPress: undo }] }, 4000);
  };
}

/** 快捷加量按钮（最多三个）。compact：列表行里只放第一个。 */
export function CountQuickButtons({ task, add, compact, variant = 'tonal', className = 'ci-btn' }: { task: Task; add: (n: number) => void; compact?: boolean; variant?: 'tonal' | 'primary' | 'secondary'; className?: string }) {
  const quick = quickAmounts(task);
  const shown = compact ? quick.slice(0, 1) : quick;
  const unit = task.unit ?? '';
  return (
    <>
      {shown.map((q, i) => (
        <Button
          key={q}
          variant={i === 0 ? variant : 'secondary'}
          className={`${className} count-quick`}
          onPress={() => add(q)}
          aria-label={unit ? tr('加 {amount} {unit}', { amount: formatAmount(q), unit }) : tr('加 {amount} 次', { amount: formatAmount(q) })}
        >
          {q === 1 && compact ? <Plus size={16} /> : <span className="count-quick-text">{formatDelta(q)}</span>}
        </Button>
      ))}
    </>
  );
}

/**
 * 当前数字：点一下变成输入框，可以直接改成总数（「1200」），也可以加减（「+330」「-100」）。
 * 回车 / 失焦提交，Esc 取消。
 */
export function CountNumber({ value, onSubmit, className, children }: { value: number; onSubmit: (delta: number, how: 'add' | 'set') => void; className?: string; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (!editing)
    return (
      <button
        type="button"
        className={`count-number${className ? ` ${className}` : ''}`}
        aria-label={tr('现在是 {value}，点一下手动输入', { value: formatAmount(value) })}
        title={tr('点一下手动输入')}
        onClick={(e) => {
          e.stopPropagation();
          setText(formatAmount(value));
          setEditing(true);
        }}
      >
        {children}
      </button>
    );
  const commit = () => {
    const d = parseCountInput(text, value);
    setEditing(false);
    if (d !== null) onSubmit(d, /^\s*[+\-＋－−]/.test(text) ? 'add' : 'set');
  };
  return (
    <TextField aria-label={tr('输入总数，或 +330 这样加上')} className="count-input-field" value={text} onChange={setText}>
      <Input
        className="input count-input"
        autoFocus
        inputMode="decimal"
        placeholder={tr('总数或 +量')}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
    </TextField>
  );
}

/** 「撤销上一次」：这个周期最后一次加量；没有就不显示。 */
export function CountUndoButton({ store, task, today, className = 'btn-sm' }: { store: Store; task: Task; today: string; className?: string }) {
  const ui = useUi();
  const last = store.lastCountAdd(task.id, today);
  if (!last) return null;
  return (
    <Button
      variant="ghost"
      className={`${className} count-undo`}
      onPress={() => {
        store.undoCheckIn(last.id);
        ui.toast({ message: tr('撤销了 {amount}', { amount: formatDelta(last.amount) + (task.unit ? ` ${task.unit}` : '') }) }, 2500);
      }}
    >
      <Undo2 size={15} />
      {tr('撤销上一次')}
    </Button>
  );
}
