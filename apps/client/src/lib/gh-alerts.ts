/**
 * GitHub 提示块（Alerts，Rei 2026-10-17）：引用块第一行写 `[!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
 *（大小写不敏感）就显示成带图标、颜色、标题的提示块。markdown 原文不变（还是 `> [!NOTE]`）。
 * 编辑器（components/editor/gh-syntax.ts）和只读显示（lib/markdown.ts）共用这里的判断、标题、图标。
 */
import { tr } from './i18n';

export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** 引用块第一行的标记：`[!NOTE]`，后面只能是空白（GitHub 的规则：标记要独占一行）。旧编辑器存成的 `\[!NOTE]` 也认。 */
export const ALERT_MARKER_RE = /^\\?\[!(note|tip|important|warning|caution)\\?\][ \t]*(?:\r?\n|$)/i;

/** 文字开头的提示标记：{ kind, marker（原样的大小写）, rest（标记那行之后的文字） }。 */
export function parseAlertMarker(text: string): { kind: AlertKind; marker: string; rest: string } | null {
  const m = ALERT_MARKER_RE.exec(text);
  if (!m) return null;
  return { kind: m[1]!.toLowerCase() as AlertKind, marker: m[1]!, rest: text.slice(m[0].length) };
}

/** 标题（参考 GitHub 中文界面）。函数：换语言后重新取。 */
export function alertTitle(kind: AlertKind): string {
  switch (kind) {
    case 'note':
      return tr('注意');
    case 'tip':
      return tr('提示');
    case 'important':
      return tr('重要');
    case 'warning':
      return tr('警告');
    case 'caution':
      return tr('小心');
  }
}

/** 图标（lucide 线条风格：info / lightbulb / message-square-warning / triangle-alert / octagon-alert）。 */
const ICON_BODY: Record<AlertKind, string> = {
  note: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  tip: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  important: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v2"/><path d="M12 13h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  caution: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

export const alertIconSvg = (kind: AlertKind) =>
  `<svg class="md-alert-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_BODY[kind]}</svg>`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 只读显示的标题行 HTML。 */
export const alertTitleHtml = (kind: AlertKind) => `<p class="md-alert-title">${alertIconSvg(kind)}<span>${esc(alertTitle(kind))}</span></p>`;
