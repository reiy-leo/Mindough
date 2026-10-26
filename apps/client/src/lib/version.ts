/**
 * 设置 → 关于里的版本号：「0.1.0 (60eeba0)」。版本号来自 tauri.conf.json，短哈希来自构建时的 git；
 * 两个都由 vite.config.ts 的 define 注入，没有就留空。
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
export const GIT_SHA: string = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : '';

export function versionLabel(version = APP_VERSION, sha = GIT_SHA): string {
  if (!version) return sha;
  return sha ? `${version} (${sha})` : version;
}
