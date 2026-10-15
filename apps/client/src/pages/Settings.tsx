import { useEffect, useState } from 'react';
import { AlertCircle, CloudCheck, CloudOff, Eye, EyeOff, LogIn, LogOut, Plus, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { loginUrl, logout, useAccount } from '../lib/account';
import { syncNow, useSyncView, type SyncView } from '../lib/sync';
import { startNativeLogin } from '../lib/native-login';
import { isTauri } from '../store/sqlite-tauri';
import { useUi } from '../lib/ui';
import { resetSyncState, syncedAgo } from '@mindough/core';
import { Input, TextField } from 'react-aria-components';
import type { CheckInCategory } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { Button, Section, Segmented } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { useSettings, type Settings } from '../lib/settings';
import { PLATFORM_LABEL, SKIN_LABEL, skinForPlatform } from '../skin/platform';
import { storageInfo, useNow, useStore } from '../store/StoreProvider';

export function SettingsPage() {
  const { settings, set, platform, skin } = useSettings();
  const store = useStore();
  const sync = useSyncView();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    store.adapter.pendingOutbox(100000).then((o) => setPending(o.length));
  }, [store, store.version]);

  return (
    <div className="page">
      <PageHeader title="设置" icon={<SettingsIcon size={22} />} />
      <AccountSection />
      <Section title="外观">
        <div className="card settings-card">
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">皮肤</div>
              <div className="setting-hint">
                自动：检测到 {PLATFORM_LABEL[platform]}，使用 {SKIN_LABEL[skinForPlatform(platform)]}。当前：{SKIN_LABEL[skin]}
              </div>
            </div>
            <Segmented<Settings['skin']>
              label="皮肤"
              value={settings.skin}
              onChange={(v) => set('skin', v)}
              options={[
                { id: 'auto', label: '自动' },
                { id: 'apple', label: 'Apple' },
                { id: 'winui', label: 'Windows' },
                { id: 'material', label: 'Material' },
              ]}
            />
          </div>
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">明暗</div>
              <div className="setting-hint">默认跟随系统</div>
            </div>
            <Segmented<Settings['theme']>
              label="明暗"
              value={settings.theme}
              onChange={(v) => set('theme', v)}
              options={[
                { id: 'system', label: '跟随系统' },
                { id: 'light', label: '浅色' },
                { id: 'dark', label: '深色' },
              ]}
            />
          </div>
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">布局</div>
              <div className="setting-hint">自动：窗口变窄时改用底部标签栏</div>
            </div>
            <Segmented<Settings['layout']>
              label="布局"
              value={settings.layout}
              onChange={(v) => set('layout', v)}
              options={[
                { id: 'auto', label: '自动' },
                { id: 'desktop', label: '桌面' },
                { id: 'mobile', label: '手机' },
              ]}
            />
          </div>
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">热力图每月 1 号标记</div>
              <div className="setting-hint">自动：格子够大显示月份数字，小格子显示圆点</div>
            </div>
            <Segmented<Settings['monthMarker']>
              label="每月 1 号标记"
              value={settings.monthMarker}
              onChange={(v) => set('monthMarker', v)}
              options={[
                { id: 'auto', label: '自动' },
                { id: 'number', label: '数字' },
                { id: 'dot', label: '圆点' },
                { id: 'none', label: '不标' },
              ]}
            />
          </div>
        </div>
      </Section>
      <CheckInCategorySettings />
      <Section title="数据">
        <div className="card settings-card">
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">本地存储</div>
              <div className="setting-hint">
                {storageInfo.engine === 'sqlite'
                  ? `SQLite（${storageInfo.detail === 'tauri-rusqlite' ? '本机文件' : '浏览器本地'}）`
                  : `浏览器 localStorage${storageInfo.fallbackReason ? `（${storageInfo.fallbackReason}）` : ''}`}{' '}
                · 设备 {store.deviceId}
                {pending !== null && pending > 0 && ` · ${pending} 处改动还没同步`}
              </div>
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">重置演示数据</div>
              <div className="setting-hint">
                {sync.enabled ? '登录同步时不能重置：会影响你的其他设备。先退出登录再重置。' : '清空本机所有任务，重新生成一份演示数据'}
              </div>
            </div>
            <Button
              variant="danger"
              isDisabled={sync.enabled}
              onPress={async () => {
                if (!confirm('确定清空本机数据并重新生成演示数据？')) return;
                await store.adapter.clear();
                await store.adapter.setMeta('demo_seeded', ''); // 空值 = 未生成，刷新后重新生成
                await resetSyncState(store.adapter); // 下次登录重新合并，云端数据会回来
                location.reload();
              }}
            >
              重置
            </Button>
          </div>
        </div>
      </Section>
      <p className="muted small about">Mindough · 数据先存在这台设备上，离线也能用</p>
    </div>
  );
}

