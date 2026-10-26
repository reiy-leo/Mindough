/// <reference types="node" />
/**
 * 扫描源码里的中文（给 i18n 测试用）：
 * - keys：所有 tr('…') / trx('…') 的第一个参数（中文原文 = key）。
 * - bare：不在 tr / trx 第一个参数里、也不在注释里的中文字面量 / JSX 文本（界面上会漏翻的地方）。
 * 用 TypeScript 编译器解析，注释天然不算。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;

export interface Bare {
  file: string;
  line: number;
  text: string;
}

export function walk(dir: string, skip: (p: string) => boolean = () => false, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f === 'dist' || f.startsWith('.') || skip(p)) continue;
    if (fs.statSync(p).isDirectory()) walk(p, skip, out);
    else if (/\.(tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

const isTrCall = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'tr' || n.expression.text === 'trx' || n.expression.text === 'trc');

/** 任务状态等内部枚举值：比较、赋值时是数据，不算漏翻（显示时另有 tr）。 */
export const ENUM_WORDS = new Set(['待办', '进行中', '完成', '关闭', '可开始', '被阻塞', '取消', '今天到期', '这几天要做', '今天要打卡', '刚解锁', '倒数日到了']);

/** 显示位置：JSX 属性 / 表达式、label / title / message… 这类属性的值。枚举值放在这里就是漏翻。 */
const DISPLAY_PROPS = new Set(['label', 'title', 'message', 'text', 'hint', 'placeholder', 'subtitle']);
function isDisplaySlot(n: ts.Node): boolean {
  let p = n.parent;
  while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.BarBarToken || p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))) p = p.parent;
  if (!p) return false;
  if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true;
  if (ts.isPropertyAssignment(p) && p.initializer !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && DISPLAY_PROPS.has(p.name.text)) return true;
  return false;
}

const isConsole = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console';

export function scanFile(file: string, full = false, isData: (s: string) => boolean = () => false): { keys: string[]; bare: Bare[] } {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const keys: string[] = [];
  const bare: Bare[] = [];
  const lines = src.split('\n');
  const report = (n: ts.Node, text: string) => {
    if (!CJK.test(text)) return;
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line;
    // 行尾或上一行写了 i18n-ignore 的是有意保留的中文（中文分支、写进数据的格式、解析用的正则）
    if (lines[line]?.includes('i18n-ignore') || lines[line - 1]?.includes('i18n-ignore')) return;
    if (ENUM_WORDS.has(text) && !ts.isJsxText(n) && !isDisplaySlot(n)) return;
    if (isData(text) && !ts.isJsxText(n)) return; // 存进数据的内置选项值（电影 / 晚餐…），显示时 dataLabel
    bare.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: full ? text : text.trim().slice(0, 60) });
  };
  const visit = (n: ts.Node) => {
    if (isConsole(n)) return; // 开发者日志
    if (isTrCall(n)) {
      const lit = (a: ts.Expression | undefined) => (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null);
      const ctxCall = (n.expression as ts.Identifier).text === 'trc';
      const args = [...n.arguments];
      const ctx = ctxCall ? lit(args.shift()) : null;
      const first = args.shift();
      const k = lit(first);
      if (k !== null) keys.push(ctx ? `${ctx}|${k}` : k);
      else if (first) visit(first);
      args.forEach(visit);
      return;
    }
    // import 路径、类型位置的字面量不算
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) report(n, n.text);
    else if (ts.isTemplateExpression(n)) {
      report(n, n.head.text + n.templateSpans.map((s) => s.literal.text).join(''));
      n.templateSpans.forEach((s) => visit(s.expression));
      return;
    } else if (ts.isJsxText(n)) report(n, n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { keys, bare };
}

export function scan(files: string[], isData?: (s: string) => boolean) {
  const keys = new Set<string>();
  const bare: Bare[] = [];
  for (const f of files) {
    const r = scanFile(f, false, isData);
    r.keys.forEach((k) => keys.add(k));
    bare.push(...r.bare);
  }
  return { keys, bare };
}
