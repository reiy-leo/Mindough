import { lazy, Suspense, useEffect, useState } from 'react';
import { AlertCircle, CloudCheck, CloudOff, Database, Laptop, LogIn, LogOut, MonitorSmartphone, RefreshCw, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { loginUrl, logout, useAccount } from '../lib/account';
import { syncNow, useSyncView, type SyncView } from '../lib/sync';
import { cloudStorageName, useCloudStorage, type CloudStorage } from '../lib/cloud';
import { startNativeLogin } from '../lib/native-login';
import { isTauri } from '../store/sqlite-tauri';
import { useUi } from '../lib/ui';
import { resetSyncState, syncedAgo } from '@mindough/core';
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

import { getLocale, tr, trc } from '../lib/i18n';
import tmdbLogo from '../assets/tmdb-logo.svg';
import { useLocalePref } from '../lib/locale';
import { exportToZip } from '../lib/archive';

const ArchiveImportSheet = lazy(() => import('../components/ArchiveImport').then((m) => ({ default: m.ArchiveImportSheet })));
import type { LocalePref } from '../lib/i18n';

export function SettingsPage() {
  const { settings, set, platform, skin } = useSettings();
  const store = useStore();
  const sync = useSyncView();
  const [localePref, setLocalePref] = useLocalePref();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    store.adapter.pendingOutbox(100000).then((o) => setPending(o.length));
  }, [store, store.version]);

  return (
    <div className="page">
      <PageHeader title={tr('设置')} icon={<SettingsIcon size={22} />} />
      <AccountSection />
      <ReminderSection />
      <JournalSection />
      <LunarSection />
      <TypesSection />
      <Section title={tr('外观')}>
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
              <div className="setting-hint">{tr('跟随系统时，系统是中文就用中文，其他语言用英文；会同步到你的其他设备')}</div>
            </div>
            <Segmented<LocalePref>
              label={tr('语言')}
              value={localePref}
              onChange={setLocalePref}
              options={[
                { id: 'system', label: tr('跟随系统') },
                { id: 'zh', label: '中文' }, // i18n-ignore 语言名用它自己的写法
                { id: 'en', label: 'English' },
              ]}
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
      </Section>
      <Section title={tr('数据')}>
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
                location.reload();
              }}
            >
              {tr('重置')}</Button>
          </div>
        </div>
      </Section>
      <AboutSection />
    </div>
  );
}

/** 类型：影视、书籍…与自定义类型。打开类型编辑器（和资料库页标签条末尾的「编辑」是同一个）。 */
function TypesSection() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const types = store.editableTypes();
  const archived = store.archivedTypes().length;
  return (
    <Section title={trc('类型编辑器', '类型')}>
      <div className="card settings-card">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('任务类型')}</div>
            <div className="setting-hint">
              {archived ? tr('{n} 种，另有 {h} 种已归档。改字段、图标、版式，或新建自己的类型。', { n: types.length, h: archived }) : tr('{n} 种。改字段、图标、版式，或新建自己的类型。', { n: types.length })}
            </div>
          </div>
          <Button variant="secondary" onPress={() => setOpen(true)}>
            {tr('编辑类型')}</Button>
        </div>
      </div>
      <TypeManager isOpen={open} onOpenChange={setOpen} />
    </Section>
  );
}

