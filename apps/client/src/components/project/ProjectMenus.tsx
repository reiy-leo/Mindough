/**
 * 项目页右上角的两个图标按钮（Rei 2026-10-26「视图和排序放在右上角图标按钮，点击dropdown」）：
 * 视图（图标跟着当前视图变）和排序（字段一组 + 正序 / 倒序一组），都是 React Aria 菜单、单选打勾。
 */
import type { ReactNode } from 'react';
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Button as RacButton, Separator } from 'react-aria-components';
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide, Check, GanttChart, Kanban, LayoutList, Workflow, type LucideIcon } from 'lucide-react';
import type { ProjectView, SortDir, SortField } from '../../lib/project-view';
import { Tip } from '../../ui/primitives';

import { tr } from '../../lib/i18n';

export const VIEW_ICON: Record<ProjectView, LucideIcon> = { list: LayoutList, board: Kanban, timeline: GanttChart, chain: Workflow };

export const VIEW_LABEL: Record<ProjectView, () => string> = {
  list: () => tr('列表'),
  board: () => tr('看板'),
  timeline: () => tr('时间轴'),
  chain: () => tr('任务链'),
};

const SORT_LABEL: Record<SortField, () => string> = {
  default: () => tr('默认顺序'),
  created: () => tr('创建时间'),
  updated: () => tr('修改时间'),
  start: () => tr('开始时间'),
  due: () => tr('到期时间'),
};

function Item({ id, icon, children, isDisabled }: { id: string; icon?: ReactNode; children: ReactNode; isDisabled?: boolean }) {
  return (
    <MenuItem id={id} isDisabled={isDisabled} className="menu-item menu-check" textValue={typeof children === 'string' ? children : id}>
      {({ isSelected }) => (
        <>
          {icon}
          <span className="menu-check-text">{children}</span>
          <span className="menu-check-mark" aria-hidden>
            {isSelected && <Check size={15} />}
          </span>
        </>
      )}
    </MenuItem>
  );
}

export function ViewMenu({ view, onChange }: { view: ProjectView; onChange: (v: ProjectView) => void }) {
  const Icon = VIEW_ICON[view];
  const label = tr('视图：{name}', { name: VIEW_LABEL[view]() });
  return (
    <MenuTrigger>
      <Tip content={label}>
        <RacButton className="icon-btn" aria-label={label}>
          <Icon size={18} />
        </RacButton>
      </Tip>
      <Popover className="popover menu-popover" placement="bottom end" offset={4}>
        <Menu
          className="menu"
          aria-label={tr('视图')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[view]}
          onSelectionChange={(keys) => {
            const k = [...keys][0];
            if (k !== undefined) onChange(String(k) as ProjectView);
          }}
        >
          {(['list', 'board', 'timeline', 'chain'] as const).map((v) => {
            const I = VIEW_ICON[v];
            return (
              <Item key={v} id={v} icon={<I size={16} />}>
                {VIEW_LABEL[v]()}
              </Item>
            );
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function SortMenu({ field, dir, onChange }: { field: SortField; dir: SortDir; onChange: (field: SortField, dir: SortDir) => void }) {
  const label = field === 'default' ? tr('排序：{name}', { name: SORT_LABEL[field]() }) : tr('排序：{name}，{dir}', { name: SORT_LABEL[field](), dir: dir === 'asc' ? tr('正序') : tr('倒序') });
  return (
    <MenuTrigger>
      <Tip content={label}>
        <RacButton className={`icon-btn${field !== 'default' ? ' is-active' : ''}`} aria-label={label}>
          <ArrowUpDown size={18} />
        </RacButton>
      </Tip>
      <Popover className="popover menu-popover" placement="bottom end" offset={4}>
        <Menu className="menu" aria-label={tr('排序')}>
          <MenuSection
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[field]}
            onSelectionChange={(keys) => {
              const k = [...keys][0];
              if (k !== undefined) onChange(String(k) as SortField, dir);
            }}
          >
            <Header className="menu-header">{tr('排序依据')}</Header>
            {(['default', 'created', 'updated', 'start', 'due'] as const).map((f) => (
              <Item key={f} id={f}>
                {SORT_LABEL[f]()}
              </Item>
            ))}
          </MenuSection>
          <Separator className="menu-sep" />
          <MenuSection
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={field === 'default' ? [] : [dir]}
            onSelectionChange={(keys) => {
              const k = [...keys][0];
              if (k === 'asc' || k === 'desc') onChange(field, k);
            }}
          >
            <Header className="menu-header">{tr('顺序')}</Header>
            <Item id="asc" isDisabled={field === 'default'} icon={<ArrowUpNarrowWide size={16} />}>
              {tr('正序')}
            </Item>
            <Item id="desc" isDisabled={field === 'default'} icon={<ArrowDownWideNarrow size={16} />}>
              {tr('倒序')}
            </Item>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
