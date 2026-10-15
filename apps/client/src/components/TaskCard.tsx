import type { CSSProperties } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Lock } from 'lucide-react';
import { fieldText, type Store, type Task } from '@mindough/core';
import { useUi } from '../lib/ui';
import { STATE_CLASS, viewOf } from '../lib/view';
import { typeIcon } from '../lib/icons';
import { AvatarStack } from './Avatar';

/** 按类型版式显示的卡片：海报 / 图标+名称 / 横幅 / 纯文字。 */
export function TaskCard({ store, task }: { store: Store; task: Task }) {
  const ui = useUi();
  const v = viewOf(store, task);
  const layout = v.type?.layout ?? 'text';
  const Icon = typeIcon(v.type?.icon);
  const facts = (v.type?.fields ?? [])
    .filter((f) => !f.primary && !f.media && f.kind !== 'image' && f.kind !== 'link' && f.kind !== 'person')
    .map((f) => {
      const val = fieldText(task.type_data[f.key]);
      return val ? (f.kind === 'progress' ? `${f.label} ${val}${f.unit ?? ''}` : val) : '';
    })
    .filter(Boolean)
    .slice(0, 3);
  return (
    <RacButton className={`task-card layout-${layout} ${STATE_CLASS[v.derived?.state ?? ''] ?? ''}${task.status === '完成' ? ' is-done' : ''}`} onPress={() => ui.openEditor(task.id)}>
      {layout !== 'text' && (
        <div className="task-card-media" style={{ '--type-color': v.type?.color } as CSSProperties}>
          {v.media ? <img src={v.media} alt="" className={v.mediaIsAvatar ? 'is-avatar' : undefined} /> : <Icon size={layout === 'poster' ? 32 : 22} />}
        </div>
      )}
      <div className="task-card-body">
        <div className="task-card-title">{v.title}</div>
        {facts.length > 0 && <div className="task-card-facts">{facts.join(' · ')}</div>}
        <div className="task-card-foot">
          {v.derived?.state === '被阻塞' ? (
            <span className="meta-state state-blocked">
              <Lock size={11} /> 被阻塞
            </span>
          ) : (
            <span className="meta-state">{task.status}</span>
          )}
          <AvatarStack store={store} people={v.people} size={18} />
        </div>
      </div>
    </RacButton>
  );
}
