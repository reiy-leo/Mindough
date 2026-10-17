
import { tr } from '../lib/i18n';/**
 * 平台检测与皮肤选择。Web 端按 userAgent 推断；Tauri 端以后改用 @tauri-apps/plugin-os 的 platform()。
 */
export type Platform = 'macos' | 'ios' | 'windows' | 'android' | 'linux' | 'unknown';
export type Skin = 'apple' | 'winui' | 'material';
export type SkinPref = Skin | 'auto';
export type ThemePref = 'system' | 'light' | 'dark';
export type LayoutKind = 'desktop' | 'mobile';

export const SKIN_LABEL: Record<Skin, string> = {
  get apple() { return tr('Apple（macOS / iOS）'); },
  get winui() { return tr('Windows 11（WinUI 3）'); },
  get material() { return tr('Material 3（Android）'); },
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  macos: 'macOS',
  ios: 'iOS / iPadOS',
  windows: 'Windows',
  android: 'Android',
  linux: 'Linux',
  get unknown() { return tr('未知系统'); },
};

export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string } | undefined;
}

export function detectPlatform(nav: NavigatorLike): Platform {
  const ua = nav.userAgent || '';
  const hint = (nav.userAgentData?.platform || nav.platform || '').toLowerCase();
  if (/android/i.test(ua) || hint === 'android') return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS 13+ 桌面模式 UA 与 macOS 相同，用触点区分
  if (/macintosh|mac os x/i.test(ua) || hint.startsWith('mac')) return (nav.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos';
  if (/windows/i.test(ua) || hint.startsWith('win')) return 'windows';
  if (/linux|cros|x11/i.test(ua) || hint.includes('linux') || hint === 'chrome os') return 'linux';
  return 'unknown';
}

/** macOS / iOS → Apple；Windows → WinUI；Android 与其他 → Material。 */
export function skinForPlatform(p: Platform): Skin {
  if (p === 'macos' || p === 'ios') return 'apple';
  if (p === 'windows') return 'winui';
  return 'material';
}

export function resolveSkin(pref: SkinPref, platform: Platform): Skin {
  return pref === 'auto' ? skinForPlatform(platform) : pref;
}

/** 窄于 760px 用手机布局（底部标签栏）。 */
export const MOBILE_MAX_WIDTH = 760;

export function layoutForWidth(width: number): LayoutKind {
  return width <= MOBILE_MAX_WIDTH ? 'mobile' : 'desktop';
}

/**
 * macOS 桌面端主窗口不要系统标题栏（Rei 2026-10-17：「macOS的边栏框要贯通，titlebar不展示」）：
 * 窗口用 titleBarStyle Overlay + hiddenTitle（src-tauri/tauri.macos.conf.json），红绿灯浮在侧边栏左上角。
 * 只在 Tauri + macOS 的主窗口打开；小窗保留系统标题栏，网页版和其他平台不变。
 */
export const MAC_OVERLAY_CLASS = 'platform-macos-overlay';

export function usesMacOverlayTitlebar(platform: Platform, opts: { tauri: boolean; mini: boolean }): boolean {
  return platform === 'macos' && opts.tauri && !opts.mini;
}
