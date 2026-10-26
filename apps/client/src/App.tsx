import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarCheck2, CalendarDays, ChevronRight, Hourglass, Library, ListChecks, Menu, NotebookPen, Plus, Search, Settings, Inbox, Shapes, Sun, Users, X, type LucideIcon } from 'lucide-react';
import { href, navigate, useRoute, type Route, type SettingsSection } from './lib/router';
import { openSettingsWindow } from './lib/windows';
import { isTauri } from './store/sqlite-tauri';
import { useSettings } from './lib/settings';
import { useUi } from './lib/ui';
import { useStore } from './store/StoreProvider';
import { MyDayPage } from './pages/MyDay';
import { AgendaPage } from './pages/Agenda';
import { BacklogPage } from './pages/Backlog';
import { GroupDetailPage, GroupsPage } from './pages/Groups';
import { PersonDetailPage } from './pages/People';
import { LibraryItemPage, LibraryPage } from './pages/Library';
import { BUILTIN_TYPE_IDS } from '@mindough/core';
import { DoablePage } from './pages/Doable';
import { CheckInsPage } from './pages/CheckIns';
import { COUNTDOWN_DEFAULTS, CountdownsPage } from './pages/Countdowns';
import { SettingsPage } from './pages/Settings';
import { JournalPage } from './pages/Journal';
import { TaskDetail } from './components/task/TaskDetail';
import { DetailPane } from './components/task/DetailPane';
import { WIDE_MIN } from './lib/detail-pane';
import { DeepLinks } from './components/DeepLinks';
import { TaskComposer } from './components/task/TaskComposer';
import { CommandPalette } from './components/CommandPalette';
import { toDateKey } from '@mindough/core';
import { LoginErrorBanner } from './components/LoginErrorBanner';
import { ReminderHost } from './components/ReminderHost';
import { useLunarSubScheduler } from './lib/lunar';
import { Tip } from './ui/primitives';
import { useAppMenu } from './lib/app-menu';

const DidaImportSheet = lazy(() => import('./components/DidaImport').then((m) => ({ default: m.DidaImportSheet })));

import { appName, tr, trc } from './lib/i18n';
interface NavItem {
  page: Route['page'];
  label: string;
  icon: LucideIcon;
  match: Route['page'][];
}

/**
 * 导航分区（Rei 2026-10-16：「侧边栏分一下section，太乱了」）：
 * 今天（要动手的）· 计划（怎么安排）· 持续（天天记、慢慢攒的）· 资料（记下的东西）；设置固定在底部。手机标签栏按同样的顺序，其余放进「更多」并分同样的组。
 * 「持续」（Rei 2026-10-26「把倒数日从“打卡”中拆出来单独一个侧边栏入口，把打卡、倒数日、日记放在另一个section：持续」）：打卡、倒数日、日记。
 */
