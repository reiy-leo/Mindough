/**
 * 农历订阅（Rei 2026-10-17）：从外部订阅一份节气 / 传统节日 / 法定假日调休日历（ICS），设置里显示源地址和多久同步一次。
 * 源地址、同步频率、显示农历开关是跟着账户同步的偏好（store.pref）；拉到的数据、上次同步时间和状态只存这台设备（离线可用）。
 */
import { getLocale, tr } from '../i18n';

/**
 * 默认源：Apple 的「中国大陆节假日」公开日历（macOS / iOS 日历里订阅的同一份）。
 * 内容：24 节气、传统节日（春节、元宵、端午、七夕、中秋、重阳、除夕…）、法定假日的放假（休）与调休上班（班），简体中文，覆盖前一年到之后约 5 年。
 */
export const DEFAULT_LUNAR_SUB_URL = 'https://calendars.icloud.com/holidays/cn_zh.ics';

export const LUNAR_PREFS = {
  /** 日期格子下显示农历小字（默认：界面中文时开）。 */
  show: 'lunar.show',
  /** 订阅源地址（空 = 默认源）。 */
  subUrl: 'lunar.sub_url',
  /** 同步频率 daily | weekly | monthly | manual（默认每天）。 */
  subFreq: 'lunar.sub_freq',
} as const;

export type SubFreq = 'daily' | 'weekly' | 'monthly' | 'manual';
export const SUB_FREQS: readonly SubFreq[] = ['daily', 'weekly', 'monthly', 'manual'];
export const DEFAULT_SUB_FREQ: SubFreq = 'daily';

export function normalizeSubFreq(v: unknown): SubFreq {
  return SUB_FREQS.includes(v as SubFreq) ? (v as SubFreq) : DEFAULT_SUB_FREQ;
}

export function subFreqLabel(f: SubFreq): string {
  switch (f) {
    case 'daily':
      return tr('每天');
    case 'weekly':
      return tr('每周');
    case 'monthly':
      return tr('每月');
    case 'manual':
      return tr('手动');
  }
}

const HOUR = 3_600_000;
const FREQ_MS: Record<Exclude<SubFreq, 'manual'>, number> = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR, monthly: 30 * 24 * HOUR };
/** 失败后至少隔多久再自动试（不影响「立即同步」）。 */
export const SUB_RETRY_MS = HOUR;

/** 显示农历：用户设过就用设的，没设过跟界面语言（中文开、英文关）。 */
export function lunarShown(pref: unknown, locale = getLocale()): boolean {
  return typeof pref === 'boolean' ? pref : locale === 'zh';
}

/** 订阅源地址：没设或设成空 → 默认源。 */
export function subUrlOf(pref: unknown): string {
  return typeof pref === 'string' && pref.trim() ? pref.trim() : DEFAULT_LUNAR_SUB_URL;
}

/** 检查用户填的地址：webcal:// 换成 https://，只收 http(s)。不合法返回 null。 */
export function normalizeSubUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  // core 不带 DOM：不用 URL，按「协议://主机[:端口][路径]」检查（主机要有点、不能有空格和账号密码）
  const m = /^(https?):\/\/([^/?#:@\s]+)(:\d{1,5})?([/?#][^\s]*)?$/i.exec(s);
  if (!m || !m[2]!.includes('.')) return null;
  return `${m[1]!.toLowerCase()}://${m[2]!.toLowerCase()}${m[3] ?? ''}${m[4] ?? '/'}`;
}

/** 这台设备上订阅的状态。 */
export interface SubState {
  /** 这份缓存是从哪个地址拉的（地址改了就作废）。 */
  url: string;
  /** 上次同步成功（ISO）。 */
  okAt: string | null;
  /** 上次尝试（ISO）。 */
  triedAt: string | null;
  /** 上次尝试的结果。 */
  status: SubStatus | null;
}

export type SubStatus =
  | { ok: true; count: number; name: string | null }
  | { ok: false; code: number | null; reason: 'http' | 'upstream' | 'offline' | 'not_ics' | 'empty' };

/** 到点该自动同步了吗（地址变了、从没成功过也算；手动的从不自动；刚失败过隔一小时再试）。 */
export function subDue(state: SubState | null, url: string, freq: SubFreq, now: number): boolean {
  if (freq === 'manual') return false;
  const same = !!state && state.url === url;
  if (same && state.triedAt && (!state.okAt || state.triedAt > state.okAt) && now - Date.parse(state.triedAt) < SUB_RETRY_MS) return false;
  if (!same || !state.okAt) return true;
  return now - Date.parse(state.okAt) >= FREQ_MS[freq];
}

/** HTTP 状态码的中文说明（「404 未找到」）。 */
export function httpStatusZh(code: number): string {
  const m: Record<number, string> = {
    400: tr('请求有误'),
    401: tr('未登录'),
    403: tr('无权限'),
    404: tr('未找到'),
    408: tr('请求超时'),
    410: tr('已删除'),
    413: tr('内容太大'),
    415: tr('不支持的格式'),
    429: tr('请求太多'),
    500: tr('服务器内部错误'),
    502: tr('网关错误'),
    503: tr('服务不可用'),
    504: tr('网关超时'),
  };
  return m[code] ?? '';
}

const withCode = (code: number) => `${code}${httpStatusZh(code) ? ` ${httpStatusZh(code)}` : ''}`;

/** 状态说给人听。 */
export function subStatusText(s: SubStatus | null): string {
  if (!s) return tr('还没同步过');
  if (s.ok) return tr('同步成功，{n} 个日子', { n: s.count });
  switch (s.reason) {
    case 'offline':
      return tr('同步失败：没连上网络');
    case 'not_ics':
      return tr('同步失败：这个地址不是日历文件（ICS）');
    case 'empty':
      return tr('同步失败：日历里没有能显示的日子');
    case 'upstream':
      return tr('同步失败：订阅源返回 {code}', { code: s.code ? withCode(s.code) : '?' });
    case 'http':
      return tr('同步失败：{code}', { code: s.code ? withCode(s.code) : '?' });
  }
}
