/**
 * 服务器地址，全项目只在这里写（Rei 2026-10-26「那就把app搬到 app.mindough.rei8t.dev，mindough.rei8t.dev留给介绍页」）。
 * - SERVER_ORIGIN：网页版 app 和 API。原生端（Tauri 桌面、Android、iOS）默认连这里。
 * - LEGACY_ORIGIN：旧地址，现在根路径是介绍页；/api 还能用，以前存进正文的图片地址（…/api/assets/…）也还在这个域名下。
 * Worker 那边的同一份常量在 apps/server/src/hosts.ts；Tauri 的 CSP（src-tauri/tauri.conf.json）也列了这两个地址。
 */
export const SERVER_ORIGIN = 'https://app.mindough.rei8t.dev';
export const LEGACY_ORIGIN = 'https://mindough.rei8t.dev';

/** 是不是 Mindough 自己的服务器（新旧两个地址）。 */
export const isOwnOrigin = (origin: string) => origin === SERVER_ORIGIN || origin === LEGACY_ORIGIN;