interface NavSection {
  id: 'today' | 'plan' | 'ongoing' | 'library';
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'today',
    get title() { return tr('今天'); },
    items: [
      { page: 'myday', get label() { return tr('我的一天'); }, icon: Sun, match: ['myday'] },
      { page: 'backlog', get label() { return tr('待安排'); }, icon: Inbox, match: ['backlog'] },
      { page: 'doable', get label() { return tr('可做'); }, icon: ListChecks, match: ['doable'] },
    ],
  },
  {
    id: 'plan',
    get title() { return tr('计划'); },
    items: [
      { page: 'agenda', get label() { return trc('导航', '列表'); }, icon: CalendarDays, match: ['agenda'] },
      { page: 'groups', get label() { return trc('导航', '项目'); }, icon: Shapes, match: ['groups', 'group'] },
    ],
  },
  {
    id: 'ongoing',
    get title() { return trc('导航', '持续'); },
    items: [
      { page: 'checkin', get label() { return trc('导航', '打卡'); }, icon: CalendarCheck2, match: ['checkin'] },
      { page: 'countdown', get label() { return tr('倒数日'); }, icon: Hourglass, match: ['countdown'] },
      // 日记（Rei 2026-10-17）：手机不进标签栏，在「更多」里
      { page: 'journal', get label() { return tr('日记'); }, icon: NotebookPen, match: ['journal'] },
    ],
  },
  {
    id: 'library',
    get title() { return tr('资料'); },
    items: [
      { page: 'library', get label() { return tr('资料库'); }, icon: Library, match: ['library', 'libitem'] },
      { page: 'people', get label() { return tr('人物'); }, icon: Users, match: ['people', 'person'] },
    ],
  },
];
const NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
const SETTINGS: NavItem = { page: 'settings', get label() { return tr('设置'); }, icon: Settings, match: ['settings'] };
const MOBILE_TABS: Route['page'][] = ['myday', 'backlog', 'checkin', 'agenda'];
/** 有任务列表的页面：宽屏上右列常驻（没选中时是空状态）；别的页面（日记、资料库、设置…）只在打开任务时才出现右列。 */
const LIST_PAGES: Route['page'][] = ['myday', 'backlog', 'agenda', 'groups', 'group', 'doable', 'checkin', 'countdown'];
/** 中间列不放页头、最上面是添加框的页面（Rei 2026-10-26）：手机上标题显示在顶栏。 */
const HEADERLESS_PAGES: Route['page'][] = ['myday', 'backlog', 'doable'];
const COLLAPSED_KEY = 'mindough:nav_collapsed';

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  return [collapsed, toggle] as const;
}

