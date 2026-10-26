/**
 * 类型页（Rei 2026-10-26 18:02「主窗口侧边栏的“资料”section，更改成“管理”，任务入口删掉，添加一个“类型”入口」）。
 * 侧栏「管理 → 类型」，#/types，深链 view/types。左边是类型列表（和设置 → 任务 → 类型同一个 CategoryEditor：
 * 加、改名 / 颜色 / 图标、不显示，不能删），点一行右边的箭头看挂了它的任务和项目（#/types/<id>）。
 * 宽屏两栏；手机先列表，点进去整页看，顶上「全部类型」返回。
 */
import { Button as RacButton } from 'react-aria-components';
import { ChevronLeft, Tags } from 'lucide-react';
import { isFinished } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { Empty, Section } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { TaskRow } from '../components/TaskRow';
import { CategoryEditor, categoryUsage } from '../components/CategoryEditor';
import { CategoryLabel } from '../components/CategoryPicker';
import { tr, trc } from '../lib/i18n';

export function CategoriesPage({ id }: { id?: string }) {
  const store = useStore();
  const { layout } = useSettings();
  const mobile = layout === 'mobile';
  const all = store.categories(true);
  const hidden = all.filter((c) => c.hidden).length;
  const used = categoryUsage(store).size;
  const selected = store.category(id ?? null);
  const open = (cid: string) => navigate({ page: 'types', id: cid });
  if (mobile && selected)
    return (
      <div className="page types-page">
        <RacButton className="btn btn-quiet types-back" onPress={() => navigate({ page: 'types' })}>
          <ChevronLeft size={16} aria-hidden />
          {tr('全部类型')}
        </RacButton>
        <CategoryUses id={selected.id} />
      </div>
    );
  return (
    <div className={`page types-page${selected ? ' has-selection' : ''}`}>
      <PageHeader
        title={trc('分类', '类型')}
        icon={<Tags size={22} />}
        subtitle={
          hidden
            ? tr('{n} 个，用到 {u} 个，{h} 个不显示。打卡、倒数日、项目和所有任务共用。', { n: all.length, u: used, h: hidden })
            : tr('{n} 个，用到 {u} 个。打卡、倒数日、项目和所有任务共用。', { n: all.length, u: used })
        }
      />
      <div className="types-layout">
        <div className="types-list">
          <CategoryEditor onOpen={open} selectedId={selected?.id ?? null} />
        </div>
        {!mobile && (
          <div className="types-uses">
            {selected ? <CategoryUses id={selected.id} /> : <Empty icon={<Tags size={28} />} title={tr('点一个类型，看挂了它的任务和项目')} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** 挂了这个类型的项目和任务（没做完的在前，做完 / 关闭的收在后面）。 */
function CategoryUses({ id }: { id: string }) {
  const store = useStore();
  const c = store.category(id);
  if (!c) return <Empty title={tr('找不到这个类型')} />;
  const groups = store.list('group').filter((g) => store.category(g.category_id)?.id === c.id);
  const tasks = store.tasks().filter((t) => store.categoryOf(t)?.id === c.id);
  const open = tasks.filter((t) => !isFinished(t.status));
  const ended = tasks.filter((t) => isFinished(t.status));
  return (
    <div className="types-uses-body">
      <h2 className="types-uses-title">
        <CategoryLabel c={c} size={18} />
        {c.hidden && <span className="muted small">{tr('不显示')}</span>}
      </h2>
      {!groups.length && !tasks.length && <Empty title={tr('还没有任务或项目挂这个类型')} hint={tr('任务在详情里点「类型」挂，项目在项目页名字下面挂。')} />}
      {groups.length > 0 && (
        <Section title={tr('项目 {length}', { length: groups.length })}>
          <div className="card types-groups">
            {groups.map((g) => (
              <RacButton key={g.id} className="more-item" onPress={() => navigate({ page: 'group', id: g.id })}>
                <span className="more-icon">{g.icon || '📁'}</span>
                <span className="grow">{g.name}</span>
              </RacButton>
            ))}
          </div>
        </Section>
      )}
      {open.length > 0 && (
        <Section title={tr('任务 {length}', { length: open.length })}>
          <div className="task-list plain">
            {open.map((t) => (
              <TaskRow key={t.id} store={store} task={t} showDate />
            ))}
          </div>
        </Section>
      )}
      {ended.length > 0 && (
        <Section title={tr('已结束 {length}', { length: ended.length })}>
          <div className="task-list plain">
            {ended.map((t) => (
              <TaskRow key={t.id} store={store} task={t} showDate />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
