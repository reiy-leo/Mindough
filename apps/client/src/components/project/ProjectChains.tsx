/**
 * 项目页「任务链」视图（Rei 2026-10-26「添加另外一个视图：任务链」「把项目中的任务关系按照任务链排列」）：
 * 本项目里由前后关系（先做完这些 / 做完后做）连起来的任务排成一条条任务链，排法和详情里的「任务链」一样（core projectChains → 同一套分层），
 * 每条链竖着一步一步往下，步骤上写相对时间；链上别的项目的前置 / 后续也列出来、标出所属项目，链不断开。
 * 排序菜单只决定链的先后（看链首那件本项目任务），链内顺序只看依赖。没有前后关系的任务放最后「单独的任务」，可以收起。
 */
import { useMemo } from 'react';
import { projectChains, type Store, type Task } from '@mindough/core';
import { Disclosure, DisclosurePanel, Heading, Button as RacButton } from 'react-aria-components';
import { ChevronRight } from 'lucide-react';
import { ChainSteps } from '../task/TaskChain';
import { TaskRow } from '../TaskRow';
import { Empty } from '../../ui/primitives';

import { tr } from '../../lib/i18n';

export function ProjectChains({ store, groupId, tasks }: { store: Store; groupId: string; tasks: Task[] }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { chains, single } = useMemo(() => projectChains(tasks.map((t) => t.id), store.edges(), store.list('task')), [tasks, store, store.version]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (
    <div className="project-chains">
      {chains.length === 0 && <Empty title={tr('这个项目里还没有前后关系')} hint={tr('在任务详情的「关系」里加「先做完这些」或「做完后做」，这里就会排成任务链')} />}
      {chains.map((c, i) => (
        <section key={c.ids[0] ?? i} className="project-chain card">
          <ChainSteps store={store} layers={c.layers} edges={c.edges} groupId={groupId} label={tr('任务链 {n}', { n: i + 1 })} />
        </section>
      ))}
      {single.length > 0 && (
        <Disclosure className="chain-singles" defaultExpanded={chains.length === 0}>
          <Heading className="chain-singles-head">
            <RacButton slot="trigger" className="chain-singles-btn">
              <ChevronRight size={14} className="chain-singles-chevron" aria-hidden />
              {tr('单独的任务 {n}', { n: single.length })}
            </RacButton>
          </Heading>
          <DisclosurePanel>
            <div className="task-list plain">
              {single.map((id) => {
                const t = byId.get(id);
                return t ? <TaskRow key={id} store={store} task={t} showGroup={false} showDate /> : null;
              })}
            </div>
          </DisclosurePanel>
        </Disclosure>
      )}
    </div>
  );
}
