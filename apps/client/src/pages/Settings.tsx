import { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Settings as SettingsIcon } from 'lucide-react';
import { Input, TextField } from 'react-aria-components';
import type { CheckInCategory } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { Button, Section, Segmented } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { useSettings, type Settings } from '../lib/settings';
import { PLATFORM_LABEL, SKIN_LABEL, skinForPlatform } from '../skin/platform';
import { storageInfo, useStore } from '../store/StoreProvider';

export function SettingsPage() {
  const { settings, set, platform, skin } = useSettings();
  const store = useStore();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    store.adapter.pendingOutbox(100000).then((o) => setPending(o.length));
  }, [store, store.version]);

  return (
    <div className="page">
      <PageHeader title="设置" icon={<SettingsIcon size={22} />} />
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
              <div className="setting-hint">自动：窄于 760px 用底部标签栏</div>
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
                  ? `SQLite（${storageInfo.detail === 'tauri-rusqlite' ? '本机文件' : 'Turso wasm · 浏览器 OPFS'}）`
                  : `浏览器 localStorage${storageInfo.fallbackReason ? `（${storageInfo.fallbackReason}）` : ''}`}{' '}
                · 设备 {store.deviceId}
                {pending !== null && ` · 待同步 ${pending} 条（同步尚未开通）`}
              </div>
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">重置演示数据</div>
              <div className="setting-hint">清空本机所有任务，重新生成一份演示数据</div>
            </div>
            <Button
              variant="danger"
              onPress={async () => {
                if (!confirm('确定清空本机数据并重新生成演示数据？')) return;
                await store.adapter.clear();
                await store.adapter.setMeta('demo_seeded', ''); // 空值 = 未生成，刷新后重新生成
                location.reload();
              }}
            >
              重置
            </Button>
          </div>
        </div>
      </Section>
      <p className="muted small about">Mindough M1 · 本地优先，界面永不等待网络</p>
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
        <p className="setting-hint cat-settings-hint">给重复任务分门别类，打卡页可按分类筛选和分组。内置分类可改名、隐藏。</p>
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
