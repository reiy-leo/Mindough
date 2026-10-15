/**
 * 看片进度（episode 字段）：从「绝命毒师 S02E03」「第二季第三集」这类文字里认出第几季第几集，
 * 存成 { season, episode }，显示成「第 2 季第 3 集」（docs/COPY.md）。认不出的仍按原文存。
 */
import type { EpisodeValue, FieldValue } from './types';

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文数字（到千）或阿拉伯数字 → 数字：「十二」12、「二十」20、「一百零五」105、「3」3。 */
export function parseCnNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[零〇一二两三四五六七八九十百千]+$/.test(s)) return null;
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch]!;
    else {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      total += (cur || 1) * unit;
      cur = 0;
    }
  }
  return total + cur;
}

const N = '(\\d{1,4}|[零〇一二两三四五六七八九十百千]{1,6})';
// 左边界：前面不是字母数字（中文、空格、标点、开头都行）
const L = '(?<![A-Za-z0-9])';
const R = '(?![A-Za-z0-9])';

interface Rule {
  re: RegExp;
  pick: (m: RegExpExecArray) => EpisodeValue;
}

const RULES: Rule[] = [
  // S02E03、s2e3、S2 E3、S02.E03、S2EP3
  { re: new RegExp(`${L}S(\\d{1,2})\\s*[._-]?\\s*EP?\\s*(\\d{1,4})${R}`, 'i'), pick: (m) => ({ season: +m[1]!, episode: +m[2]! }) },
  // Season 2 Episode 3
  { re: new RegExp(`${L}season\\s*(\\d{1,2})\\s*[,，]?\\s*episode\\s*(\\d{1,4})${R}`, 'i'), pick: (m) => ({ season: +m[1]!, episode: +m[2]! }) },
  // 2x03
  { re: new RegExp(`${L}(\\d{1,2})x(\\d{2,3})${R}`, 'i'), pick: (m) => ({ season: +m[1]!, episode: +m[2]! }) },
  // 第2季第3集、第二季 第三集、第2季3集、第二季第三话
  { re: new RegExp(`第\\s*${N}\\s*季\\s*第?\\s*${N}\\s*[集话話]`), pick: (m) => ({ season: parseCnNumber(m[1]!)!, episode: parseCnNumber(m[2]!)! }) },
  // 只有集：EP03、E03、Ep 3、Episode 3、第3集
  { re: new RegExp(`${L}(?:EP\\s?|E|episode\\s?)(\\d{1,4})${R}`, 'i'), pick: (m) => ({ episode: +m[1]! }) },
  { re: new RegExp(`第\\s*${N}\\s*[集话話]`), pick: (m) => ({ episode: parseCnNumber(m[1]!)! }) },
  // 只有季：S02、Season 2、第二季
  { re: new RegExp(`${L}S(\\d{1,2})${R}`, 'i'), pick: (m) => ({ season: +m[1]! }) },
  { re: new RegExp(`${L}season\\s*(\\d{1,2})${R}`, 'i'), pick: (m) => ({ season: +m[1]! }) },
  { re: new RegExp(`第\\s*${N}\\s*季`), pick: (m) => ({ season: parseCnNumber(m[1]!)! }) },
];

export interface EpisodeMatch {
  value: EpisodeValue;
  /** 命中的那段原文，如「S02E03」。 */
  raw: string;
  index: number;
}

/** 在一段文字里找季 / 集标记（取最先命中的规则）。 */
export function findEpisode(text: string): EpisodeMatch | null {
  const s = text.normalize('NFKC');
  for (const r of RULES) {
    const m = r.re.exec(s);
    if (!m) continue;
    const value = r.pick(m);
    if ((value.season !== undefined && !(value.season >= 0)) || (value.episode !== undefined && !(value.episode >= 0))) continue;
    return { value, raw: m[0], index: m.index };
  }
  return null;
}

/** 把季 / 集标记从名字里拿掉：「绝命毒师 S02E03」→ { rest: 绝命毒师, value: { season: 2, episode: 3 } }。 */
export function stripEpisode(text: string): { rest: string; match: EpisodeMatch | null } {
  const match = findEpisode(text);
  if (!match) return { rest: text, match: null };
  const s = text.normalize('NFKC');
  const rest = (s.slice(0, match.index) + ' ' + s.slice(match.index + match.raw.length))
    .replace(/\s*[-–—·|:：,，]\s*$/, '')
    .replace(/^\s*[-–—·|:：,，]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { rest, match };
}

/** 显示：第 2 季第 3 集 / 第 3 集 / 第 2 季。 */
export function formatEpisode(v: EpisodeValue): string {
  const s = v.season !== undefined ? `第 ${v.season} 季` : '';
  const e = v.episode !== undefined ? `第 ${v.episode} 集` : '';
  return s + e;
}

/** 字段值 → 结构化的季集（旧数据是文字时尽量认出来；整段都是标记才算）。 */
export function episodeOf(v: FieldValue | undefined): EpisodeValue | null {
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v) && ('season' in v || 'episode' in v)) {
    const o = v as EpisodeValue;
    const out: EpisodeValue = {};
    if (typeof o.season === 'number') out.season = o.season;
    if (typeof o.episode === 'number') out.episode = o.episode;
    return out.season !== undefined || out.episode !== undefined ? out : null;
  }
  if (typeof v === 'string') {
    const n = normalizeEpisodeInput(v);
    return n && typeof n === 'object' ? n : null;
  }
  return null;
}

/**
 * 「看到哪」里直接输入的文字：整段是一个季集标记（S02E03、第二季第三集、2x03）→ 结构化；
 * 其他写法（「看到片尾彩蛋」）原样留着；空 → null。
 */
export function normalizeEpisodeInput(text: string): EpisodeValue | string | null {
  const t = text.trim();
  if (!t) return null;
  const { rest, match } = stripEpisode(t);
  if (match && rest === '') return match.value;
  return t;
}

export const isEpisodeValue = (v: FieldValue | undefined): v is EpisodeValue => !!v && typeof v === 'object' && !Array.isArray(v) && ('season' in v || 'episode' in v);