/** 打卡分类：改名（失焦保存）、隐藏 / 显示、新增。内置分类不能删，只能隐藏。 */
function CheckInCategorySettings() {
  const store = useStore();
  const [draft, setDraft] = useState('');
  const cats = store.checkInCategories(true);
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    store.createCheckInCategory(name);
    setDraft('');
  };
  return (
    <Section title="打卡分类">
      <div className="card settings-card">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-hint">给重复任务分门别类，打卡页可按分类筛选和分组。内置的 {cats.filter((c) => c.builtin).length} 个可改名、隐藏（不能删）。</div>
          </div>
        </div>
        {cats.map((c) => (
          <CategoryRow key={c.id} c={c} />
        ))}
        <div className="setting cat-row">
          <Plus size={16} className="cat-row-icon" aria-hidden />
          <TextField aria-label="新分类名称" value={draft} onChange={setDraft} className="cat-name">
            <Input className="input" placeholder="新分类名称" onKeyDown={(e) => e.key === 'Enter' && add()} />
          </TextField>
          <Button variant="secondary" onPress={add} isDisabled={!draft.trim()}>
            新增
          </Button>
        </div>
      </div>
    </Section>
  );
}

function CategoryRow({ c }: { c: CheckInCategory }) {
  const store = useStore();
  const [name, setName] = useState(c.name);
  useEffect(() => setName(c.name), [c.name]);
  const Icon = typeIcon(c.icon);
  const commit = () => {
    const n = name.trim();
    if (!n) setName(c.name);
    else if (n !== c.name) store.update('checkin_category', c.id, { name: n });
  };
  return (
    <div className={`setting cat-row${c.hidden ? ' is-hidden' : ''}`}>
      <Icon size={16} className="cat-row-icon" style={{ color: c.color }} aria-hidden />
      <TextField aria-label={`${c.name} 的名称`} value={name} onChange={setName} className="cat-name">
        <Input className="input" onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </TextField>
      {c.builtin && <span className="muted small">内置</span>}
      <Button variant="secondary" onPress={() => store.update('checkin_category', c.id, { hidden: !c.hidden })} aria-label={c.hidden ? `显示 ${c.name}` : `隐藏 ${c.name}`}>
        {c.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        {c.hidden ? '已隐藏' : '显示中'}
      </Button>
    </div>
  );
}

/** 登录 / 账户与同步状态。不登录也能完整离线使用；登录后改动在各设备间自动同步。 */
function AccountSection() {
  const [acc, refresh] = useAccount();
  const sync = useSyncView();
  const { toast } = useUi();
  const native = isTauri();
  const login = () => {
    if (native) void startNativeLogin().catch(() => toast({ message: '没能打开浏览器，请再试一次。', tone: 'error' }));
    else window.location.href = loginUrl();
  };
  return (
    <Section title="账户">
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
                  toast({ message: '已退出登录。这台设备上的数据都还在，只是不再同步。' });
                }}
              >
                <LogOut size={15} />
                退出登录
              </Button>
            </>
          ) : (
            <>
              <div className="setting-text">
                <div className="setting-name">{acc.status === 'loading' ? '正在查看登录状态…' : '未登录'}</div>
                <div className="setting-hint">
                  {acc.status === 'offline'
                    ? '现在离线，联网后可以登录。'
                    : acc.status === 'unavailable'
                      ? `暂时不能登录：${acc.reason}。`
                      : native
                        ? '登录后，改动会在你的设备间自动同步。会在浏览器里打开 Google 登录，登好后自动回到这里。'
                        : '登录后，改动会在你的设备间自动同步。'}
                  不登录也能完整使用，数据都存在这台设备上。
                </div>
              </div>
              <Button variant="primary" isDisabled={acc.status !== 'out'} onPress={login}>
                <LogIn size={15} />
                用 Google 登录
              </Button>
            </>
          )}
        </div>
        {acc.status === 'in' && sync.enabled && <SyncRow sync={sync} onLogin={login} />}
      </div>
    </Section>
  );
}

/** 同步状态一行：已同步 · 刚刚 / 正在同步… / 离线，联网后自动同步 / 同步出错 + 重试。 */
function SyncRow({ sync, onLogin }: { sync: Extract<SyncView, { enabled: true }>; onLogin: () => void }) {
  const now = useNow(30_000);
  const busy = sync.phase === 'syncing';
  const ago = syncedAgo(sync.lastSyncedAt, now);
  let icon = <CloudCheck size={18} />;
  let title = ago ? `已同步 · ${ago}` : '已同步';
  let hint = '改动会自动同步到你的其他设备。';
  if (busy) {
    icon = <RefreshCw size={18} className="spin" />;
    title = '正在同步…';
    hint = ago ? `上次同步 · ${ago}` : '第一次同步，会把这台设备上的数据和账户里的合在一起。';
  } else if (sync.phase === 'offline') {
    icon = <CloudOff size={18} />;
    title = '离线，联网后自动同步';
    hint = ago ? `上次同步 · ${ago}。离线时的改动都存在这台设备上。` : '离线时的改动都存在这台设备上。';
  } else if (sync.phase === 'error') {
    icon = <AlertCircle size={18} />;
    title = '同步出错';
    hint = `${(sync.error ?? '').replace(/[。.]$/, '')}${sync.error ? '。' : ''}${sync.needsLogin ? '' : '改动都还在这台设备上，稍后会自动再试。'}`;
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
          重新登录
        </Button>
      ) : (
        <Button variant={sync.phase === 'error' ? 'primary' : 'secondary'} isDisabled={busy} onPress={() => void syncNow()}>
          <RefreshCw size={15} />
          {sync.phase === 'error' ? '重试' : '立即同步'}
        </Button>
      )}
    </div>
  );
}