/** 导出 / 导入 Markdown 文件夹（格式见 docs/EXPORT.md）。 */
function ArchiveRows() {
  const store = useStore();
  const { toast } = useUi();
  const [busy, setBusy] = useState<null | 'images' | 'attachments' | 'zip'>(null);
  const [importing, setImporting] = useState(false);
  const doExport = async () => {
    setBusy('zip');
    try {
      const c = await exportToZip(store, setBusy);
      toast({
        tone: 'success',
        message:
          (c.journal ? tr('已导出 {n} 件任务、{j} 篇日记', { n: c.tasks, j: c.journal }) : tr('已导出 {n} 件任务', { n: c.tasks })) +
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
          <div className="setting-hint">{tr('Mindough 导出的 zip，或任何 Markdown 文件夹；导入前先看一眼会改什么')}</div>
        </div>
        <Button variant="secondary" onPress={() => setImporting(true)}>
          {tr('导入…')}
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
 * 关于：Mindough 自己的标识在前；TMDB 的署名按它的要求放（认可的 logo、比我们的标识不显眼、原文声明、链接到 themoviedb.org）。
 */
function AboutSection() {
  return (
    <section className="about" aria-label={tr('关于')}>
      <img src="/favicon.svg" alt="" className="about-icon" width={36} height={36} />
      <div className="about-name">Mindough</div>
      <p className="muted small">{tr('数据先存在这台设备上，离线也能用')}</p>
      <div className="about-credits">
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="about-tmdb" aria-label="TMDB">
          <img src={tmdbLogo} alt="TMDB" height={10} />
        </a>
        <p className="about-credit-text">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        {getLocale() === 'zh' && <p className="about-credit-text">{tr('本产品使用 TMDB 的 API，但没有得到 TMDB 的认可或认证。')}</p>}
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
    <Section title={tr('账户')}>
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
    </Section>
  );
}

/**
 * 数据怎么走（Rei 2026-10-17「写清楚数据流向，先经过 worker 认证是你自己，再存到 turso 中，也可以选择存在 D1 中」）：
 * 一句说明 + 流向示意（这台设备 → Worker 核对 → 云端库 → 其他设备）。云端库是哪个由服务器的 STORAGE_BACKEND 决定，这里只读显示。
 */
function DataFlowRow({ signedIn, storage }: { signedIn: boolean; storage: CloudStorage | null }) {
  const name = cloudStorageName(storage);
  const steps = [
    { icon: <Laptop size={16} />, name: tr('这台设备'), hint: tr('先存在这里') },
    { icon: <ShieldCheck size={16} />, name: 'Worker', hint: tr('核对是你本人') },
    { icon: <Database size={16} />, name, hint: storage ? tr('云端数据库') : '' },
    { icon: <MonitorSmartphone size={16} />, name: tr('其他设备'), hint: tr('从这里同步') },
  ];
  return (
    <div className="setting data-flow-row">
      <div className="setting-text">
        <div className="setting-name">{signedIn ? tr('数据存在：这台设备 + {storage}', { storage: name }) : tr('登录后数据怎么走')}</div>
        <div className="setting-hint">
          {signedIn
            ? tr('改动先存在这台设备上，再由 Worker（mindough.rei8t.dev）核对是你本人后存进 {storage}，你的其他设备从那里同步下来。图片存在 Cloudflare R2。', { storage: name })
            : tr('改动先存在这台设备上。用 Google 登录后，Worker（mindough.rei8t.dev）先核对是你本人，再存进 {storage}，你的其他设备从那里同步下来。图片存在 Cloudflare R2。', { storage: name })}
        </div>
        <ol className="data-flow" aria-label={tr('数据流向')}>
          {steps.map((s, i) => (
            <li key={i} className="data-flow-step">
              <span className="data-flow-icon" aria-hidden>
                {s.icon}
              </span>
              <span className="data-flow-text">
                <span className="data-flow-name">{s.name}</span>
                {s.hint && <span className="data-flow-hint">{s.hint}</span>}
              </span>
            </li>
          ))}
        </ol>
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
    <Section title={tr('日记')}>
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
    </Section>
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
        ? tr('到点发系统通知；Mindough 开着（标签页可以在后台）才会提醒。')
        : tr('到点发系统通知。')
      : perm === 'denied'
        ? web
          ? tr('通知被浏览器关掉了：到点只在 Mindough 里提示。要系统通知，到浏览器的网站设置里允许通知。')
          : tr('通知被系统关掉了：到点只在 Mindough 里提示。要系统通知，到系统设置里允许 Mindough 发通知。')
        : perm === 'unsupported'
          ? tr('这里发不了系统通知：到点只在 Mindough 里提示。')
          : tr('还没允许通知：到点只在 Mindough 里提示。');
  return (
    <Section title={tr('提醒')}>
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
    </Section>
  );
}
