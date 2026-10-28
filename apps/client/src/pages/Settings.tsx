import { lazy, Suspense, useEffect, useState, type KeyboardEvent } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import { AlertCircle, ArrowLeftRight, Bell, ChevronLeft, ChevronRight, CircleUser, CloudCheck, CloudOff, Database, Info, Laptop, NotebookPen, ListTodo, LogIn, LogOut, MonitorSmartphone, Palette, RefreshCw, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from 'lucide-react';
import { href, isSettingsSection, navigate, useRoute, type SettingsSection } from '../lib/router';
import { focusMainWindow, isSettingsWindow, SETTINGS_NAV_EVENT } from '../lib/windows';
import { relay } from '../lib/window-relay';
import { IMPORT_DIDA, MENU_EVENT } from '../lib/app-menu';
import { loginUrl, logout, useAccount } from '../lib/account';
import { syncNow, useSyncView, type SyncView } from '../lib/sync';
import { cloudStorageName, useCloudStorage, type CloudStorage } from '../lib/cloud';
import { startNativeLogin } from '../lib/native-login';
import { isTauri } from '../store/sqlite-tauri';
import { useUi } from '../lib/ui';
import { addDays, DATE_DISPLAYS, formatTaskDate, isChineseLocale, resetSyncState, syncedAgo, toDateKey, type DateDisplay } from '@mindough/core';
import { Button, Section, Segmented, Select, Switch } from '../ui/primitives';
import { JOURNAL_PREFS, JOURNAL_REMIND_TIME_DEFAULT, normalizeRemindTime } from '@mindough/core';
import { formatRemindTime } from '../components/task/RemindPanel';
import { notifyPermission, onReminderSettings, remindersEnabled, requestNotifyPermission, setRemindersEnabled, type NotifyPermission } from '../lib/reminders';
import { PageHeader } from '../components/PageHeader';
import { TypeManager } from '../components/TypeManager';
import { LunarSection } from '../components/LunarSettings';
import { useSettings, type Settings } from '../lib/settings';
import { PLATFORM_LABEL, SKIN_LABEL, skinForPlatform } from '../skin/platform';
import { storageInfo, useNow, useStore } from '../store/StoreProvider';

import { appName, getLocale, LOCALE_NAMES, LOCALES, tr, trc } from '../lib/i18n';
import tmdbLogo from '../assets/tmdb-logo.svg';
import { versionLabel } from '../lib/version';
import { useLocalePref } from '../lib/locale';
import { exportToZip } from '../lib/archive';

const ArchiveImportSheet = lazy(() => import('../components/ArchiveImport').then((m) => ({ default: m.ArchiveImportSheet })));
import type { LocalePref } from '../lib/i18n';

/**
 * 设置分成七项（Rei 2026-10-26「设置在桌面端做成一个单独的窗口，设置窗口侧边栏：账户、外观」，补充「数据、提醒、任务」，
 * 又说「农历、类型、日记这三个可以放在一个」；同一天又说「这个页面的底部的关于念头团的说明，可以放在一个单独的选项卡：关于」「设置中日记单独一个tab」）：
 * - 账户：登录、同步状态、数据怎么走
 * - 外观：皮肤、语言、明暗、布局、热力图每月 1 号标记
 * - 数据：本机存储、导出、导入、从滴答清单导入、重置演示数据
 * - 提醒：提醒通知开关（这台设备）、什么时候提醒
 * - 任务：类型、日期显示、农历
 * - 日记：一天从几点开始、每天提醒写日记
 * - 关于：图标、名字、版本号、一句说明、第三方数据署名（TMDB）
 * 桌面 app（Tauri）里设置是单独的窗口（SettingsWindow，?window=settings）；Web 和手机是页面：
 * 宽屏左边一列七项、右边内容；窄屏先列出七项，点进去整页推入，左上角返回。
 */
type SettingsItem = { id: SettingsSection; icon: LucideIcon; label: () => string; hint: () => string };

export const SETTINGS_ITEMS: SettingsItem[] = [
  { id: 'account', icon: CircleUser, label: () => tr('账户'), hint: () => tr('登录与同步') },
  { id: 'appearance', icon: Palette, label: () => tr('外观'), hint: () => tr('皮肤、语言、明暗、布局') },
  { id: 'data', icon: Database, label: () => tr('数据'), hint: () => tr('导入导出、本机存储') },
  { id: 'reminders', icon: Bell, label: () => trc('设置分区', '提醒'), hint: () => tr('任务提醒的通知') },
  { id: 'tasks', icon: ListTodo, label: () => trc('设置分区', '任务'), hint: () => (isChineseLocale() ? tr('资料库、日期显示、农历') : tr('资料库、日期显示')) },
  { id: 'journal', icon: NotebookPen, label: () => tr('日记'), hint: () => tr('一天从几点开始、每天提醒写日记') },
  { id: 'about', icon: Info, label: () => tr('关于'), hint: () => tr('版本、数据来源') },
];

const itemOf = (id: SettingsSection) => SETTINGS_ITEMS.find((i) => i.id === id)!;

/** 上次看的那项：只记在本机。 */
const LAST_KEY = 'mindough:settings-section';
function lastSection(): SettingsSection {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return isSettingsSection(v) ? v : 'account';
  } catch {
    return 'account';
  }
}
function useRememberSection(sec: SettingsSection | undefined) {
  useEffect(() => {
    if (sec) localStorage.setItem(LAST_KEY, sec);
  }, [sec]);
}

