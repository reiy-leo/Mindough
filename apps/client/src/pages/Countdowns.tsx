import { Button as RacButton } from 'react-aria-components';
import { Hourglass, Plus } from 'lucide-react';
import { formatDateZh, formatTaskDate, toDateKey, type Task } from '@mindough/core';
import { useDateDisplay } from '../lib/date-display';
import { useNow, useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Button, Empty } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { titleOf } from '../lib/view';
import { typeIcon } from '../lib/icons';
import { tr } from '../lib/i18n';
import { trx } from '../lib/trx';

/** 倒数日页的新建：默认就是倒数日（App 的新建按钮和 N 也用它）。 */
export const COUNTDOWN_DEFAULTS = { completion_mode: 'countdown' as const };

/**
 * 倒数日（Rei 2026-10-26「把倒数日从“打卡”中拆出来单独一个侧边栏入口」）：
 * 以前是打卡页最下面的一节，现在单独一页，在侧边栏「持续」里。卡片和原来一样，点开是任务详情（提醒、农历重复都在详情里）。
 * 排序：今天和还没到的在前，越近越前；已经过了的排后面，刚过的在前。
 */
export function CountdownsPage() {
  const store = useStore();
  const ui = useUi();
  const now = useNow();
  const today = toDateKey(now);
  const dateMode = useDateDisplay();
  const daysOf = (t: Task) => store.progress(t.id, today)?.value ?? 0;
  const countdowns = store
    .tasks()
    .filter((t) => t.completion_mode === 'countdown' && t.target_date && t.status !== '关闭')
    .map((t) => ({ t, n: daysOf(t) }))
    .sort((a, b) => (a.n >= 0) === (b.n >= 0) ? Math.abs(a.n) - Math.abs(b.n) : a.n >= 0 ? -1 : 1);
  const newCountdown = () => ui.openQuickCreate(COUNTDOWN_DEFAULTS);

  return (
    <div className="page">
      <PageHeader
        title={tr('倒数日')}
        icon={<Hourglass size={22} />}
        actions={
          <Button variant="primary" onPress={newCountdown}>
            <Plus size={16} />
            {tr('新建倒数日')}
          </Button>
        }
      />
      {countdowns.length ? (
        <div className="countdown-grid">
          {countdowns.map(({ t, n }) => {
            const type = store.get('task_type', t.type_id);
            const Icon = typeIcon(type?.icon);
            return (
              <RacButton key={t.id} className={`card countdown-card${ui.editingId === t.id ? ' is-selected' : ''}`} data-task-id={t.id} aria-current={ui.editingId === t.id ? 'true' : undefined} onPress={() => ui.openEditor(t.id)}>
                <span className="countdown-title">
                  {type && type.layout !== 'text' && <Icon size={14} style={{ color: type.color }} />}
                  {titleOf(store, t)}
                </span>
                <span className="countdown-num">
                  {n === 0 ? <b>{tr('今天')}</b> : n > 0 ? trx('还有 {n} 天', { n: <b>{n}</b> }, { count: n }, { wrap: 'countdown-affix' }) : trx('已过 {n} 天', { n: <b>{-n}</b> }, { count: -n }, { wrap: 'countdown-affix' })}
                </span>
                <span className="countdown-date">{dateMode === 'auto' ? formatDateZh(t.target_date!) : formatTaskDate(t.target_date!, { mode: dateMode, today })}</span>
              </RacButton>
            );
          })}
        </div>
      ) : (
        <Empty icon={<Hourglass size={28} />} title={tr('还没有倒数日')} hint={tr('考试、纪念日、出发那天，记下来看看还有几天。')} />
      )}
    </div>
  );
}
