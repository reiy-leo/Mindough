import { Check, Pause, Play, Plus, Square } from 'lucide-react';
import { formatDuration, toDateKey, type Store, type Task } from '@mindough/core';
import { Button, ProgressRing } from '../ui/primitives';
import { useUi } from '../lib/ui';
import { announceComplete } from '../lib/actions';
import { useNow } from '../store/StoreProvider';

import { tr } from '../lib/i18n';
import { trx } from '../lib/trx';
/** 打卡操作：点一下 / 开始·暂停·结束 / +1 / 倒数日，进度由事件折叠得出。 */
export function CheckInControl({ store, task, compact }: { store: Store; task: Task; compact?: boolean }) {
  const ui = useUi();
  const running = store.progress(task.id)?.running ?? false;
  const now = useNow(running ? 1000 : 30_000);
  const today = toDateKey(now);
  const p = store.progress(task.id, today);
  if (!p) return null;

  const record = (kind: Parameters<Store['checkIn']>[1], amount = 0) => {
    const prev = task.status;
    const r = store.checkIn(task.id, kind, amount, today);
    if (r.completed) announceComplete(store, ui, r.completed, prev);
    else if (r.progress.met && task.recurrence && (kind === 'add' || kind === 'stop')) ui.toast({ tone: 'success', message: tr('今天的打卡完成了 🎉') }, 2500);
  };

  switch (task.completion_mode) {
    case 'once':
      return (
        <Button variant={p.met ? 'tonal' : 'secondary'} className="ci-btn" onPress={() => !p.met && record('add', 1)} isDisabled={p.met} aria-label={p.met ? tr('今天已打卡') : tr('打卡')}>
          <Check size={16} />
          {!compact && (p.met ? tr('已打卡') : tr('打卡'))}
        </Button>
      );
    case 'count': {
      const unit = task.unit ?? '';
      return (
        <div className="ci-group">
          <ProgressRing value={p.ratio} size={compact ? 26 : 30} />
          <span className="ci-value">
            {p.value}
            <span className="ci-target">
              /{p.target}
              <span className="ci-unit">{unit}</span>
            </span>
          </span>
          <Button variant="tonal" className="ci-btn" onPress={() => record('add', 1)} aria-label={tr('加 1{unit}', { unit })}>
            <Plus size={16} />
            {!compact && '1'}
          </Button>
        </div>
      );
    }
    case 'timer': {
      const target = p.target ? ` / ${formatDuration(p.target).replace(/ 00 分$/, '')}` : '';
      return (
        <div className="ci-group">
          <ProgressRing value={p.ratio} size={compact ? 26 : 30} />
          <span className={`ci-value${p.running ? ' is-running' : ''}`}>
            {p.value > 0 || p.running ? formatDuration(p.value) : tr('未开始')}
            {!compact && <span className="ci-target">{target}</span>}
          </span>
          {p.running ? (
            <>
              <Button variant="secondary" className="ci-btn" onPress={() => record('pause')} aria-label={tr('暂停')}>
                <Pause size={16} />
              </Button>
              <Button variant="primary" className="ci-btn" onPress={() => record('stop')} aria-label={tr('结束')}>
                <Square size={14} />
                {!compact && tr('结束')}
              </Button>
            </>
          ) : p.paused ? (
            <Button variant="primary" className="ci-btn" onPress={() => record('resume')} aria-label={tr('继续')}>
              <Play size={16} />
              {!compact && tr('继续')}
            </Button>
          ) : (
            <Button variant={p.met ? 'tonal' : 'primary'} className="ci-btn" onPress={() => record('start')} aria-label={tr('开始')} isDisabled={p.met}>
              {p.met ? <Check size={16} /> : <Play size={16} />}
              {!compact && (p.met ? tr('已达标') : tr('开始'))}
            </Button>
          )}
        </div>
      );
    }
    case 'countdown': {
      const n = p.value;
      return (
        <div className="ci-group">
          <span className="ci-countdown">
            {n > 0 ? (
              <>
                {trx('还有 {n} 天', { n: <b>{n}</b> }, { count: n })}
              </>
            ) : n === 0 ? (
              <b>{tr('就是今天')}</b>
            ) : (
              <>
                {trx('已过 {n} 天', { n: <b>{-n}</b> }, { count: -n })}
              </>
            )}
          </span>
          {task.status !== '完成' && !compact && (
            <Button variant="secondary" className="ci-btn" onPress={() => record('stop')}>
              <Check size={16} />
              {tr('完成')}</Button>
          )}
        </div>
      );
    }
  }
}
