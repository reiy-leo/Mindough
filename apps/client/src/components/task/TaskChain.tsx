/**
 * 任务链（Rei 2026-10-23：「可以一键展示整个FS的一条线上的所有任务。当前一个任务只能展示它的前后任务，但前任务的前任务是没展示出来的」；
 * 同日：「整条线不要弹窗。每个步骤显示相对时间，而不是第几步。改名成‘任务链’」）。
 *
 * 详情「关系」标题旁的「任务链」是个开关：打开后在关系区原地用任务链（core taskChain，从最上游到最下游）替换
 * 「先做完这些 / 做完后解锁」两段，关掉恢复；「相关任务」照常在下面。开关记在本机设置（settings.taskChain，不同步），换一件任务也沿用。
 * 每一步左边竖线 + 箭头，上面写这一步的相对时间（core chainStepWhen / chainWhenLabel：完成的写「3 天前完成」，没完成的写「明天」「已过 2 天」，没日期「未定时间」）。
 * 同一步有几件（分叉 / 汇合）时纵向叠着、左边缩进一道线：详情栏窄，桌面也不并排。点一行打开那件任务的详情。
 */
import { useMemo } from 'react';
import { Button as RacButton, ToggleButton } from 'react-aria-components';
import { ArrowDown, Check, Lock, Play, Route as RouteIcon, X } from 'lucide-react';
import { chainStepWhen, chainWhenLabel, taskChain, todayKey, type DateKey, type Store, type Task } from '@mindough/core';
import { useUi } from '../../lib/ui';
import { titleOf } from '../../lib/view';

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

/** 「任务链」开关：有前置或后续时才显示。打开后关系区显示任务链。 */
export function ChainToggle({ isOn, onChange }: { isOn: boolean; onChange: (on: boolean) => void }) {
  return (
    <ToggleButton className="link-btn chain-btn" isSelected={isOn} onChange={onChange} aria-label={tr('任务链：把前面的前面、后面的后面都列出来')}>
      <RouteIcon size={14} aria-hidden /> {tr('任务链')}
    </ToggleButton>
  );
}

/** 任务链（内联在详情「关系」里）。 */
export function TaskChainInline({ store, task }: { store: Store; task: Task }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chain = useMemo(() => taskChain(task.id, store.edges(), store.list('task')), [task.id, store, store.version]);
  return <ChainSteps store={store} layers={chain.layers} edges={chain.edges} currentId={task.id} currentLayer={chain.currentLayer} />;
}

/** 我的一天：任务 id → 进过哪些天（没有日期的任务拿它当计划日期）。 */
export function useMyDayDates(store: Store): Map<string, DateKey[]> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const m = new Map<string, DateKey[]>();
    for (const e of store.list('my_day')) (m.get(e.task_id) ?? m.set(e.task_id, []).get(e.task_id)!).push(e.date);
    return m;
  }, [store, store.version]);
}

/**
 * 一条任务链的竖排步骤：详情「任务链」和项目页「任务链」视图（Rei 2026-10-26）共用。
 * currentId：详情里正在看的那件（标「这件」、不可点）；项目页不传。
 * groupId：项目页传本项目 id，链上别的项目的任务标出所属项目。
 */
export function ChainSteps({
  store,
  layers,
  edges,
  currentId,
  currentLayer,
  groupId,
  label,
}: {
  store: Store;
  layers: string[][];
  edges: readonly { pred_id: string; succ_id: string }[];
  currentId?: string;
  currentLayer?: number;
  groupId?: string;
  label?: string;
}) {
  const ui = useUi();
  const myDay = useMyDayDates(store);
  const today = todayKey(store.now());
  const tasks = layers.flat().map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const done = tasks.filter((t) => t.status === '完成').length;
  const predsIn = (id: string) => edges.filter((e) => e.succ_id === id).map((e) => e.pred_id);
  return (
    <div className="chain" aria-label={label ?? tr('任务链')} role="group">
      <div className="chain-summary">
        <span className="chain-progress" role="status">
          {tr('已完成 {done} / 共 {total}', { done, total: tasks.length })}
        </span>
        <span className="chain-bar" aria-hidden>
          <span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
        </span>
      </div>
      <ol className="chain-layers">
        {layers.map((layer, li) => {
          const prev = new Set(layers[li - 1] ?? []);
          const layerTasks = layer.map((id) => store.get('task', id)).filter((t): t is Task => !!t);
          const when = chainWhenLabel(chainStepWhen(layerTasks, today, { myDay }), today);
          return (
            <li key={li} className={`chain-layer${li === currentLayer ? ' is-current-layer' : ''}`}>
              <div className="chain-rail" aria-hidden>
                <span className="chain-node" />
                {li < layers.length - 1 && (
                  <span className="chain-line">
                    <ArrowDown size={12} strokeWidth={2.5} />
                  </span>
                )}
              </div>
              <div className="chain-layer-body">
                <div className="chain-step-label">
                  <span className={`chain-when is-${when.tone}`}>{when.text}</span>
                  {layer.length > 1 && <span className="chain-step-count">{tr('{n} 件', { n: layer.length })}</span>}
                </div>
                <ul className={`chain-cards${layer.length > 1 ? ' is-multi' : ''}`}>
                  {layerTasks.map((t) => {
                    const id = t.id;
                    const st = stateOf(store, t);
                    const current = id === currentId;
                    const preds = predsIn(id);
                    // 接的不正好是上一层的全部（只接其中几件、或跨层接更早的）时，写清楚接在谁后面；正好是上一层全部时看连线就懂，不写
                    const showAfter = li > 0 && (preds.length !== prev.size || preds.some((p) => !prev.has(p)));
                    const other = groupId !== undefined && t.group_id !== groupId ? store.get('group', t.group_id) : undefined;
                    const otherNone = groupId !== undefined && !t.group_id;
                    return (
                      <li key={id} className={`chain-card is-${st}${current ? ' is-current' : ''}`} data-task-id={id}>
                        <RacButton className="chain-card-btn" onPress={() => !current && ui.openEditor(id)} aria-current={current ? 'true' : undefined}>
                          <StateDot state={st} />
                          <span className="chain-card-text">
                            <span className="chain-card-title">{titleOf(store, t)}</span>
                            <span className="chain-card-meta">
                              <span className="chain-state">{STATE_TEXT[st]()}</span>
                              {other && <span className="chain-group">{tr('在「{name}」里', { name: other.name })}</span>}
                              {otherNone && <span className="chain-group">{tr('不在项目里')}</span>}
                              {showAfter && preds.length > 0 && (
                                <span className="chain-after">
                                  {tr('接在 {list} 后面', {
                                    list: preds
                                      .map((p) => {
                                        const pt = store.get('task', p);
                                        return pt ? tr('「{title}」', { title: titleOf(store, pt) }) : '';
                                      })
                                      .join(tr('、')),
                                  })}
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
    </div>
  );
}
