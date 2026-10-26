/**
 * 窗口材质（Rei 2026-10-26「mindough app的背景，侧边栏背景不像是原生app的bg sensitive的」）：
 * 桌面 app 的窗口透出桌面壁纸的颜色——macOS 侧边栏毛玻璃（NSVisualEffectView Sidebar），Windows 11 Mica。
 *
 * 原生端（src-tauri/src/vibrancy.rs）的 `window_material` 说这台机器能用哪种材质，顺便把窗口深浅色设成界面用的那套。
 * 拿到 vibrancy / mica 才给 html 加 `is-vibrant`（样式在 styles/vibrancy.css）；网页版、Win10、Linux 都是 none，照旧纯色。
 */
import type { WindowOptions } from '@tauri-apps/api/window';
import { isTauri } from '../store/sqlite-tauri';

export type WindowMaterial = 'vibrancy' | 'mica' | 'none';
export const VIBRANT_CLASS = 'is-vibrant';

let known: WindowMaterial | null = null;

const asMaterial = (v: unknown): WindowMaterial => (v === 'vibrancy' || v === 'mica' ? v : 'none');

/** 问原生端这个窗口的材质；theme 给 light / dark 时窗口跟着换，null = 跟着系统。网页版直接 none。 */
export async function syncWindowMaterial(theme: 'light' | 'dark' | null): Promise<WindowMaterial> {
  if (!isTauri()) return 'none';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    known = asMaterial(await invoke('window_material', { theme }));
  } catch {
    // 老的原生外壳没有这条命令：当作没有材质
    known = 'none';
  }
  return known;
}

/** html 上的 class 和 data-material。 */
export function applyMaterialClass(el: HTMLElement, m: WindowMaterial): void {
  el.classList.toggle(VIBRANT_CLASS, m !== 'none');
  if (m === 'none') delete el.dataset.material;
  else el.dataset.material = m;
}

/**
 * 前端开新窗口（小窗、设置窗口）时带上的选项：和主窗口一样透明 + 同一种材质。
 * 主窗口启动时已经问过（SettingsProvider）；没问过或没有材质就什么都不带，窗口照旧不透明。
 */
export async function materialWindowOptions(): Promise<Pick<WindowOptions, 'transparent' | 'windowEffects'>> {
  const m = known ?? 'none';
  if (m === 'none') return {};
  const { Effect, EffectState } = await import('@tauri-apps/api/window');
  return m === 'vibrancy'
    ? { transparent: true, windowEffects: { effects: [Effect.Sidebar], state: EffectState.FollowsWindowActiveState } }
    : { transparent: true, windowEffects: { effects: [Effect.Mica] } };
}
