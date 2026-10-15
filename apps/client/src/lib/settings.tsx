import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MonthMarker } from '@mindough/core';
import { detectPlatform, layoutForWidth, resolveSkin, type LayoutKind, type Platform, type Skin, type SkinPref, type ThemePref } from '../skin/platform';

export interface Settings {
  skin: SkinPref;
  theme: ThemePref;
  layout: 'auto' | LayoutKind;
  monthMarker: 'auto' | MonthMarker;
}

const DEFAULTS: Settings = { skin: 'auto', theme: 'system', layout: 'auto', monthMarker: 'auto' };
const KEY = 'mindough:settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

/** URL 参数可临时覆盖（截图 / 调试用）：?skin=winui&theme=dark */
function urlOverrides(): Partial<Settings> {
  const p = new URLSearchParams(location.search);
  const out: Partial<Settings> = {};
  const skin = p.get('skin');
  if (skin === 'apple' || skin === 'winui' || skin === 'material') out.skin = skin;
  const theme = p.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;
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
    setStored((s) => {
      const next = { ...s, [key]: value };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.skin = skin;
    el.dataset.theme = theme;
    el.dataset.layout = layout;
    el.dataset.platform = platform;
    el.style.colorScheme = theme;
  }, [skin, theme, layout, platform]);

  const value = useMemo(() => ({ settings, set, platform, skin, theme, layout }), [settings, set, platform, skin, theme, layout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('SettingsProvider 缺失');
  return v;
}