function SectionBody({ id }: { id: SettingsSection }) {
  switch (id) {
    case 'account':
      return <AccountSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'data':
      return <DataSection />;
    case 'reminders':
      return <ReminderSection />;
    case 'tasks':
      return (
        <>
          <TypesSection />
          <DateDisplaySection />
          <LunarSection />
        </>
      );
    case 'journal':
      return <JournalSection />;
    case 'about':
      return <AboutSection />;
  }
}

/** 左边那一列（宽屏页面和设置窗口共用）：↑ ↓ 在七项之间换。名字太长就截断加省略号，整列不左右滚（Rei 2026-10-26「设置的侧边栏禁止左右滚动」）。 */
function SettingsNav({ current }: { current: SettingsSection }) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const i = SETTINGS_ITEMS.findIndex((x) => x.id === current);
    const n = SETTINGS_ITEMS.length;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    e.preventDefault();
    const nav = e.currentTarget;
    const next = SETTINGS_ITEMS[j]!.id;
    navigate({ page: 'settings', section: next });
    requestAnimationFrame(() => (nav.querySelector(`[data-section="${next}"]`) as HTMLElement | null)?.focus());
  };
  return (
    <nav className="settings-nav" aria-label={tr('设置分区')} onKeyDown={onKeyDown}>
      {SETTINGS_ITEMS.map((it) => {
        const Icon = it.icon;
        const active = it.id === current;
        return (
          <a
            key={it.id}
            data-section={it.id}
            href={href({ page: 'settings', section: it.id })}
            className={`nav-item settings-nav-item${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="nav-icon">
              <Icon size={18} />
            </span>
            <span className="nav-label settings-nav-label">{it.label()}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** Web 与手机的设置页。section 省略：宽屏显示上次那项，窄屏列出七项。 */
export function SettingsPage({ section }: { section?: SettingsSection }) {
  const { layout } = useSettings();
  const narrow = layout === 'mobile';
  useRememberSection(section);

  if (narrow && !section) {
    return (
      <div className="page settings-page">
        <PageHeader title={tr('设置')} icon={<SettingsIcon size={22} />} />
        <nav className="card more-list settings-list" aria-label={tr('设置分区')}>
          {SETTINGS_ITEMS.map((it) => {
            const Icon = it.icon;
            return (
              <a key={it.id} className="more-item settings-list-item" href={href({ page: 'settings', section: it.id })}>
                <span className="more-icon">
                  <Icon size={20} />
                </span>
                <span className="grow settings-list-text">
                  <span className="settings-list-name">{it.label()}</span>
                  <span className="settings-list-hint">{it.hint()}</span>
                </span>
                <ChevronRight size={16} className="muted" aria-hidden />
              </a>
            );
          })}
        </nav>
      </div>
    );
  }

  if (narrow && section) {
    return (
      <div className="page settings-page settings-push" key={section}>
        <header className="settings-push-head">
          <a className="settings-back" href={href({ page: 'settings' })}>
            <ChevronLeft size={20} aria-hidden />
            <span>{tr('设置')}</span>
          </a>
          <h1 className="settings-push-title">{itemOf(section).label()}</h1>
        </header>
        <div className="settings-pane">
          <SectionBody id={section} />
        </div>
      </div>
    );
  }

  const sec = section ?? lastSection();
  return (
    <div className="page settings-page">
      <PageHeader title={tr('设置')} icon={<SettingsIcon size={22} />} />
      <div className="settings-layout">
        <SettingsNav current={sec} />
        <section className="settings-pane" aria-labelledby="settings-pane-title">
          <h2 id="settings-pane-title" className="settings-pane-title">
            {itemOf(sec).label()}
          </h2>
          <SectionBody id={sec} />
        </section>
      </div>
    </div>
  );
}

/**
 * 桌面 app 的设置窗口（Tauri label settings，像 macOS 的系统设置）：左边侧栏图标 + 名字，右边内容。
 * macOS 隐藏标题栏，红绿灯浮在侧栏上方（styles/settings.css 给它让位）。主窗口按 ⌘, / 菜单「设置…」/ 深链 view/settings 打开或叫到前面。
 */
export function SettingsWindow() {
  const route = useRoute();
  const sec = (route.page === 'settings' && route.section) || lastSection();
  useRememberSection(sec);
  // 主窗口要换到某一项（已经开着时）
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | null = null;
    let dead = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const un = await listen<string>(SETTINGS_NAV_EVENT, (e) => {
        if (isSettingsSection(e.payload)) navigate({ page: 'settings', section: e.payload });
      });
      if (dead) un();
      else off = un;
    });
    return () => {
      dead = true;
      off?.();
    };
  }, []);
  // 窗口标题跟着界面语言（换语言整棵重挂，这里会再跑）
  useEffect(() => {
    document.title = tr('设置');
    if (!isTauri()) return;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTitle(tr('设置'))).catch(() => {});
  }, []);
  return (
    <div className="settings-window">
      <aside className="settings-side">
        <div className="settings-titlebar" data-tauri-drag-region aria-hidden />
        <SettingsNav current={sec} />
      </aside>
      <main className="settings-main" aria-labelledby="settings-window-title">
        <header className="settings-main-head" data-tauri-drag-region>
          <h1 id="settings-window-title" className="settings-main-title" data-tauri-drag-region>
            {itemOf(sec).label()}
          </h1>
        </header>
        <div className="settings-main-scroll">
          <div className="settings-pane">
            <SectionBody id={sec} />
          </div>
        </div>
      </main>
    </div>
  );
}

/** 外观：皮肤、语言、明暗、布局、热力图每月 1 号标记（都是本机设置，语言除外：语言跟着账户同步）。 */
function AppearanceSection() {
  const { settings, set, platform, skin } = useSettings();
  const [localePref, setLocalePref] = useLocalePref();
  return (
    <div className="card settings-card">
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('皮肤')}</div>
          <div className="setting-hint">
            {tr('自动：检测到 {p}，使用 {p2}。当前：{p3}', { p: PLATFORM_LABEL[platform], p2: SKIN_LABEL[skinForPlatform(platform)], p3: SKIN_LABEL[skin] })}
          </div>
        </div>
        <Segmented<Settings['skin']>
          label={tr('皮肤')}
          value={settings.skin}
          onChange={(v) => set('skin', v)}
          options={[
            { id: 'auto', label: tr('自动') },
            { id: 'apple', label: 'Apple' },
            { id: 'winui', label: 'Windows' },
            { id: 'material', label: 'Material' },
          ]}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('语言')}</div>
          <div className="setting-hint">{tr('跟随系统时按系统语言显示，系统语言不在这几种里就用英文；会同步到你的其他设备')}</div>
        </div>
        <Select
          label={tr('语言')}
          className="setting-select"
          value={localePref}
          onChange={(v) => setLocalePref(v as LocalePref)}
          options={[{ id: 'system', label: tr('跟随系统') }, ...LOCALES.map((l) => ({ id: l, label: LOCALE_NAMES[l] }))]}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('明暗')}</div>
          <div className="setting-hint">{tr('默认跟随系统')}</div>
        </div>
        <Segmented<Settings['theme']>
          label={tr('明暗')}
          value={settings.theme}
          onChange={(v) => set('theme', v)}
          options={[
            { id: 'system', label: tr('跟随系统') },
            { id: 'light', label: tr('浅色') },
            { id: 'dark', label: tr('深色') },
          ]}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('布局')}</div>
          <div className="setting-hint">{tr('自动：窗口变窄时改用底部标签栏')}</div>
        </div>
        <Segmented<Settings['layout']>
          label={tr('布局')}
          value={settings.layout}
          onChange={(v) => set('layout', v)}
          options={[
            { id: 'auto', label: tr('自动') },
            { id: 'desktop', label: tr('桌面') },
            { id: 'mobile', label: tr('手机') },
          ]}
        />
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('热力图每月 1 号标记')}</div>
          <div className="setting-hint">{tr('自动：格子够大显示月份数字，小格子显示圆点')}</div>
        </div>
        <Segmented<Settings['monthMarker']>
          label={tr('每月 1 号标记')}
          value={settings.monthMarker}
          onChange={(v) => set('monthMarker', v)}
          options={[
            { id: 'auto', label: tr('自动') },
            { id: 'number', label: tr('数字') },
            { id: 'dot', label: tr('圆点') },
            { id: 'none', label: tr('不标') },
          ]}
        />
      </div>
    </div>
  );
}

/** 数据：本机存储、导出、导入、从滴答清单导入、重置演示数据。 */
function DataSection() {
  const store = useStore();
  const sync = useSyncView();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    store.adapter.pendingOutbox(100000).then((o) => setPending(o.length));
  }, [store, store.version]);
  return (
    <>
    <div className="card settings-card">
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('本地存储')}</div>
          <div className="setting-hint">
            {storageInfo.engine === 'sqlite'
              ? storageInfo.detail === 'tauri-rusqlite'
                ? tr('SQLite（本机文件）')
                : tr('SQLite（浏览器本地）')
              : storageInfo.fallbackReason
                ? tr('浏览器 localStorage（{reason}）', { reason: storageInfo.fallbackReason })
                : tr('浏览器 localStorage')}
            {tr(' · 设备 {id}', { id: store.deviceId })}
            {pending !== null && pending > 0 && tr(' · {pending} 处改动还没同步', { pending })}
          </div>
        </div>
      </div>
      <ArchiveRows />
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('重置演示数据')}</div>
          <div className="setting-hint">
            {sync.enabled ? tr('登录同步时不能重置：会影响你的其他设备。先退出登录再重置。') : tr('清空本机所有任务，重新生成一份演示数据')}
          </div>
        </div>
        <Button
          variant="danger"
          isDisabled={sync.enabled}
          onPress={async () => {
            if (!confirm(tr('确定清空本机数据并重新生成演示数据？'))) return;
            await store.adapter.clear();
            await store.adapter.setMeta('demo_seeded', ''); // 空值 = 未生成，刷新后重新生成
            await resetSyncState(store.adapter); // 下次登录重新合并，云端数据会回来
            reloadAfterReset();
          }}
        >
          {tr('重置')}</Button>
      </div>
    </div>
    </>
  );
}

/**
 * 日期显示（Rei 2026-10-26「设置-任务：支持自定义日期显示格式，相对时间、年月日、年月日+时区、自动等」）：
 * 四选一，只存在这台设备上。每项右边用今天（带现在的时刻）和三天后做实时预览。
 */
const DATE_DISPLAY_LABEL: Record<DateDisplay, () => string> = {
  auto: () => tr('自动'),
  relative: () => tr('相对时间'),
  ymd: () => tr('年月日'),
  'ymd-tz': () => tr('年月日+时区'),
};
function DateDisplaySection() {
  const { settings, set } = useSettings();
  const now = useNow(30_000);
  const today = toDateKey(now);
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const later = addDays(today, 3);
  const preview = (mode: DateDisplay) => (
    <>
      <span className="date-display-sample">{formatTaskDate(today, { mode, today, time: hm })}</span>
      <span aria-hidden> · </span>
      <span className="date-display-sample">{formatTaskDate(later, { mode, today })}</span>
    </>
  );
  return (
    <Section title={tr('日期显示')}>
      <div className="card settings-card">
        <div className="setting date-display-row">
          <div className="setting-text">
            <div className="setting-hint">{tr('任务列表、详情、提醒、倒数日、任务链、项目时间轴里的日期怎么写。只存在这台设备上。')}</div>
            <RadioGroup aria-label={tr('日期显示')} className="date-display-choice" value={settings.dateDisplay ?? 'auto'} onChange={(v) => set('dateDisplay', v as DateDisplay)}>
              {DATE_DISPLAYS.map((m) => (
                <Radio key={m} value={m} className="date-display-option">
                  <span className="date-display-dot" aria-hidden />
                  <span className="date-display-name">{DATE_DISPLAY_LABEL[m]()}</span>
                  <span className="date-display-preview">{preview(m)}</span>
                </Radio>
              ))}
            </RadioGroup>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** 类型：影视、书籍…与自定义类型。打开类型编辑器（和资料库页标签条末尾的「编辑」是同一个）。 */
function TypesSection() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const types = store.editableTypes();
  const archived = store.archivedTypes().length;
  return (
    <Section title={trc('资料库编辑器', '资料库')}>
      <div className="card settings-card">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('全部资料库')}</div>
            <div className="setting-hint">
              {archived ? tr('{n} 个，另有 {h} 个已归档。改字段、图标、版式，或新建自己的资料库。', { n: types.length, h: archived }) : tr('{n} 个。改字段、图标、版式，或新建自己的资料库。', { n: types.length })}
            </div>
          </div>
          <Button variant="secondary" onPress={() => setOpen(true)}>
            {tr('编辑资料库')}</Button>
        </div>
      </div>
      <TypeManager isOpen={open} onOpenChange={setOpen} />
    </Section>
  );
}

/** 重置演示数据之后重新载入。设置窗口里点的：先让主窗口（和小窗）重新载入，等它生成好演示数据再载入自己，免得生成两份。 */
function reloadAfterReset() {
  if (isSettingsWindow() && isTauri()) {
    relay('reload');
    setTimeout(() => location.reload(), 1500);
  } else location.reload();
}

/** 设置窗口里点「从滴答清单导入…」：导入窗口开在主窗口里（和菜单栏 文件 → 导入 一样）。 */
async function importDidaInMain() {
  const { emitTo } = await import('@tauri-apps/api/event');
  await focusMainWindow();
  await emitTo('main', MENU_EVENT, IMPORT_DIDA);
}

/** 导出 / 导入 Markdown 文件夹（格式见 docs/EXPORT.md）。 */
function ArchiveRows() {
  const store = useStore();
  const { toast, setDidaImportOpen } = useUi();
  const [busy, setBusy] = useState<null | 'images' | 'attachments' | 'zip'>(null);
  const [importing, setImporting] = useState(false);
  const doExport = async () => {
    setBusy('zip');
    try {
      const c = await exportToZip(store, setBusy);
      toast({
        tone: 'success',
        message:
          (c.journal ? tr('已导出 {n} 件任务、{j} 条日记', { n: c.tasks, j: c.journal }) : tr('已导出 {n} 件任务', { n: c.tasks })) +
          (c.attachments ? tr('，{a} 个附件', { a: c.attachments }) : '') +
          (c.missedImages ? tr('；{m} 张网上的图片没取到，照原链接写着', { m: c.missedImages }) : '') +
          (c.missingAttachments ? tr('；{m} 个附件的文件没取到，只写了记录', { m: c.missingAttachments }) : ''),
      });
    } catch (e) {
      toast({ tone: 'error', message: tr('没能导出：{msg}', { msg: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('导出')}</div>
          <div className="setting-hint">{tr('所有任务、日记、附件、资料库和人物存成 Markdown 文件夹（zip），Obsidian 能直接打开')}</div>
        </div>
        <Button variant="secondary" isDisabled={!!busy} onPress={() => void doExport()}>
          {busy === 'images' ? tr('正在取图片…') : busy === 'attachments' ? tr('正在取附件…') : busy ? tr('正在打包…') : tr('导出…')}
        </Button>
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('导入')}</div>
          <div className="setting-hint">{tr('念头团导出的 zip，或任何 Markdown 文件夹；导入前先看一眼会改什么')}</div>
        </div>
        <Button variant="secondary" onPress={() => setImporting(true)}>
          {tr('导入…')}
        </Button>
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">{tr('从滴答清单导入')}</div>
          <div className="setting-hint">{tr('连接滴答清单（TickTick）账户，或用它的备份文件；清单变成项目，再导一次不会重复')}</div>
        </div>
        <Button variant="secondary" onPress={() => (isSettingsWindow() && isTauri() ? void importDidaInMain() : setDidaImportOpen(true))}>
          {tr('从滴答清单导入…')}
        </Button>
      </div>
      {importing && (
        <Suspense fallback={null}>
          <ArchiveImportSheet isOpen={importing} onOpenChange={setImporting} />
        </Suspense>
      )}
    </>
  );
}

/**
 * 关于（2026-10-26 从数据页底部挪成单独一项）：app 自己的标识（名字随语言：念头团 / Mindough）和版本号在前；
 * TMDB 的署名按它的要求放（认可的 logo、比我们的标识不显眼、原文声明、链接到 themoviedb.org）。
 */
function AboutSection() {
  const version = versionLabel();
  return (
    <section className="about" aria-label={tr('关于')}>
      <img src="/icons/icon-192.png" alt="" className="about-icon" width={36} height={36} />
      <div className="about-name">{appName()}</div>
      {version && <div className="about-version">{tr('版本 {version}', { version })}</div>}
      <p className="muted small">{tr('数据先存在这台设备上，离线也能用')}</p>
      <div className="about-credits">
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="about-tmdb" aria-label="TMDB">
          <img src={tmdbLogo} alt="TMDB" height={10} />
        </a>
        <p className="about-credit-text">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        {getLocale() === 'zh' && <p className="about-credit-text">{tr('本产品使用 TMDB 的 API，但没有得到 TMDB 的认可或认证。')}</p>}
        <p className="about-credit-text">
          <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">
            {tr('游戏资料来自 IGDB.com')}
          </a>
        </p>
      </div>
    </section>
  );
}

/** 登录 / 账户与同步状态。不登录也能完整离线使用；登录后改动在各设备间自动同步。 */
function AccountSection() {
  const [acc, refresh] = useAccount();
  const sync = useSyncView();
  const { toast } = useUi();
  const storage = useCloudStorage();
  const native = isTauri();
  const login = () => {
    if (native) void startNativeLogin().catch(() => toast({ message: tr('没能打开浏览器，请再试一次。'), tone: 'error' }));
    else window.location.href = loginUrl();
  };
  return (
    <div className="card settings-card">
        <div className="setting account-row">
          {acc.status === 'in' ? (
            <>
              {acc.user.picture ? <img className="account-avatar" src={acc.user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="account-avatar" />}
              <div className="setting-text">
                <div className="setting-name">{acc.user.name}</div>
                <div className="setting-hint">{acc.user.email}</div>
              </div>
              <Button
                variant="secondary"
                onPress={async () => {
                  await logout();
                  refresh();
                  toast({ message: tr('已退出登录。这台设备上的数据都还在，只是不再同步。') });
                }}
              >
                <LogOut size={15} />
                {tr('退出登录')}</Button>
            </>
          ) : (
            <>
              <div className="setting-text">
                <div className="setting-name">{acc.status === 'loading' ? tr('正在查看登录状态…') : tr('未登录')}</div>
                <div className="setting-hint">
                  {acc.status === 'offline'
                    ? tr('现在离线，联网后可以登录。')
                    : acc.status === 'unavailable'
                      ? tr('暂时不能登录：{reason}。', { reason: acc.reason })
                      : native
                        ? tr('登录后，改动会在你的设备间自动同步。会在浏览器里打开 Google 登录，登好后自动回到这里。')
                        : tr('登录后，改动会在你的设备间自动同步。')}{' '}
                  {tr('不登录也能完整使用，数据都存在这台设备上。')}
                </div>
              </div>
              <Button variant="primary" isDisabled={acc.status !== 'out'} onPress={login}>
                <LogIn size={15} />
                {tr('用 Google 登录')}</Button>
            </>
          )}
        </div>
        {acc.status === 'in' && sync.enabled && <SyncRow sync={sync} onLogin={login} />}
        <DataFlowRow signedIn={acc.status === 'in'} storage={storage} />
    </div>
  );
}

/**
 * 数据怎么走（Rei 2026-10-17「写清楚数据流向，先经过 worker 认证是你自己，再存到 turso 中，也可以选择存在 D1 中」；
 * 2026-10-26「这个数据流不对吧，其他设备不也要通过worker么？」）：一句说明 + 流向示意。
 * Worker 在中间：这台设备 ⇄ Worker ⇄ 云端库，其他设备 ⇄ Worker（推送、拉取都走 /api/sync，所以箭头是双向的）。
 * 宽时排成 T 字（上一排三格，其他设备在 Worker 下面）；窄时两列竖排，箭头转 90°（styles/app.css 按容器宽度切）。
 * 云端库是哪个由服务器的 STORAGE_BACKEND 决定，这里只读显示。
 */
function DataFlowRow({ signedIn, storage }: { signedIn: boolean; storage: CloudStorage | null }) {
  const name = cloudStorageName(storage);
  const steps = [
    { id: 'device', icon: <Laptop size={16} />, name: tr('这台设备'), hint: tr('先存在这里') },
    { id: 'worker', icon: <ShieldCheck size={16} />, name: 'Worker', hint: tr('核对是你本人，转发改动') },
    { id: 'cloud', icon: <Database size={16} />, name, hint: tr('保存一份') },
    { id: 'other', icon: <MonitorSmartphone size={16} />, name: tr('其他设备'), hint: tr('也经 Worker 同步') },
  ];
  return (
    <div className="setting data-flow-row">
      <div className="setting-text">
        <div className="setting-name">{signedIn ? tr('数据存在：这台设备 + {storage}', { storage: name }) : tr('登录后数据怎么走')}</div>
        <div className="setting-hint">
          {signedIn
            ? tr('改动先存在这台设备上。Worker（app.mindough.rei8t.dev）核对是你本人以后，把改动存进 {storage}；你的其他设备也经 Worker 同步。图片存在 Cloudflare R2。', { storage: name })
            : tr('改动先存在这台设备上。用 Google 登录后，Worker（app.mindough.rei8t.dev）核对是你本人，把改动存进 {storage}；你的其他设备也经 Worker 同步。图片存在 Cloudflare R2。', { storage: name })}
        </div>
        <div className="data-flow-box">
          <div className="data-flow" role="group" aria-label={tr('数据流向')}>
            {steps.map((s) => (
              <div key={s.id} className={`data-flow-step is-${s.id}`}>
                <span className="data-flow-icon" aria-hidden>
                  {s.icon}
                </span>
                <span className="data-flow-text">
                  <span className="data-flow-name">{s.name}</span>
                  <span className="data-flow-hint">{s.hint}</span>
                </span>
              </div>
            ))}
            {(['a1', 'a2', 'a3'] as const).map((a) => (
              <span key={a} className={`data-flow-arrow is-${a}`} aria-hidden>
                <ArrowLeftRight size={14} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 同步状态一行：已同步 · 刚刚 / 正在同步… / 离线，联网后自动同步 / 同步出错 + 重试。 */
function SyncRow({ sync, onLogin }: { sync: Extract<SyncView, { enabled: true }>; onLogin: () => void }) {
  const now = useNow(30_000);
  const busy = sync.phase === 'syncing';
  const ago = syncedAgo(sync.lastSyncedAt, now);
  let icon = <CloudCheck size={18} />;
  let title = ago ? tr('已同步 · {ago}', { ago }) : tr('已同步');
  let hint = tr('改动会自动同步到你的其他设备。');
  if (busy) {
    icon = <RefreshCw size={18} className="spin" />;
    title = tr('正在同步…');
    hint = ago ? tr('上次同步 · {ago}', { ago }) : tr('第一次同步，会把这台设备上的数据和账户里的合在一起。');
  } else if (sync.phase === 'offline') {
    icon = <CloudOff size={18} />;
    title = tr('离线，联网后自动同步');
    hint = ago ? tr('上次同步 · {ago}。离线时的改动都存在这台设备上。', { ago }) : tr('离线时的改动都存在这台设备上。');
  } else if (sync.phase === 'error') {
    icon = <AlertCircle size={18} />;
    title = tr('同步出错');
    const err = (sync.error ?? '').replace(/[。.]$/, '');
    const retry = sync.needsLogin ? '' : tr('改动都还在这台设备上，稍后会自动再试。');
    hint = err ? tr('{error}。{retry}', { error: err, retry }).trim() : retry;
  }
  return (
    <div className={`setting sync-row sync-${sync.phase}`} aria-live="polite">
      <span className="sync-icon" aria-hidden>
        {icon}
      </span>
      <div className="setting-text">
        <div className="setting-name">{title}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      {sync.phase === 'error' && sync.needsLogin ? (
        <Button variant="primary" onPress={onLogin}>
          <LogIn size={15} />
          {tr('重新登录')}</Button>
      ) : (
        <Button variant={sync.phase === 'error' ? 'primary' : 'secondary'} isDisabled={busy} onPress={() => void syncNow()}>
          <RefreshCw size={15} />
          {sync.phase === 'error' ? tr('重试') : tr('立即同步')}
        </Button>
      )}
    </div>
  );
}

/** 提醒时间的选项：18:00–23:30 每半小时（现在的值不在里面也列上）。 */
function journalTimeOptions(cur: string) {
  const list: string[] = [];
  for (let h = 18; h < 24; h++) for (const m of ['00', '30']) list.push(`${String(h).padStart(2, '0')}:${m}`);
  if (!list.includes(cur)) list.push(cur);
  return list.sort().map((t) => ({ id: t, label: formatRemindTime(t) }));
}

/**
 * 日记（Rei 2026-10-17）：「一天从几点开始」（默认 5 点，只用于日记）、每天提醒写日记（默认开、21:00，写没写都响）。
 * 都是跟着账户同步的偏好；提醒还要这台设备的「提醒通知」开着。
 */
function JournalSection() {
  const store = useStore();
  const dayStart = store.journalDayStart();
  const remind = store.pref(JOURNAL_PREFS.remind) !== false;
  const time = normalizeRemindTime(String(store.pref(JOURNAL_PREFS.remindTime) ?? '')) ?? JOURNAL_REMIND_TIME_DEFAULT;
  const [deviceOn, setDeviceOn] = useState(remindersEnabled);
  useEffect(() => onReminderSettings(() => setDeviceOn(remindersEnabled())), []);
  const hourLabel = (h: number) => formatRemindTime(`${String(h).padStart(2, '0')}:00`);
  return (
    <div className="card settings-card">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('一天从几点开始')}</div>
            <div className="setting-hint">{tr('还没到这个点，「今天的日记」还是前一天那篇（比如凌晨 3 点写的算昨天）。只用于日记。')}</div>
          </div>
          <Select
            label={tr('一天从几点开始')}
            className="setting-select"
            value={String(dayStart)}
            onChange={(v) => store.setPref(JOURNAL_PREFS.dayStart, Number(v))}
            options={Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: hourLabel(h) }))}
          />
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('每天提醒写日记')}</div>
            <div className="setting-hint">
              {!remind
                ? tr('关着：不提醒写日记。')
                : deviceOn
                  ? tr('每天 {time} 提醒，写没写都会响。', { time: formatRemindTime(time) })
                  : tr('这台设备的「提醒通知」关着，开了才会响。')}
            </div>
          </div>
          <div className="setting-actions">
            {remind && (
              <Select label={tr('提醒时间')} className="setting-select" value={time} onChange={(v) => store.setPref(JOURNAL_PREFS.remindTime, v)} options={journalTimeOptions(time)} />
            )}
            <Switch label={tr('每天提醒写日记')} isSelected={remind} onChange={(v) => store.setPref(JOURNAL_PREFS.remind, v)} />
          </div>
        </div>
    </div>
  );
}

/** 提醒：总开关（这台设备）+ 通知权限。权限没给时到点只在 app 里提示。 */
function ReminderSection() {
  const [on, setOn] = useState(remindersEnabled);
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  useEffect(() => {
    const refresh = () => {
      setOn(remindersEnabled());
      void notifyPermission().then(setPerm);
    };
    refresh();
    window.addEventListener('focus', refresh);
    const off = onReminderSettings(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      off();
    };
  }, []);
  const toggle = async (v: boolean) => {
    setRemindersEnabled(v);
    // 第一次打开时顺便问通知权限（浏览器只允许在点击里问）
    if (v && perm === 'default') setPerm(await requestNotifyPermission());
  };
  const web = !isTauri();
  const hint = !on
    ? tr('关着：到点不提醒。只影响这台设备。')
    : perm === 'granted'
      ? web
        ? tr('到点发系统通知；念头团开着（标签页可以在后台）才会提醒。')
        : tr('到点发系统通知。')
      : perm === 'denied'
        ? web
          ? tr('通知被浏览器关掉了：到点只在念头团里提示。要系统通知，到浏览器的网站设置里允许通知。')
          : tr('通知被系统关掉了：到点只在念头团里提示。要系统通知，到系统设置里允许念头团发通知。')
        : perm === 'unsupported'
          ? tr('这里发不了系统通知：到点只在念头团里提示。')
          : tr('还没允许通知：到点只在念头团里提示。');
  return (
    <div className="card settings-card">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('提醒通知')}</div>
            <div className="setting-hint">{hint}</div>
          </div>
          <div className="setting-actions">
            {on && perm === 'default' && (
              <Button variant="secondary" onPress={async () => setPerm(await requestNotifyPermission())}>
                {tr('允许通知')}
              </Button>
            )}
            <Switch label={tr('提醒通知')} isSelected={on} onChange={(v) => void toggle(v)} />
          </div>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('什么时候提醒')}</div>
            <div className="setting-hint">{tr('在任务上设「提醒」时间：有日期的那天、倒数日的目标日、定期打卡的每个要打卡的日子。计时有目标时长的，到点总会提醒。')}</div>
          </div>
        </div>
    </div>
  );
}
