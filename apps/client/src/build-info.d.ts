/** vite.config.ts 的 define 注入：app 版本号（tauri.conf.json）和构建时的 git 短哈希（可能是空串）。 */
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
