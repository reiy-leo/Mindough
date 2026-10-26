/**
 * 介绍页（mindough.rei8t.dev 根路径，Rei 2026-10-26）。一个静态单页，九种语言（文字在 text.ts）：
 * 先看 ?lang=，再看手动选过的（localStorage），再按 navigator.languages 选；右上角能切。
 * 以后要换成更完整的介绍页：只换这个文件（或让 landing/index.ts 改从 R2 / 单独的 Mindough-web 仓库出页面），
 * 但「搬家脚本」那段（跳转到 app 域名、提醒导出本机数据）要留着，老链接和装到主屏幕的旧版靠它。
 */
import { APP_ORIGIN } from '../hosts';
import { HTML_LANG, LANDING_LANGS, LANDING_TEXT, LANG_NAMES, matchLang, type LandingKey, type LandingLang } from './text';

export const RELEASES_URL = 'https://github.com/reiy-leo/Mindough/releases';

// Lucide 图标（lucide.dev，ISC 许可），内联成 SVG
const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  login: '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
  fileCode: '<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  devices: '<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
};

/** ydiyr（你的数据你负责）：Rei 的另一个站，介绍只把数据存在用户自己设备和网盘里的 app（Rei 2026-10-26）。 */
export const YDIYR_URL = 'https://your-data-is-your-responsibility.rei8t.dev';

/**
 * 自己部署的八步（Rei 2026-10-26 20:37「web介绍页，要显示自己部署的步骤图」；20:55「步骤缺少……环境变量、数据库、可以登录的账号、Google登录……
 * 这些步骤可以先collapse，用户点击再展开代码和说明」）。每步默认收起，只露标题和一句话；展开后是要点列表（text.ts 里按 \n 分行）和命令。
 * 命令各语言一样，例子域名用 todo.example.com。跟仓库里的实际做法保持一致：apps/server/README.md、wrangler.deploy.jsonc、package.json 的 deploy。
 */
const W = 'pnpm exec wrangler';
const C = '-c wrangler.deploy.jsonc';
const SELF_HOST_STEPS: [keyof typeof ICONS, Key, Key, Key, string][] = [
  ['terminal', 's1t', 's1s', 's1d', `git clone https://github.com/reiy-leo/mindough.git
cd mindough && pnpm install
cd apps/server && ${W} login`],
  ['database', 's2t', 's2s', 's2d', `# Turso (default)
turso db create mindough
turso db show mindough --url      # -> TURSO_DB_URL
turso db tokens create mindough   # -> TURSO_DB_TOKEN

# or Cloudflare D1
${W} d1 create mindough           # -> database_id`],
  ['box', 's3t', 's3s', 's3d', `${W} r2 bucket create mindough-web
${W} r2 bucket create mindough-assets`],
  ['login', 's4t', 's4s', 's4d', `Authorized JavaScript origins:  https://todo.example.com
Authorized redirect URIs:       https://todo.example.com/auth/callback`],
  ['fileCode', 's5t', 's5s', 's5d', `"name": "mindough",
"routes": [{ "pattern": "todo.example.com", "custom_domain": true }],
"r2_buckets": [
  { "binding": "WEB", "bucket_name": "mindough-web" },
  { "binding": "FILES", "bucket_name": "mindough-assets" }
],
"vars": { "STORAGE_BACKEND": "turso" },   // or "d1"
"d1_databases": [{ "binding": "DB", "database_name": "mindough", "database_id": "<D1 only>" }]`],
  ['key', 's6t', 's6s', 's6d', `openssl rand -base64 32 | ${W} secret put SESSION_SECRET ${C}
${W} secret put GOOGLE_CLIENT_ID ${C}
${W} secret put GOOGLE_CLIENT_SECRET ${C}

# Turso only
${W} secret put TURSO_DB_URL ${C}
${W} secret put TURSO_DB_TOKEN ${C}

# optional: movie & TV lookup
${W} secret put TMDB_API_KEY ${C}`],
  ['users', 's7t', 's7s', 's7d', `${W} secret put ALLOWED_EMAILS ${C}
# you@gmail.com,family@gmail.com`],
  ['rocket', 's8t', 's8s', 's8d', `pnpm run deploy
curl https://todo.example.com/api/health   # 200`],
];

export { LANDING_TEXT, LANDING_LANGS, LANG_NAMES, HTML_LANG, matchLang, type LandingLang } from './text';
type Key = LandingKey;

