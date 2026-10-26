import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DateDisplay, MonthMarker } from '@mindough/core';
import { applyMaterialClass, syncWindowMaterial } from './vibrancy';
import { detectPlatform, layoutForWidth, MAC_OVERLAY_CLASS, resolveSkin, usesMacOverlayTitlebar, type LayoutKind, type Platform, type Skin, type SkinPref, type ThemePref } from '../skin/platform';

import { tr } from './i18n';
import { isMiniWindow } from './windows';
import { onRelay, relay } from './window-relay';
import { isTauri } from '../store/sqlite-tauri';
export interface Settings {
  skin: SkinPref;
  theme: ThemePref;
  layout: 'auto' | LayoutKind;
  monthMarker: 'auto' | MonthMarker;
  /** 详情「关系」显示任务链（Rei 2026-10-23）：只记在本机，不同步；换一件任务也沿用。 */
  taskChain: boolean;
  /**
   * 中国农历（Rei 2026-10-25「日期部分，只有在设置中打开中国农历 switch 才显示」）：只记在本机，不同步，默认关。
   * 只在中文界面（简 / 繁）起作用，判断一律经 lib/lunar 的 useLunarUi()（core lunarUiVisible）。
   */
  chineseLunar: boolean;
  /**
   * 打卡页哪几张卡片展开了活动图（Rei 2026-10-25「check-ins 中的任务活动图，不要显示在列表中，而是左上角一个圆点，toggle 全宽显示活动图」）：
   * 存打卡任务的 id，只记在本机，不同步，默认都收起。读写经 lib/habit-heatmap。
   */
  habitHeatmapOpen: string[];
  /**
   * 每个项目选的视图和排序（Rei 2026-10-26「每个项目的视图支持列表、看板、时间轴」）：项目 id → 视图 / 排序 / 正倒序 / 时间轴缩放。
   * 只记在本机，不同步，不改项目的数据结构。读写经 lib/project-view 的 normalizePrefs（认不出的值、以前的关系图都回落成列表）。
   */
  projectViews: Record<string, unknown>;
  /**
   * 任务日期怎么显示（Rei 2026-10-26）：自动 / 相对时间 / 年月日 / 年月日+时区。只记在本机，不同步，默认自动（和以前一样）。
   * 读经 lib/date-display 的 useDateDisplay()，写在设置 → 任务。
   */
  dateDisplay: DateDisplay;
}

const DEFAULTS: Settings = { skin: 'auto', theme: 'system', layout: 'auto', monthMarker: 'auto', taskChain: false, chineseLunar: false, habitHeatmapOpen: [], projectViews: {}, dateDisplay: 'auto' };
const KEY = 'mindough:settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

/** URL 参数可临时覆盖（截图 / 调试用）：?skin=winui&theme=dark&dates=ymd */
function urlOverrides(): Partial<Settings> {
  const p = new URLSearchParams(location.search);
  const out: Partial<Settings> = {};
  const skin = p.get('skin');
  if (skin === 'apple' || skin === 'winui' || skin === 'material') out.skin = skin;
  const theme = p.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;
  const dates = p.get('dates');
  if (dates === 'auto' || dates === 'relative' || dates === 'ymd' || dates === 'ymd-tz') out.dateDisplay = dates;
  return out;
}

interface SettingsCtx {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  platform: Platform;
  skin: Skin;
  theme: 'light' | 'dark';
  layout: LayoutKind;
}

const Ctx = createContext<SettingsCtx | null>(null);

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Settings>(load);
  const settings = useMemo(() => ({ ...stored, ...urlOverrides() }), [stored]);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform(navigator as Navigator & { userAgentData?: { platform?: string } }));
  // Tauri 端用 os 插件拿准确的平台（iPadOS 等 UA 不可靠的情况）
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    import('@tauri-apps/plugin-os')
      .then(({ platform: p }) => {
        const v = p();
        if (v === 'macos' || v === 'ios' || v === 'windows' || v === 'android' || v === 'linux') setPlatform(v);
      })
      .catch(() => {});
  }, []);
  const prefersDark = useMedia('(prefers-color-scheme: dark)');
  const width = useWidth();
  const skin = resolveSkin(settings.skin, platform);
  const theme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme;
  const layout = settings.layout === 'auto' ? layoutForWidth(width) : settings.layout;

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    // 先落到 localStorage 再通知别的窗口（它们收到就重新读）；以 localStorage 为准，别的窗口刚改的也不丢
    const next = { ...load(), [key]: value };
    localStorage.setItem(KEY, JSON.stringify(next));
    setStored(next);
    relay('settings');
  }, []);

  // 别的窗口（Tauri）或同一浏览器的别的标签页改了本机设置：重新读
  useEffect(() => {
    const reload = () => setStored(load());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    const off = onRelay('settings', reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      off();
    };
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.skin = skin;
    el.dataset.theme = theme;
    el.dataset.layout = layout;
    el.dataset.platform = platform;
    el.style.colorScheme = theme;
  }, [skin, theme, layout, platform]);
  // macOS 桌面端主窗口：没有系统标题栏，侧边栏顶到窗口最上、给红绿灯让位（样式见 skin/skins.css）
  useEffect(() => {
    document.documentElement.classList.toggle(MAC_OVERLAY_CLASS, usesMacOverlayTitlebar(platform, { tauri: isTauri(), mini: isMiniWindow() }));
  }, [platform]);

  // 桌面 app：窗口材质（macOS 侧边栏毛玻璃 / Windows 11 Mica，lib/vibrancy.ts）。界面手动选了深浅色时窗口也跟着换
  const themeOverride = settings.theme === 'system' ? null : theme;
  useEffect(() => {
    if (!isTauri()) return;
    let dead = false;
    void syncWindowMaterial(themeOverride).then((m) => {
      if (!dead) applyMaterialClass(document.documentElement, m);
    });
    return () => {
      dead = true;
    };
  }, [themeOverride]);

  const value = useMemo(() => ({ settings, set, platform, skin, theme, layout }), [settings, set, platform, skin, theme, layout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error(tr('SettingsProvider 缺失'));
  return v;
}
