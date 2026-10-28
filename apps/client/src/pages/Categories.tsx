/**
 * 类型页（侧栏「管理 → 类型」，#/types，深链 view/types）。方案 C（docs/CATEGORY-EDITOR.md，Rei 2026-10-28「按方案C执行」）：
 * 先找到，再改；顺序不用手排。类型只在这一页管（Rei 2026-10-28「去掉设置中的入口」）。
 *
 * - 宽屏左右两栏：左边是 CategoryList（搜索 + 按大类分组），右边是选中类型的详情（#/types/<id>）。
 * - 窄屏先列表，点一行整页推进详情，顶上「全部类型」返回。
 * - 详情：图标块（点开换颜色和图标）+ 直接改的名字；常用 / 普通 / 不显示三档；大类；下面是用到它的任务和项目。
 * - 键盘：⌘F 或直接打字聚焦搜索；⌘1 / ⌘2 / ⌘3 把高亮或打开的那个切成常用 / 普通 / 不显示。改动马上保存，改档能撤销。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button as RacButton, Input, TextField } from 'react-aria-components';
import { ChevronLeft, Tags } from 'lucide-react';
import { CATEGORY_GROUPS, isFinished, type Category, type CategoryState } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { Empty, PopoverPanel, Section, Segmented, Select } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { TaskRow } from '../components/TaskRow';
import { CategoryBadge, CategoryList, categoryGroupLabel, categoryStateLabel, categoryUsage, useCategoryActions } from '../components/CategoryEditor';
import { ColorPicker, IconPicker } from '../components/TypeManager';
import { dataLabel, tr, trc } from '../lib/i18n';

const STATES: CategoryState[] = ['frequent', 'normal', 'hidden'];

export function CategoriesPage({ id }: { id?: string }) {
  const store = useStore();
  const { layout } = useSettings();
  const mobile = layout === 'mobile';
  const all = store.categories(true);
  const hidden = all.filter((c) => c.hidden).length;
  const used = categoryUsage(store).size;
  const selected = store.category(id ?? null);
  const open = useCallback((cid: string) => navigate({ page: 'types', id: cid }), []);
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const { setState } = useCategoryActions();
  const target = active ?? selected?.id ?? null;

  // 键盘：⌘F / 直接打字 → 搜索框；⌘1/2/3 → 三档
  useEffect(() => {
    if (mobile) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const inDialog = !!el?.closest('[role="dialog"]');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        if (!target || inDialog) return;
        e.preventDefault();
        setState(target, STATES[Number(e.key) - 1]!);
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (!typing && !inDialog && !mod && !e.altKey && e.key.length === 1 && e.key !== ' ') searchRef.current?.focus();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [mobile, target, setState]);

  if (mobile && selected)
    return (
      <div className="page types-page">
        <RacButton className="btn btn-quiet types-back" onPress={() => navigate({ page: 'types' })}>
          <ChevronLeft size={16} aria-hidden />
          {tr('全部类型')}
        </RacButton>
        <CategoryDetail c={selected} />
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
          <CategoryList selectedId={selected?.id ?? null} onOpen={open} onActive={setActive} mobile={mobile} searchRef={searchRef} />
        </div>
        {!mobile && <div className="types-uses">{selected ? <CategoryDetail c={selected} /> : <Empty icon={<Tags size={28} />} title={tr('点一个类型，看挂了它的任务和项目')} />}</div>}
      </div>
    </div>
  );
}

/** 详情：头部（图标块 + 名字）、三档、大类、用到它的任务和项目。 */
function CategoryDetail({ c }: { c: Category }) {
  return (
    <div className="types-uses-body">
      <CategoryHead c={c} />
      <CategoryUses c={c} />
    </div>
  );
}

function CategoryHead({ c }: { c: Category }) {
  const store = useStore();
  const { setState, setGroup } = useCategoryActions();
  const shown = dataLabel(c.name);
  const [name, setName] = useState(shown);
  const [note, setNote] = useState('');
  useEffect(() => {
    setName(shown);
    setNote('');
  }, [shown, c.id]);
  const commit = () => {
    const n = name.trim();
    if (!n || n === shown || n === c.name) return setName(shown);
    if (!store.updateCategory(c.id, { name: n })) {
      setNote(tr('已经有叫「{name}」的类型了，名字没改', { name: n }));
      setName(shown);
    } else setNote('');
  };
  const state = store.categoryState(c.id);
  const group = store.categoryGroup(c.id);
  return (
    <div className="cat-head">
      <div className="cat-head-top">
        <PopoverPanel
          label={tr('图标和颜色')}
          className="cat-style-popover"
          trigger={
            <RacButton className="cat-badge-btn" aria-label={tr('换「{name}」的图标和颜色', { name: shown })}>
              <CategoryBadge c={c} size={44} />
            </RacButton>
          }
        >
          <div className="cat-style">
            <ColorPicker value={c.color} onChange={(color: string) => store.updateCategory(c.id, { color })} />
            <IconPicker value={c.icon} searchable onChange={(icon) => store.updateCategory(c.id, { icon })} />
          </div>
        </PopoverPanel>
        <TextField aria-label={tr('「{name}」的名字', { name: shown })} value={name} onChange={setName} className="cat-head-name">
          <Input className="input" onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </TextField>
      </div>
      {note && (
        <p className="foot-note cat-head-note" role="status">
          {note}
        </p>
      )}
      <div className="cat-head-props">
        <div className="field cat-head-state">
          <span className="field-label">{tr('显示方式')}</span>
          <Segmented label={tr('显示方式')} value={state} onChange={(s) => setState(c.id, s)} options={STATES.map((s) => ({ id: s, label: categoryStateLabel(s) }))} />
        </div>
        <Select
          className="cat-head-group"
          label={tr('大类')}
          value={group}
          onChange={(g) => setGroup(c.id, g as (typeof CATEGORY_GROUPS)[number])}
          options={CATEGORY_GROUPS.map((g) => ({ id: g, label: categoryGroupLabel(g) }))}
        />
      </div>
      <p className="foot-note cat-head-hint">
        {state === 'hidden'
          ? tr('不显示：选类型时看不到它，已经挂着的任务和项目照常显示。')
          : state === 'frequent'
            ? tr('常用：选类型时排在最前面。')
            : tr('普通：选类型时按最近用过的先后排。')}
      </p>
    </div>
  );
}

/** 挂了这个类型的项目和任务（没做完的在前，做完 / 关闭的收在后面）。 */
function CategoryUses({ c }: { c: Category }) {
  const store = useStore();
  const groups = store.list('group').filter((g) => store.category(g.category_id)?.id === c.id);
  const tasks = store.tasksOfCategory(c.id);
  const open = tasks.filter((t) => !isFinished(t.status));
  const ended = tasks.filter((t) => isFinished(t.status));
  return (
    <>
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
    </>
  );
}