const FEATURES: [keyof typeof ICONS, Key, Key][] = [
  ['workflow', 'f1t', 'f1d'],
  ['timer', 'f2t', 'f2d'],
  ['library', 'f3t', 'f3d'],
  ['book', 'f4t', 'f4d'],
  ['sync', 'f5t', 'f5d'],
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 介绍页 HTML。lang 是服务端按 Accept-Language 先猜的语言，页面里的脚本再按 navigator.languages 校正。 */
export function landingHtml(lang: LandingLang = 'zh'): string {
  const t = LANDING_TEXT[lang];
  const tx = (k: Key) => `data-t="${k}">${esc(t[k])}`;
  const features = FEATURES.map(
    ([ic, title, desc]) => `<li class="card"><span class="ic">${icon(ICONS[ic])}</span><h3 ${tx(title)}</h3><p ${tx(desc)}</p></li>`,
  ).join('');
  const bullets = (k: Key) =>
    t[k]
      .split('\n')
      .map((line) => `<li>${esc(line)}</li>`)
      .join('');
  const steps = SELF_HOST_STEPS.map(
    ([ic, title, short, detail, cmd], i) =>
      `<li class="step"><span class="num" aria-hidden="true">${i + 1}</span><details><summary><span class="sic">${icon(ICONS[ic])}</span><span class="st"><b ${tx(title)}</b><small ${tx(short)}</small></span><span class="chev">${icon(ICONS.chevron)}</span></summary><div class="more"><ul data-tl="${detail}">${bullets(detail)}</ul><pre><code>${esc(cmd)}</code></pre></div></details></li>`,
  ).join('');
  const arch = `<div class="arch" aria-hidden="true">
      <div class="node">${icon(ICONS.devices)}<b data-t="archDev">${esc(t.archDev)}</b></div>
      <span class="link">${icon(ICONS.sync)}</span>
      <div class="node">${icon(ICONS.server)}<b data-t="archWorker">${esc(t.archWorker)}</b><small data-t="archWorkerD">${esc(t.archWorkerD)}</small></div>
      <span class="link">${icon(ICONS.arrow)}</span>
      <div class="node">${icon(ICONS.database)}<b data-t="archStore">${esc(t.archStore)}</b><small data-t="archStoreD">${esc(t.archStoreD)}</small></div>
    </div>`;
  const langOptions = LANDING_LANGS.map(
    (l) => `<option value="${l}" lang="${HTML_LANG[l]}"${l === lang ? ' selected' : ''}>${esc(LANG_NAMES[l])}</option>`,
  ).join('');
  return `<!doctype html>
<html lang="${HTML_LANG[lang]}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#2f6fed" />
<title data-t="title">${esc(t.title)}</title>
<meta name="description" content="${esc(t.tagline)}" />
<link rel="icon" type="image/png" href="/favicon.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<style>
  :root { --bg:#f7f8fb; --fg:#151a24; --muted:#5b6475; --card:#fff; --line:#e3e7ef; --accent:#2f6fed; --accent-fg:#fff; --soft:#e8effe; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1218; --fg:#e8ebf2; --muted:#9aa3b5; --card:#171b24; --line:#262c38; --accent:#5b8ff5; --accent-fg:#0b1020; --soft:#1b2640; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body { background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px 24px 48px; }
  header.top { display: flex; justify-content: flex-end; }
  .lang { position: relative; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--muted); padding: 0 10px 0 12px; }
  .lang svg { width: 16px; height: 16px; flex: none; pointer-events: none; }
  .lang select { appearance: none; -webkit-appearance: none; border: 0; background: none; color: var(--fg); font: inherit; font-size: 13px; padding: 6px 16px 6px 0; cursor: pointer; }
  .lang::after { content: ""; position: absolute; right: 12px; top: 50%; width: 6px; height: 6px; margin-top: -5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); pointer-events: none; }
  .lang select option { color: #151a24; background: #fff; }
  :lang(ja) body, body:lang(ja) { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "Noto Sans CJK JP", sans-serif; }
  .hero { text-align: center; padding: 48px 0 32px; }
  .hero img { width: 112px; height: 112px; display: block; margin: 0 auto; }
  .hero h1 { font-size: 40px; line-height: 1.2; margin: 20px 0 8px; letter-spacing: .01em; }
  .hero h1 small { display: block; font-size: 16px; font-weight: 500; color: var(--muted); margin-top: 6px; letter-spacing: .04em; }
  .hero p { max-width: 560px; margin: 0 auto; color: var(--muted); font-size: 18px; }
  .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 28px; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 12px; font-weight: 600; text-decoration: none; border: 1px solid transparent; cursor: pointer; font-size: 16px; font-family: inherit; }
  .btn svg { width: 18px; height: 18px; }
  .btn.primary { background: var(--accent); color: var(--accent-fg); }
  .btn.ghost { background: var(--card); border-color: var(--line); color: var(--fg); }
  .btn:focus-visible, .lang:focus-within { outline: 3px solid var(--soft); outline-offset: 2px; }
  .cards { list-style: none; padding: 0; margin: 40px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; }
  .card .ic { display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 10px; background: var(--soft); color: var(--accent); }
  .card h3 { margin: 12px 0 4px; font-size: 17px; }
  .card p { margin: 0; color: var(--muted); font-size: 15px; }
  .dl { margin: 32px auto 0; max-width: 640px; text-align: center; color: var(--muted); font-size: 14px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  footer { text-align: center; color: var(--muted); font-size: 13px; margin-top: 40px; }
  .moved { display: none; margin: 8px auto 0; max-width: 640px; background: var(--card); border: 1px solid var(--accent); border-radius: 16px; padding: 20px; }
  .moved.show { display: block; }
  .moved h2 { margin: 0 0 6px; font-size: 18px; }
  .moved p { margin: 0 0 8px; color: var(--muted); font-size: 15px; }
  .moved .actions { justify-content: flex-start; margin-top: 16px; }
  .sec { margin-top: 64px; scroll-margin-top: 16px; }
  .sec > h2 { font-size: 28px; line-height: 1.25; margin: 0 0 8px; text-align: center; }
  .sec > .lead { max-width: 640px; margin: 0 auto; text-align: center; color: var(--muted); }
  .arch { display: flex; align-items: stretch; justify-content: center; gap: 8px; margin: 28px auto 8px; max-width: 760px; }
  .arch .node { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 10px; color: var(--accent); }
  .arch .node b { color: var(--fg); font-size: 15px; }
  .arch .node small { color: var(--muted); font-size: 13px; }
  .arch .link { display: flex; align-items: center; color: var(--muted); flex: none; }
  .steps { list-style: none; padding: 0; margin: 8px auto 0; max-width: 760px; }
  .step { position: relative; display: flex; gap: 16px; padding-bottom: 14px; }
  .step:not(:last-child)::before { content: ""; position: absolute; left: 17px; top: 40px; bottom: 0; width: 2px; background: var(--line); }
  .step .num { flex: none; width: 36px; height: 36px; margin-top: 8px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
  .step details { flex: 1 1 auto; min-width: 0; background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
  .step details[open] { border-color: var(--accent); }
  .step summary { list-style: none; display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer; border-radius: 16px; }
  .step summary::-webkit-details-marker { display: none; }
  .step summary:focus-visible { outline: 3px solid var(--soft); outline-offset: 2px; }
  .step .sic { flex: none; display: inline-flex; color: var(--accent); }
  .step .sic svg { width: 20px; height: 20px; }
  .step .st { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .step .st b { font-size: 16px; }
  .step .st small { color: var(--muted); font-size: 14px; }
  .step .chev { flex: none; display: inline-flex; color: var(--muted); transition: transform .15s; }
  .step .chev svg { width: 18px; height: 18px; }
  .step details[open] .chev { transform: rotate(180deg); }
  .step .more { padding: 0 16px 16px 48px; }
  .step ul { margin: 0 0 12px; padding-left: 18px; color: var(--muted); font-size: 15px; }
  .step ul li + li { margin-top: 4px; }
  .step pre { margin: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; overflow-x: auto; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .toggle-all { display: flex; justify-content: flex-end; max-width: 760px; margin: 24px auto 0; }
  .toggle-all button { border: 0; background: none; color: var(--accent); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; padding: 4px 0; }
  @media (max-width: 480px) { .step .more { padding-left: 16px; } .step { gap: 10px; } }
  .note { max-width: 760px; margin: 4px auto 0; color: var(--muted); font-size: 14px; text-align: center; }
  .yd { display: flex; gap: 16px; align-items: center; max-width: 760px; margin: 0 auto; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; }
  .yd .ic { flex: none; display: inline-flex; width: 48px; height: 48px; align-items: center; justify-content: center; border-radius: 12px; background: var(--soft); color: var(--accent); }
  .yd .txt { flex: 1 1 auto; min-width: 0; }
  .yd h2 { margin: 0 0 4px; font-size: 18px; }
  .yd p { margin: 0; color: var(--muted); font-size: 15px; }
  .yd .btn { flex: none; white-space: nowrap; }
  @media (max-width: 640px) { .arch { flex-direction: column; } .arch .link { justify-content: center; transform: rotate(90deg); } .yd { flex-direction: column; align-items: flex-start; } .yd .btn { width: 100%; justify-content: center; } }
  @media (max-width: 480px) { .wrap { padding: 16px 16px 40px; } .hero { padding: 28px 0 20px; } .hero h1 { font-size: 32px; } .hero p { font-size: 16px; } .btn { flex: 1 1 auto; justify-content: center; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <label class="lang">${icon(ICONS.languages)}<span class="sr" data-t="langLabel">${esc(t.langLabel)}</span>
      <select id="lang">${langOptions}</select>
    </label>
  </header>
  <section class="moved" id="moved" role="alert">
    <h2 data-t="movedT">${esc(t.movedT)}</h2>
    <p data-t="movedD">${esc(t.movedD)}</p>
    <p id="pwa" hidden data-t="pwaD">${esc(t.pwaD)}</p>
    <div class="actions">
      <a class="btn ghost" id="export" href="/local/#/settings/data">${icon(ICONS.download)}<span data-t="exportBtn">${esc(t.exportBtn)}</span></a>
      <a class="btn primary" id="go" href="${APP_ORIGIN}/"><span data-t="goBtn">${esc(t.goBtn)}</span>${icon(ICONS.arrow)}</a>
    </div>
  </section>
  <main>
    <section class="hero">
      <img src="/icons/icon-512.png" alt="" width="112" height="112" />
      <h1><span data-t="name">${esc(t.name)}</span><small data-t="sub">${esc(t.sub)}</small></h1>
      <p data-t="tagline">${esc(t.tagline)}</p>
      <div class="actions">
        <a class="btn primary" id="open" href="${APP_ORIGIN}/"><span data-t="open">${esc(t.open)}</span>${icon(ICONS.arrow)}</a>
        <a class="btn ghost" href="${RELEASES_URL}" rel="noopener">${icon(ICONS.download)}<span data-t="download">${esc(t.download)}</span></a>
        <a class="btn ghost" id="self-btn" href="#self-host">${icon(ICONS.server)}<span data-t="selfBtn">${esc(t.selfBtn)}</span></a>
      </div>
    </section>
    <ul class="cards">${features}</ul>
    <p class="dl" data-t="dl">${esc(t.dl)}</p>
    <section class="sec" id="self-host">
      <h2 data-t="shT">${esc(t.shT)}</h2>
      <p class="lead" data-t="shD">${esc(t.shD)}</p>
      ${arch}
      <div class="toggle-all"><button type="button" id="toggle-all" data-t="expandAll">${esc(t.expandAll)}</button></div>
      <ol class="steps">${steps}</ol>
      <p class="note" data-t="shNote">${esc(t.shNote)}</p>
    </section>
    <section class="sec" id="ydiyr">
      <div class="yd">
        <span class="ic">${icon(ICONS.shield)}</span>
        <div class="txt"><h2 data-t="ydT">${esc(t.ydT)}</h2><p data-t="ydD">${esc(t.ydD)}</p></div>
        <a class="btn ghost" href="${YDIYR_URL}" rel="noopener"><span data-t="ydBtn">${esc(t.ydBtn)}</span>${icon(ICONS.external)}</a>
      </div>
    </section>
  </main>
  <footer data-t="footer">${esc(t.footer)}</footer>
</div>
<script>
(function () {
  var APP = ${JSON.stringify(APP_ORIGIN)};
  var TEXT = ${JSON.stringify(LANDING_TEXT)};
  var ACK = 'mindough:moved-ack';
  var PWA_SEEN = 'mindough:pwa-moved-seen';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // 语言：?lang= 优先，再看手动选过的，再按浏览器语言（navigator.languages），都对不上用英文
  var HTML_LANG = ${JSON.stringify(HTML_LANG)};
  var LANG_KEY = 'mindough:landing-lang';
  var matchLang = ${matchLang.toString()};
  function pickLang() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    var fromQuery = q && matchLang(q); if (fromQuery) return fromQuery;
    var saved = matchLang(store(LANG_KEY)); if (saved) return saved;
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < ls.length; i++) { var m = matchLang(ls[i]); if (m) return m; }
    return 'en';
  }
  function apply(lang) {
    var t = TEXT[lang];
    document.documentElement.lang = HTML_LANG[lang];
    document.querySelectorAll('[data-t]').forEach(function (el) { var k = el.getAttribute('data-t'); if (k in t) el.textContent = t[k]; });
    document.querySelectorAll('[data-tl]').forEach(function (ul) {
      var k = ul.getAttribute('data-tl'); if (!(k in t)) return;
      ul.textContent = '';
      String(t[k]).split('\\n').forEach(function (line) { var li = document.createElement('li'); li.textContent = line; ul.appendChild(li); });
    });
    syncToggle();
    var meta = document.querySelector('meta[name="description"]'); if (meta) meta.setAttribute('content', t.tagline);
    var sel = document.getElementById('lang'); if (sel) sel.value = lang;
  }
  // 「全部展开 / 全部收起」：看有没有收着的步骤决定按钮文字
  var curLang = 'en';
  function stepsAll() { return Array.prototype.slice.call(document.querySelectorAll('.step details')); }
  function syncToggle() {
    var b = document.getElementById('toggle-all'); if (!b || !TEXT[curLang]) return;
    var anyClosed = stepsAll().some(function (d) { return !d.open; });
    b.setAttribute('data-t', anyClosed ? 'expandAll' : 'collapseAll');
    b.textContent = TEXT[curLang][anyClosed ? 'expandAll' : 'collapseAll'];
  }
  document.getElementById('toggle-all').addEventListener('click', function () {
    var anyClosed = stepsAll().some(function (d) { return !d.open; });
    stepsAll().forEach(function (d) { d.open = anyClosed; });
    syncToggle();
  });
  stepsAll().forEach(function (d) { d.addEventListener('toggle', syncToggle); });
  curLang = pickLang();
  apply(curLang);
  document.getElementById('lang').addEventListener('change', function (e) {
    var l = matchLang(e.target.value) || 'en';
    store(LANG_KEY, l);
    curLang = l;
    // 地址栏里的 ?lang= 会盖过手动选的，换成新选的
    try { var u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(null, '', u.toString()); } } catch (err) {}
    apply(l);
  });

  // ── 搬家：旧链接（#/…、?task=…）和装到主屏幕的旧版，跳到 app 域名同一路径 ──
  var target = APP + '/' + location.search + location.hash;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var wantsApp = /^#\\//.test(location.hash) || /[?&](task|skin|login_error|view)=/.test(location.search) || standalone;
  document.getElementById('go').href = target;

  // 这个浏览器在旧地址里有没有本机数据（OPFS 里 app 的 SQLite 目录，或更早的 localStorage 数据）
  function hasLocalData() {
    var ls = false;
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i) || ''; if (k.indexOf('mindough') === 0 && k.indexOf('mindough:landing') !== 0 && k !== ACK && k !== PWA_SEEN) { ls = true; break; } } } catch (e) {}
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(ls);
    return navigator.storage.getDirectory().then(function (root) {
      var it = root.keys ? root.keys() : null;
      if (!it) return ls;
      function next() { return it.next().then(function (r) { if (r.done) return ls; if (String(r.value).indexOf('mindough') >= 0 || /\\.db$/.test(String(r.value))) return true; return next(); }); }
      return next();
    }).catch(function () { return ls; });
  }

  function showMoved() {
    document.getElementById('moved').classList.add('show');
    if (standalone) document.getElementById('pwa').hidden = false;
    document.getElementById('moved').scrollIntoView({ block: 'start' });
  }
  document.getElementById('go').addEventListener('click', function () { store(ACK, '1'); if (standalone) store(PWA_SEEN, '1'); });

  hasLocalData().then(function (local) {
    var needNotice = (local && store(ACK) !== '1') || (standalone && store(PWA_SEEN) !== '1');
    if (needNotice) {
      showMoved();
      // 「打开网页版」先看到提示：第一次点只显示提示，第二次照常走
      document.getElementById('open').addEventListener('click', function (e) {
        if (!document.getElementById('moved').dataset.seen) { e.preventDefault(); document.getElementById('moved').dataset.seen = '1'; showMoved(); }
      });
      return;
    }
    if (wantsApp) location.replace(target);
  });
})();
</script>
</body>
</html>`;
}
