/**
 * 读 CSV（RFC 4180）：引号里的逗号、换行、两个引号转义成一个；去掉开头的 BOM；\r\n / \n / \r 都当换行。
 * 只给滴答清单导入用，不追求通用（没有自定义分隔符）。
 */
export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((r) => r.cells);
}

/** 同上，另带每条记录从文件第几行开始（1 起；引号里换行的记录占好几行）。 */
export function parseCsvLines(text: string): Array<{ cells: string[]; line: number }> {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: Array<{ cells: string[]; line: number }> = [];
  let row: string[] = [];
  let line = 1;
  let start = 1;
  let cell = '';
  let quoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push({ cells: row, line: start });
    row = [];
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === '\n' || (ch === '\r' && s[i + 1] !== '\n')) line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
    } else if (ch === ',') {
      endCell();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      line++;
      start = line;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== '' || row.length) endRow();
  // 引号里的换行统一成 \n
  return rows.map((r) => ({ line: r.line, cells: r.cells.map((c) => c.replace(/\r\n?/g, '\n')) }));
}