/** 窗口是不是比宽屏窄（中等宽度：侧边栏收成图标栏）。 */
function useNarrow(): boolean {
  const query = `(max-width: ${WIDE_MIN - 0.02}px)`;
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

function NavLink({ item, active, badge, onOpen }: { item: NavItem; active: boolean; badge?: number; onOpen?: () => void }) {
  const Icon = item.icon;
  return (
    <a
      href={href({ page: item.page } as Route)}
      onClick={
        onOpen
          ? (e) => {
              e.preventDefault();
              onOpen();
            }
          : undefined
      }
      className={`nav-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} title={item.label}>
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
    case 'backlog':
      return <BacklogPage />;
    case 'groups':
      return <GroupsPage />;
    case 'group':
      return <GroupDetailPage id={route.id} />;
    case 'people':
      // 人物库：资料库里的「人物」
      return <LibraryPage typeId={BUILTIN_TYPE_IDS.person} />;
    case 'library':
      return <LibraryPage {...(route.typeId ? { typeId: route.typeId } : {})} />;
    case 'libitem':
      return <LibraryItemPage typeId={route.typeId} id={route.id} />;
    case 'person':
      return <PersonDetailPage id={route.id} />;
    case 'doable':
      return <DoablePage />;
    case 'checkin':
      return <CheckInsPage />;
    case 'countdown':
      return <CountdownsPage />;
    case 'journal':
      return <JournalPage {...(route.date ? { date: route.date } : {})} />;
    case 'settings':
      return <SettingsPage {...(route.section ? { section: route.section } : {})} />;
    case 'more':
      return <MorePage />;
  }
}

/** 新建任务：右下角浮动按钮（Rei 2026-10-17「新建任务移动到右下角浮动」），三种皮肤各自的形状写在 skin/skins.css；快捷键 N 不变。 */
function NewTaskFab({ onPress }: { onPress: () => void }) {
  return (
    <RacButton className="fab" aria-label={tr('新建任务')} onPress={onPress}>
      <Plus size={24} strokeWidth={2.25} aria-hidden />
    </RacButton>
  );
}

function MorePage() {
  const sections = [
    ...NAV_SECTIONS.map((sec) => ({ id: sec.id, title: sec.title, items: sec.items.filter((n) => !MOBILE_TABS.includes(n.page)) })),
    { id: 'settings', title: '', items: [SETTINGS] },
  ].filter((sec) => sec.items.length > 0);
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{tr('更多')}</h1>
      </header>
      {sections.map((sec) => (
        <section key={sec.id} className="more-section" aria-label={sec.title || SETTINGS.label}>
          {sec.title && <h2 className="more-section-title">{sec.title}</h2>}
          <div className="card more-list">
            {sec.items.map((n) => {
              const Icon = n.icon;
              return (
                <a key={n.page} className="more-item" href={href({ page: n.page } as Route)}>
                  <span className="more-icon">
                    <Icon size={20} />
                  </span>
                  <span className="grow">{n.label}</span>
                  <ChevronRight size={16} className="muted" />
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Toasts() {
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
          <RacButton className="toast-close" aria-label={tr('关闭')} onPress={() => ui.dismiss(t.id)}>
            <X size={14} />
          </RacButton>
        </div>
      ))}
    </div>
  );
}

/** 新建按钮和 N 的默认值：项目页带上项目，倒数日页默认建倒数日。 */
function newTaskDefaults(route: Route) {
  if (route.page === 'group') return { group_id: route.id };
  if (route.page === 'countdown') return COUNTDOWN_DEFAULTS;
  return {};
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function App() {
  const route = useRoute();
  const ui = useUi();
  const store = useStore();
  useLunarSubScheduler(store);
  const { setDidaImportOpen } = ui;
  const { layout, skin, platform } = useSettings();
  // 桌面 app（Tauri）：设置是单独的窗口（Rei 2026-10-26）；Web 和手机仍是页面
  const settingsInWindow = isTauri() && (platform === 'macos' || platform === 'windows' || platform === 'linux');
  const openSettings = useCallback(
    (section?: SettingsSection) => void openSettingsWindow({ ...(section ? { section } : {}), title: tr('设置'), macOverlay: platform === 'macos' }),
    [platform],
  );
  useAppMenu({ importDida: useCallback(() => setDidaImportOpen(true), [setDidaImportOpen]), openSettings: useCallback(() => openSettings(), [openSettings]) });
  // 走到 #/settings（深链 view/settings、手机布局「更多」里的设置、旧链接）：开设置窗口，主窗口退回原来的页面
  useEffect(() => {
    if (!settingsInWindow || route.page !== 'settings') return;
    openSettings(route.section);
    if (history.length > 1) history.back();
    else location.replace('#/myday');
  }, [settingsInWindow, route, openSettings]);
  const isActive = (n: NavItem) => n.match.includes(route.page);
  const [collapsed, toggleSection] = useCollapsed();
  const todayCount = store.list('my_day').filter((e) => e.date === toDateKey(store.now()) && store.get('task', e.task_id)).length;

  // 快捷键：⌘K / Ctrl+K 搜索；⌘, / Ctrl+, 设置；N 快速新建（不在输入框时）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ',') {
        e.preventDefault();
        if (settingsInWindow) openSettings();
        else navigate({ page: 'settings' });
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(true);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n' && !isTyping(e.target) && !ui.paletteOpen && !ui.quickCreate) {
        e.preventDefault();
        ui.openQuickCreate(newTaskDefaults(route), { myDay: route.page === 'myday' });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [ui, route, settingsInWindow, openSettings]);

  const newTask = () => ui.openQuickCreate(newTaskDefaults(route), { myDay: route.page === 'myday' });
  const backlogCount = store.backlog(toDateKey(store.now())).length;
  const current = [...NAV, SETTINGS].find(isActive);
  // 中等宽度：侧边栏是图标栏，小节标题不显示，收起的小节也照样列出来（不然点不开）
  const narrow = useNarrow();
  const selected = !!store.get('task', ui.editingId);
  const hideFab = route.page === 'journal';

  let shell: ReactNode;
  if (layout === 'desktop') {
    shell = (
      <div className={`app app-desktop${narrow ? ' is-narrow' : ''}${selected ? ' has-detail' : ''}${LIST_PAGES.includes(route.page) ? '' : ' no-list'}`}>
        <aside className="sidebar">
          {/* macOS 无标题栏时给红绿灯让位、可拖动窗口（双击放大）；其他平台不显示 */}
          <div className="titlebar-space" data-tauri-drag-region aria-hidden />
          <RacButton className="sidebar-search" aria-label={tr('搜索')} onPress={() => ui.setPaletteOpen(true)}>
            <Search size={15} />
            <span className="grow">{tr('搜索')}</span>
            <kbd className="kbd">{skin === 'apple' ? '⌘K' : 'Ctrl K'}</kbd>
          </RacButton>
          <nav className="nav" aria-label={tr('主导航')}>
            {NAV_SECTIONS.map((sec) => {
              const isCollapsed = !narrow && collapsed.includes(sec.id) && !sec.items.some(isActive);
              return (
                <div key={sec.id} className="nav-section" role="group" aria-labelledby={`nav-sec-${sec.id}`}>
                  <RacButton id={`nav-sec-${sec.id}`} className="nav-section-title" aria-expanded={!isCollapsed} onPress={() => toggleSection(sec.id)}>
                    <span>{sec.title}</span>
                    <ChevronRight size={12} aria-hidden className={`nav-section-chevron${isCollapsed ? '' : ' is-open'}`} />
                  </RacButton>
                  {!isCollapsed &&
                    sec.items.map((n) => <NavLink key={n.page} item={n} active={isActive(n)} badge={n.page === 'myday' ? todayCount : n.page === 'backlog' ? backlogCount : undefined} />)}
                </div>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            {settingsInWindow ? <NavLink item={SETTINGS} active={false} onOpen={() => openSettings()} /> : <NavLink item={SETTINGS} active={isActive(SETTINGS)} />}
          </div>
        </aside>
        {/* 中间一列：当前视图的列表；新建按钮浮在这一列右下角（不压住右列的详情） */}
        <div className="main-col">
          <main className="main">
            <div className="titlebar-space" data-tauri-drag-region aria-hidden />
            <div className="main-scroll">
              <LoginErrorBanner />
              {!(settingsInWindow && route.page === 'settings') && <Page route={route} />}
            </div>
          </main>
          {/* 日记页不放新建按钮（改版 B 按原型默认，待 Rei 确认）：写作区像一页纸，按钮会压在正文上；N 和 ⌘K 照常能新建任务 */}
          {!hideFab && (
            <Tip content={<>{tr('新建任务')} <kbd className="kbd">N</kbd></>}>
              <NewTaskFab onPress={newTask} />
            </Tip>
          )}
        </div>
        <DetailPane />
      </div>
    );
  } else {
    const tabs = NAV.filter((n) => MOBILE_TABS.includes(n.page));
    const moreActive = !tabs.some(isActive);
    shell = (
      <div className={`app app-mobile${selected ? ' has-detail' : ''}`}>
        <div className={`topbar${HEADERLESS_PAGES.includes(route.page) ? ' is-titled' : ''}`}>
          <span className="topbar-title">{current?.label ?? appName()}</span>
          <RacButton className="icon-btn" aria-label={tr('搜索')} onPress={() => ui.setPaletteOpen(true)}>
            <Search size={20} />
          </RacButton>
        </div>
        <main className="main">
          <LoginErrorBanner />
          {!(settingsInWindow && route.page === 'settings') && <Page route={route} />}
        </main>
        {!hideFab && <NewTaskFab onPress={newTask} />}
        <nav className="tabbar" aria-label={tr('主导航')}>
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
            <span className="tab-label">{tr('更多')}</span>
          </a>
        </nav>
        {/* 手机：任务详情整页推入（不是底部弹窗），返回 / 右滑 / 系统返回键回到列表 */}
        <TaskDetail mode="page" />
      </div>
    );
  }

  return (
    <>
      {shell}
      <TaskComposer />
      <ReminderHost />
      <CommandPalette />
      {ui.didaImportOpen && (
        <Suspense fallback={null}>
          <DidaImportSheet isOpen={ui.didaImportOpen} onOpenChange={ui.setDidaImportOpen} />
        </Suspense>
      )}
      <Toasts />
      <DeepLinks />
    </>
  );
}
