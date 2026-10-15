import type { CheckInCategory, Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { ChipPicker, Select } from '../ui/primitives';

export const NO_CATEGORY = '__none';

/** 分类小标签：图标 + 名称，颜色跟随分类。 */
export function CategoryLabel({ c, size = 13 }: { c: CheckInCategory; size?: number }) {
  const Icon = typeIcon(c.icon);
  return (
    <span className="cat-label" style={{ color: c.color }}>
      <Icon size={size} aria-hidden />
      <span>{c.name}</span>
    </span>
  );
}

/** 打卡分类单选（新建 / 编辑重复任务用）。 */
export function CategoryPicker({ store, value, onChange, compact }: { store: Store; value: string | null; onChange: (id: string | null) => void; compact?: boolean }) {
  const cats = store.checkInCategories();
  const cur = value && store.get('checkin_category', value);
  // 已选但被隐藏的分类仍显示在列表里，免得“看不见当前值”
  const list = cur && cur.hidden ? [...cats, cur] : cats;
  if (compact)
    return (
      <Select
        label="打卡分类"
        value={value ?? NO_CATEGORY}
        options={[{ id: NO_CATEGORY, label: '未分类' }, ...list.map((c) => ({ id: c.id, label: c.name }))]}
        onChange={(id) => onChange(id === NO_CATEGORY ? null : id)}
      />
    );
  return (
    <div className="field">
      <span className="field-label">打卡分类</span>
      <ChipPicker
        label="打卡分类"
        value={value ?? NO_CATEGORY}
        onChange={(id) => onChange(id === NO_CATEGORY ? null : id)}
        options={[{ id: NO_CATEGORY, label: '未分类' }, ...list.map((c) => ({ id: c.id, label: <CategoryLabel c={c} />, color: c.color }))]}
      />
    </div>
  );
}
