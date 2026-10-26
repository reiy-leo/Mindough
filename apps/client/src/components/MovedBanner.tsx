import { ArrowRight, Info } from 'lucide-react';
import { LEGACY_ORIGIN, SERVER_ORIGIN } from '../lib/origins';
import { tr } from '../lib/i18n';

/**
 * 在旧地址（mindough.rei8t.dev/local/）打开 app 时顶上的提示（Rei 2026-10-26 把网页版搬到 app.mindough.rei8t.dev）：
 * 旧地址的 app 只用来导出这台浏览器里没同步的本机数据（OPFS 按域名隔离，新地址读不到）。不能关，免得忘了自己在旧地址。
 */
export function MovedBanner() {
  if (typeof location === 'undefined' || location.origin !== LEGACY_ORIGIN) return null;
  const host = new URL(SERVER_ORIGIN).host;
  return (
    <div className="banner" role="status">
      <Info size={18} aria-hidden />
      <span className="grow">{tr('这是旧地址，只用来导出这台设备上的数据。网页版已经搬到 {host}。', { host })}</span>
      <a className="btn btn-tonal" href={`${SERVER_ORIGIN}/`}>
        {tr('去新地址')} <ArrowRight size={16} aria-hidden />
      </a>
    </div>
  );
}
