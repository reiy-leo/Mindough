import { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { Button, Section, Segmented } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { useSettings, type Settings } from '../lib/settings';
import { PLATFORM_LABEL, SKIN_LABEL, skinForPlatform } from '../skin/platform';
import { useStore } from '../store/StoreProvider';

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
      <Section title="数据">
        <div className="card settings-card">
          <div className="setting">
            <div className="setting-text">
              <div className="setting-name">本地存储</div>
              <div className="setting-hint">
                {store.adapter.kind === 'localStorage' ? '浏览器 localStorage（M0；以后换 SQLite WASM / Turso）' : store.adapter.kind} · 设备 {store.deviceId}
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
                localStorage.removeItem('mindough:v1:meta');
                location.reload();
              }}
            >
              重置
            </Button>
          </div>
        </div>
      </Section>
      <p className="muted small about">Mindough M0 · 本地优先，界面永不等待网络</p>
    </div>
  );
}
