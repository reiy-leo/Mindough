/**
 * 整条线（Rei 2026-10-23：「可以一键展示整个FS的一条线上的所有任务。当前一个任务只能展示它的前后任务，但前任务的前任务是没展示出来的」）。
 * 详情「关系」标题旁的「整条线」按钮打开：从最上游到最下游按层列出（core taskChain），当前任务高亮；
 * 一层有几件（分叉 / 汇合）时并排（手机上叠着），层与层之间竖线 + 箭头。点一行打开那件任务的详情。
 * 用纵向列表而不是关系图：手机窄屏上也能读全标题，状态一眼看得到。手机上 Sheet 自动是底部面板。
 */
import { useMemo } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { ArrowDown, Check, Lock, Play, Route as RouteIcon, X } from 'lucide-react';
import { taskChain, type Store, type Task } from '@mindough/core';
import { useUi } from '../../lib/ui';
import { titleOf } from '../../lib/view';
import { Sheet } from '../../ui/primitives';

import { tr } from '../../lib/i18n';

type ChainState = 'done' | 'closed' | 'doing' | 'blocked' | 'ready';

function stateOf(store: Store, t: Task): ChainState {
  if (t.status === '完成') return 'done';
  if (t.status === '关闭') return 'closed';
  if (store.derived().get(t.id)?.state === '被阻塞') return 'blocked';
  if (t.status === '进行中') return 'doing';
  return 'ready';
}

const STATE_TEXT: Record<ChainState, () => string> = {
  done: () => tr('已完成'),
  closed: () => tr('已关闭'),
  doing: () => tr('进行中'),
  blocked: () => tr('还不能开始'),
  ready: () => tr('可开始'),
};

function StateDot({ state }: { state: ChainState }) {
  const icon =
    state === 'done' ? <Check size={11} strokeWidth={3} /> : state === 'closed' ? <X size={11} strokeWidth={3} /> : state === 'blocked' ? <Lock size={9} strokeWidth={2.75} /> : state === 'doing' ? <Play size={9} strokeWidth={2.75} /> : null;
  return (
    <span className="chain-dot" aria-hidden>
      {icon}
    </span>
  );
}

/** 「整条线」按钮：有前置或后续时才显示。 */
export function ChainButton({ onPress }: { onPress: () => void }) {
  return (
    <RacButton className="link-btn chain-btn" onPress={onPress} aria-label={tr('看整条线：前面的前面、后面的后面都列出来')}>
      <RouteIcon size={14} aria-hidden /> {tr('整条线')}
    </RacButton>
  );
}

export function TaskChainSheet({ store, task, isOpen, onClose }: { store: Store; task: Task; isOpen: boolean; onClose: () => void }) {
  const ui = useUi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chain = useMemo(() => (isOpen ? taskChain(task.id, store.edges(), store.list('task')) : null), [isOpen, task.id, store, store.version]);
  if (!isOpen || !chain) return null;
  const tasks = chain.ids.map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const done = tasks.filter((t) => t.status === '完成').length;
  const predsIn = (id: string) => chain.edges.filter((e) => e.succ_id === id).map((e) => e.pred_id);
  const open = (id: string) => {
    onClose();
    if (id !== task.id) ui.openEditor(id);
  };
  return (
    <Sheet isOpen onOpenChange={(o) => !o && onClose()} title={tr('整条线')} className="modal-chain">
      <div className="chain-summary">
        <span className="chain-progress" role="status">
          {tr('已完成 {done} / 共 {total}', { done, total: tasks.length })}
        </span>
        <span className="chain-bar" aria-hidden>
          <span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
        </span>
      </div>
      <p className="chain-hint">{tr('从上往下做：上面的做完，下面的才能开始。')}</p>
      <ol className="chain-layers">
        {chain.layers.map((layer, li) => {
          const prev = new Set(chain.layers[li - 1] ?? []);
          return (
            <li key={li} className={`chain-layer${li === chain.currentLayer ? ' is-current-layer' : ''}`}>
              <div className="chain-rail" aria-hidden>
                <span className="chain-step">{li + 1}</span>
                {li < chain.layers.length - 1 && (
                  <span className="chain-line">
                    <ArrowDown size={12} strokeWidth={2.5} />
                  </span>
                )}
              </div>
              <div className="chain-layer-body">
                <div className="chain-step-label">
                  {tr('第 {n} 步', { n: li + 1 })}
                  {layer.length > 1 && <span className="chain-step-count">{tr('{n} 件', { n: layer.length })}</span>}
                </div>
                <ul className={`chain-cards${layer.length > 1 ? ' is-multi' : ''}`}>
                  {layer.map((id) => {
                    const t = store.get('task', id);
                    if (!t) return null;
                    const st = stateOf(store, t);
                    const current = id === task.id;
                    const preds = predsIn(id);
                    // 接的不正好是上一层的全部（只接其中几件、或跨层接更早的）时，写清楚接在谁后面；正好是上一层全部时看连线就懂，不写
                    const showAfter = li > 0 && (preds.length !== prev.size || preds.some((p) => !prev.has(p)));
                    return (
                      <li key={id} className={`chain-card is-${st}${current ? ' is-current' : ''}`}>
                        <RacButton className="chain-card-btn" onPress={() => open(id)} aria-current={current ? 'true' : undefined}>
                          <StateDot state={st} />
                          <span className="chain-card-text">
                            <span className="chain-card-title">{titleOf(store, t)}</span>
                            <span className="chain-card-meta">
                              <span className="chain-state">{STATE_TEXT[st]()}</span>
                              {showAfter && preds.length > 0 && (
                                <span className="chain-after">
                                  {tr('接在 {list} 后面', { list: preds.map((p) => { const pt = store.get('task', p); return pt ? tr('「{title}」', { title: titleOf(store, pt) }) : ''; }).join(tr('、')) })}
                                </span>
                              )}
                            </span>
                          </span>
                          {current && <span className="chain-here">{tr('这件')}</span>}
                        </RacButton>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
