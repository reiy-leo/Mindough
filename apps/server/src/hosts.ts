/**
 * 两个域名（Rei 2026-10-26「那就把app搬到 app.mindough.rei8t.dev，mindough.rei8t.dev留给介绍页」）：
 * - app.mindough.rei8t.dev：网页版 app 和全部 API（新的默认地址）。
 * - mindough.rei8t.dev：根路径是介绍页（landing/）；/api/*、/auth/* 照常能用，老的 alpha.5 桌面 / 安卓包和
 *   以前存进正文里的图片地址（https://mindough.rei8t.dev/api/assets/…）都还连这里，所以不跳转、不下线。
 *   其他路径（/assets/、/icons/、/local/ …）照旧出 app，/local/ 用来在旧地址打开 app 导出本机数据。
 * 客户端的同一份常量在 apps/client/src/lib/origins.ts。
 */
export const APP_HOST = 'app.mindough.rei8t.dev';
export const APP_ORIGIN = `https://${APP_HOST}`;
export const LEGACY_HOST = 'mindough.rei8t.dev';
export const LEGACY_ORIGIN = `https://${LEGACY_HOST}`;

/** 这个请求是不是打到介绍页域名上的。 */
export const isLegacyHost = (url: URL) => url.hostname === LEGACY_HOST;
