/**
 * 数学公式（Rei 2026-10-17）：行内 `$…$`、块级 `$$…$$`（和 ```math），用 KaTeX 渲染；markdown 原文不变。
 * 什么算公式按 GitHub 的规则，免得把价格当公式（「$5 和 $10」）：
 *   开头的 $ 后面紧跟非空白，结尾的 $ 前面是非空白，结尾的 $ 后面不是数字。
 * KaTeX（含字体、CSS）打包在应用里、按需加载（不走 CDN）：loadKatex() 之前 renderMath 先给源码占位。
 */
import type katexType from 'katex';

type Katex = typeof katexType;
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

/** 加载 KaTeX（JS + CSS + 字体，都是本地打包的文件）。 */
export function loadKatex(): Promise<Katex> {
  if (katex) return Promise.resolve(katex);
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (katex = (m.default ?? m) as Katex));
  return loading;
}
export const katexReady = () => katex != null;
/** 测试 / 编辑器：已经静态导入了就直接交进来。 */
export const provideKatex = (k: Katex) => void (katex = k);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 公式 → HTML。写错的公式不报错，显示成红色源码（KaTeX 的 throwOnError: false）。KaTeX 还没加载：源码占位。 */
export function renderMath(src: string, display: boolean): string {
  if (!katex) return `<code class="md-math-pending">${esc(src)}</code>`;
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore', trust: false });
  } catch {
    return `<code class="md-math-error">${esc(src)}</code>`;
  }
}

/** 一段文字里可能有公式（只读显示决定要不要先加载 KaTeX）。 */
export const mayHaveMath = (md: string) => md.includes('$') || /```\s*math/i.test(md);

/**
 * 行内公式是否成立（GitHub 规则）。inner：两个 $ 之间的文字；next：结尾 $ 后面那个字。
 */
export function validInlineMath(inner: string, next: string | undefined): boolean {
  if (!inner || /^\s/.test(inner) || /\s$/.test(inner)) return false;
  if (next && /\d/.test(next)) return false;
  return true;
}

/** 只读显示（marked）用：从开头匹配一段行内公式 `$…$` / `$$…$$`。 */
export const INLINE_MATH_RE = /^(\${1,2})(?!\$)((?:\\.|[^\\$])+?)\1(?!\$)/;
/** 只读显示：块级公式 `$$` 独占一行开头和结尾（中间多行）或 `$$ … $$` 一行。 */
export const BLOCK_MATH_RE = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n+|$)|^ {0,3}\$\$((?:\\.|[^\\$\n])+?)\$\$[ \t]*(?:\n+|$)/;

/**
 * 编辑器手打：光标前刚打完的 `$公式$`（结尾这个 $ 是正在打的）。前面不是 $ 或 \（`$$`、`\$` 不算）。
 * 后面是不是数字打的时候还不知道：紧接着打数字时再变回文字（gh-syntax.ts 的 mathDigitRule）。
 */
export const MATH_INPUT_RE = /(?<![\\$])\$([^\s$](?:[^$]*[^\s$\\])?)\$$/;
