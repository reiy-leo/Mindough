import { useEffect, useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CategoryPicker } from './CheckInCategory';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Sheet } from '../ui/primitives';
import { typeIcon } from '../lib/icons';
import { PLAIN_TYPE_ID } from '@mindough/core';

/** 快速新建：先选类型，类型预填字段与正文模板；组的默认类型排在最前。 */
export function QuickCreate() {
  const ui = useUi();
  const store = useStore();
  const defaults = ui.quickCreate;
  const [catId, setCatId] = useState<string | null>(null);
  useEffect(() => setCatId(defaults?.checkin_category_id ?? null), [defaults]);
  if (!defaults) return null;
  const recurring = !!defaults.recurrence;
  const group = store.get('group', defaults.group_id ?? null);
  const types = store
    .list('task_type')
    .filter((t) => !t.hidden)
    .sort((a, b) => (a.id === group?.default_type_id ? -1 : b.id === group?.default_type_id ? 1 : a.sort - b.sort));

  const create = (typeId: string) => {
    const t = store.createTask({ ...defaults, type_id: typeId === PLAIN_TYPE_ID ? null : typeId, ...(recurring ? { checkin_category_id: catId } : {}) });
    // 重复任务在打卡页，不自动进我的一天（今天要打卡时会出现在建议区）
    if (defaults.scheduled_date === undefined && !defaults.group_id && !recurring) store.addToMyDay(t.id);
    ui.closeQuickCreate();
    ui.openEditor(t.id);
  };

  return (
    <Sheet isOpen onOpenChange={(o) => !o && ui.closeQuickCreate()} title={group ? `在「${group.name}」里新建` : recurring ? '新建打卡' : '新建任务'}>
      {recurring && <CategoryPicker store={store} value={catId} onChange={setCatId} />}
      <p className="muted">选一个类型。类型决定卡片怎么显示，以及新建时预填的字段和正文模板。{recurring && '默认每天重复，建好后可在详情里改。'}</p>
      <div className="type-grid">
        {types.map((t, i) => {
          const Icon = typeIcon(t.icon);
          return (
            <RacButton key={t.id} className="type-tile" onPress={() => create(t.id)} autoFocus={i === 0}>
              <span className="type-tile-icon" style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 14%, transparent)` }}>
                <Icon size={20} />
              </span>
              <span className="type-tile-name">{t.name}</span>
              <span className="type-tile-hint">{t.id === PLAIN_TYPE_ID ? '无标题的 markdown' : t.fields.find((f) => f.primary)?.label}</span>
            </RacButton>
          );
        })}
      </div>
    </Sheet>
  );
}
