import { useEffect, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarCheck2, CalendarDays, ChevronRight, ListChecks, Menu, Network, Plus, Search, Settings, Shapes, Sun, Users, X, type LucideIcon } from 'lucide-react';
import { href, navigate, useRoute, type Route } from './lib/router';
import { useSettings } from './lib/settings';
import { useUi } from './lib/ui';
import { useStore } from './store/StoreProvider';
import { MyDayPage } from './pages/MyDay';
import { AgendaPage } from './pages/Agenda';
import { GroupDetailPage, GroupsPage } from './pages/Groups';
import { PeoplePage, PersonDetailPage } from './pages/People';
import { GraphPage } from './pages/Graph';
import { DoablePage } from './pages/Doable';
import { CheckInsPage } from './pages/CheckIns';
import { SettingsPage } from './pages/Settings';
import { TaskDetail } from './components/task/TaskDetail';
import { TaskComposer } from './components/task/TaskComposer';
import { CommandPalette } from './components/CommandPalette';
import { toDateKey } from '@mindough/core';
import { LoginErrorBanner } from './components/LoginErrorBanner';

interface NavItem {
  page: Route['page'];
  label: string;
  icon: LucideIcon;
  match: Route['page'][];
}

const NAV: NavItem[] = [
  { page: 'myday', label: '我的一天', icon: Sun, match: ['myday'] },
  { page: 'agenda', label: '列表', icon: CalendarDays, match: ['agenda'] },
  { page: 'groups', label: '组', icon: Shapes, match: ['groups', 'group'] },
  { page: 'people', label: '人物', icon: Users, match: ['people', 'person'] },
  { page: 'graph', label: '关系图', icon: Network, match: ['graph'] },
  { page: 'doable', label: '可做', icon: ListChecks, match: ['doable'] },
  { page: 'checkin', label: '打卡', icon: CalendarCheck2, match: ['checkin'] },
];
const SETTINGS: NavItem = { page: 'settings', label: '设置', icon: Settings, match: ['settings'] };
const MOBILE_TABS: Route['page'][] = ['myday', 'agenda', 'checkin', 'graph'];

function NavLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const Icon = item.icon;
  return (
    <a href={href({ page: item.page } as Route)} className={`nav-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon">
        <Icon size={18} />
      </span>
      <span className="nav-label">{item.label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </a>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'myday':
      return <MyDayPage />;
    case 'agenda':
      return <AgendaPage />;
    case 'groups':
      return <GroupsPage />;
    case 'group':
      return <GroupDetailPage id={route.id} />;
    case 'people':
      return <PeoplePage />;
    case 'person':
      return <PersonDetailPage id={route.id} />;
    case 'graph':
      return <GraphPage />;
    case 'doable':
      return <DoablePage />;
    case 'checkin':
      return <CheckInsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'more':
      return <MorePage />;
  }
}

function MorePage() {
  const items = [...NAV.filter((n) => !MOBILE_TABS.includes(n.page)), SETTINGS];
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">更多</h1>
      </header>
      <div className="card more-list">
        {items.map((n) => {
          const Icon = n.icon;
          return (
            <a key={n.page} className="more-item" href={href({ page: n.page } as Route)}>
              <Icon size={20} />
              <span className="grow">{n.label}</span>
              <ChevronRight size={16} className="muted" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Toasts() {
  const ui = useUi();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {ui.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone ?? 'info'}`}>
          <span className="toast-msg">{t.message}</span>
          {t.actions?.map((a) => (
            <RacButton
              key={a.label}
              className="toast-action"
              onPress={() => {
                a.onPress();
                ui.dismiss(t.id);
              }}
            >
              {a.label}
            </RacButton>
          ))}
          <RacButton className="toast-close" aria-label="关闭" onPress={() => ui.dismiss(t.id)}>
            <X size={14} />
          </RacButton>
        </div>
      ))}
    </div>
  );
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function App() {
  const route = useRoute();
  const ui = useUi();
  const store = useStore();
  const { layout, skin } = useSettings();
  const isActive = (n: NavItem) => n.match.includes(route.page);
  const todayCount = store.list('my_day').filter((e) => e.date === toDateKey(store.now()) && store.get('task', e.task_id)).length;

  // 快捷键：⌘K / Ctrl+K 搜索；N 快速新建（不在输入框时）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(true);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n' && !isTyping(e.target) && !ui.editingId && !ui.paletteOpen) {
        e.preventDefault();
        ui.openQuickCreate(route.page === 'group' ? { group_id: route.id } : {});
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [ui, route]);

  const newTask = () => ui.openQuickCreate(route.page === 'group' ? { group_id: route.id } : {});
  const current = [...NAV, SETTINGS].find(isActive);

  let shell: ReactNode;
  if (layout === 'desktop') {
    shell = (
      <div className="app app-desktop">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img src="/favicon.svg" alt="" width={22} height={22} />
            <span>Mindough</span>
          </div>
          <RacButton className="sidebar-search" onPress={() => ui.setPaletteOpen(true)}>
            <Search size={15} />
            <span className="grow">搜索</span>
            <kbd className="kbd">{skin === 'apple' ? '⌘K' : 'Ctrl K'}</kbd>
          </RacButton>
          <nav className="nav" aria-label="主导航">
            {NAV.map((n) => (
              <NavLink key={n.page} item={n} active={isActive(n)} badge={n.page === 'myday' ? todayCount : undefined} />
            ))}
          </nav>
          <div className="sidebar-foot">
            <NavLink item={SETTINGS} active={isActive(SETTINGS)} />
            <RacButton className="btn btn-primary sidebar-new" onPress={newTask}>
              <Plus size={16} />
              新建任务
              <kbd className="kbd kbd-on-accent">N</kbd>
            </RacButton>
          </div>
        </aside>
        <main className="main">
          <LoginErrorBanner />
          <Page route={route} />
        </main>
      </div>
    );
  } else {
    const tabs = NAV.filter((n) => MOBILE_TABS.includes(n.page));
    const moreActive = !tabs.some(isActive);
    shell = (
      <div className="app app-mobile">
        <div className="topbar">
          <span className="topbar-title">{current?.label ?? 'Mindough'}</span>
          <RacButton className="icon-btn" aria-label="搜索" onPress={() => ui.setPaletteOpen(true)}>
            <Search size={20} />
          </RacButton>
          {skin !== 'material' && (
            <RacButton className="icon-btn topbar-add" aria-label="新建任务" onPress={newTask}>
              <Plus size={22} />
            </RacButton>
          )}
        </div>
        <main className="main">
          <LoginErrorBanner />
          <Page route={route} />
        </main>
        {skin === 'material' && (
          <RacButton className="fab" aria-label="新建任务" onPress={newTask}>
            <Plus size={24} />
          </RacButton>
        )}
        <nav className="tabbar" aria-label="主导航">
          {tabs.map((n) => {
            const Icon = n.icon;
            return (
              <a key={n.page} href={href({ page: n.page } as Route)} className={`tab-item${isActive(n) ? ' is-active' : ''}`} aria-current={isActive(n) ? 'page' : undefined}>
                <span className="tab-icon">
                  <Icon size={20} />
                </span>
                <span className="tab-label">{n.label}</span>
              </a>
            );
          })}
          <a href="#/more" className={`tab-item${moreActive ? ' is-active' : ''}`} onClick={(e) => { if (route.page === 'more') { e.preventDefault(); navigate({ page: 'myday' }); } }}>
            <span className="tab-icon">
              <Menu size={20} />
            </span>
            <span className="tab-label">更多</span>
          </a>
        </nav>
      </div>
    );
  }

  return (
    <>
      {shell}
      <TaskDetail />
      <TaskComposer />
      <CommandPalette />
      <Toasts />
    </>
  );
}
