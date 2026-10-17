/**
 * 生成 src/lunar/data.ts（农历 1900–2100 月大小 / 闰月表 + 公历 1900–2100 节气表）。
 * 数据来自 lunar-javascript（MIT，6tail，寿星天文历算法）；它不是项目依赖，只在生成时用：
 *   cd /tmp && npm i lunar-javascript@1.7.7 && node <仓库>/packages/core/scripts/gen-lunar-data.mjs
 * （脚本按 NODE_PATH / 当前目录的 node_modules 找 lunar-javascript；输出写回仓库。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { Solar, LunarYear } = require('lunar-javascript');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lunar/data.ts');

const info = [];
for (let y = 1900; y <= 2100; y++) {
  const ly = LunarYear.fromYear(y);
  let v = ly.getLeapMonth();
  for (const m of ly.getMonths()) {
    if (m.getYear() !== y) continue;
    const n = m.getMonth();
    const big = m.getDayCount() === 30;
    if (n < 0) { if (big) v |= 0x10000; } else if (big) v |= 0x8000 >> (n - 1);
  }
  info.push(v);
}
const NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
const terms = {};
for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
  const j = Solar.fromYmd(y, m, dd).getLunar().getJieQi();
  if (!j) continue;
  const i = NAMES.indexOf(j);
  if (i < 0 || Math.floor(i / 2) + 1 !== m) throw new Error(`节气对不上 ${y}-${m}-${dd} ${j}`);
  (terms[y] ??= Array(24).fill(0))[i] = dd;
}
const min = Array(24).fill(99);
for (const y in terms) terms[y].forEach((d, i) => { if (!d) throw new Error(`缺节气 ${y} ${NAMES[i]}`); min[i] = Math.min(min[i], d); });
const enc = Object.keys(terms).map(Number).sort((a, b) => a - b).map((y) => {
  let s = '';
  for (let k = 0; k < 24; k += 2) {
    const a = terms[y][k] - min[k], b = terms[y][k + 1] - min[k + 1];
    if (a > 3 || b > 3) throw new Error(`节气偏移超过 2 位 ${y}`);
    s += ((a << 2) | b).toString(16);
  }
  return s;
});
const rows = (arr, per, f) => { const out = []; for (let i = 0; i < arr.length; i += per) out.push('  ' + arr.slice(i, i + per).map(f).join(', ') + ','); return out.join('\n'); };
fs.writeFileSync(OUT, `/**
 * 农历 / 节气数据表（1900–2100），由 scripts/gen-lunar-data.mjs 从 lunar-javascript 1.7.7（MIT，6tail，寿星天文历算法）生成，
 * 生成时逐日核对过。不要手改——要改就重新生成。
 *
 * LUNAR_INFO[y - 1900]：农历 y 年（从那年正月初一起）
 *   低 4 位      闰几月（0 = 没闰月）
 *   第 4–15 位   1–12 月是不是大月（30 天）：第 15 位是正月 … 第 4 位是十二月
 *   第 16 位     闰月是不是大月
 * SOLAR_TERMS[y - 1900]：公历 y 年 24 个节气（小寒 … 冬至），每两个节气一个十六进制位（各 2 位：比 TERM_BASE 晚几天）。
 */
export const LUNAR_FIRST_YEAR = 1900;
export const LUNAR_LAST_YEAR = 2100;
/** 1900 年正月初一 = 公历 1900-01-31。 */
export const LUNAR_EPOCH = '1900-01-31';

export const LUNAR_INFO: readonly number[] = [
${rows(info, 10, (x) => '0x' + x.toString(16).padStart(5, '0'))}
];

/** 每个节气最早落在几号（小寒 … 冬至）。 */
export const TERM_BASE: readonly number[] = ${JSON.stringify(min)};

export const SOLAR_TERMS: readonly string[] = [
${rows(enc, 6, (s) => `'${s}'`)}
];
`);
console.log('写好了', OUT);
