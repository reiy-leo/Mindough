/**
 * 设置 →「农历」（Rei 2026-10-17）：显示农历开关；农历订阅——源地址（可复制、可改、可恢复默认）、同步频率、上次同步时间、立即同步、状态（失败附 HTTP 状态码中文）。
 * 地址和频率跟着账户同步；同步状态和数据只在这台设备。
 */
import { useEffect, useState } from 'react';
import { Copy, RefreshCw, RotateCcw } from 'lucide-react';
import { DEFAULT_LUNAR_SUB_URL, LUNAR_PREFS, SUB_FREQS, normalizeSubUrl, subFreqLabel, subStatusText, syncedAgo, type SubFreq } from '@mindough/core';
import { Button, Section, Segmented, Switch } from '../ui/primitives';
import { lunarPrefs, syncLunarSub, useLunarSub } from '../lib/lunar';
import { useUi } from '../lib/ui';
import { useNow, useStore } from '../store/StoreProvider';
import { tr } from '../lib/i18n';

export function LunarSection() {
  const store = useStore();
  const { toast } = useUi();
  const prefs = lunarPrefs(store);
  const { state, syncing } = useLunarSub();
  const now = useNow(30_000);
  const [draft, setDraft] = useState(prefs.url);
  useEffect(() => setDraft(prefs.url), [prefs.url]);
  const ours = state?.url === prefs.url ? state : null;
  const invalid = draft.trim() !== '' && !normalizeSubUrl(draft);

  const saveUrl = (raw: string) => {
    const url = raw.trim() ? normalizeSubUrl(raw) : DEFAULT_LUNAR_SUB_URL;
    if (!url) return;
    setDraft(url);
    if (url === prefs.url) return;
    store.setPref(LUNAR_PREFS.subUrl, url === DEFAULT_LUNAR_SUB_URL ? '' : url);
    void syncLunarSub(url, { fresh: true });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prefs.url);
      toast({ message: tr('已复制订阅地址') });
    } catch {
      toast({ tone: 'error', message: tr('没能复制，手动选中地址复制吧') });
    }
  };

  const ago = ours?.okAt ? syncedAgo(ours.okAt, now) : '';
  const status = ours?.status ?? null;
  const freqHint =
    prefs.freq === 'manual'
      ? tr('手动：只在点「立即同步」时更新。')
      : tr('{freq}自动更新一次；拉到的存在这台设备上，离线也能看。', { freq: subFreqLabel(prefs.freq) });

  return (
    <Section title={tr('农历')}>
      <div className="card settings-card">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('显示农历')}</div>
            <div className="setting-hint">{tr('日期格子下显示农历、节气和节日，选日期时可以按农历选。默认：界面是中文时打开。')}</div>
          </div>
          <Switch label={tr('显示农历')} isSelected={prefs.show} onChange={(v) => store.setPref(LUNAR_PREFS.show, v)} />
        </div>
        <div className="setting is-stacked">
          <div className="setting-text">
            <div className="setting-name">{tr('农历订阅')}</div>
            <div className="setting-hint">
              {prefs.custom ? tr('用的是你填的日历地址。') : tr('默认订阅 Apple 的「中国大陆节假日」日历：节气、传统节日、法定假日的放假和调休上班。')}
              {tr('只用来显示，不会变成任务。')}
            </div>
          </div>
          <div className="lunar-url-row">
            <input
              className="input"
              aria-label={tr('订阅地址')}
              value={draft}
              spellCheck={false}
              aria-invalid={invalid || undefined}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => !invalid && saveUrl(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!invalid) saveUrl(draft);
                }
                if (e.key === 'Escape') setDraft(prefs.url);
              }}
            />
            <Button variant="secondary" onPress={() => void copy()}>
              <Copy size={14} /> {tr('复制')}
            </Button>
            {prefs.custom && (
              <Button variant="secondary" onPress={() => saveUrl('')}>
                <RotateCcw size={14} /> {tr('恢复默认')}
              </Button>
            )}
          </div>
          {invalid && <div className="setting-hint lunar-status is-error">{tr('地址不对：要 http:// 或 https:// 开头的日历地址（webcal:// 也行）')}</div>}
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{tr('同步频率')}</div>
            <div className="setting-hint">{freqHint}</div>
          </div>
          <Segmented<SubFreq> label={tr('同步频率')} value={prefs.freq} onChange={(v) => store.setPref(LUNAR_PREFS.subFreq, v)} options={SUB_FREQS.map((f) => ({ id: f, label: subFreqLabel(f) }))} />
        </div>
        <div className="setting" aria-live="polite">
          <div className="setting-text">
            <div className="setting-name">{syncing ? tr('正在同步…') : ago ? tr('上次同步 · {ago}', { ago }) : tr('还没同步过')}</div>
            <div className={`setting-hint lunar-status${status ? (status.ok ? ' is-ok' : ' is-error') : ''}`}>
              {subStatusText(status)}
              {status && !status.ok && ago ? tr('（先用着上次拉到的）') : ''}
            </div>
          </div>
          <Button variant="secondary" isDisabled={syncing} onPress={() => void syncLunarSub(prefs.url, { fresh: true })}>
            <RefreshCw size={15} className={syncing ? 'spin' : undefined} />
            {tr('立即同步')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
