/**
 * 日期面板底部的「时区」一行（Rei 2026-10-25：「日期可以选择时区，时区默认是当前时区，时区默认只显示常用的一些时区，点击显示更多显示完整时区列表」）。
 * 收着时：🌐 时区 · 上海 (UTC+8) ›；点开在面板里原地展开列表（不再套一层弹层）：
 * 先是常用（设备时区、最近用过的、UTC、上海、新加坡、东京、首尔、洛杉矶、纽约、伦敦、巴黎、柏林、悉尼），
 * 底部「显示更多」换成完整 IANA 列表 + 搜索框。偏移按所选日期算（夏令时）。选了就存具体名字（core timezone.ts）。
 */
import { useMemo, useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Check, ChevronDown, ChevronRight, Globe, Search } from 'lucide-react';
import { allTimeZones, commonTimeZones, deviceTimeZone, matchTimeZone, pushRecentTimeZone, timeZoneLabel, type DateKey } from '@mindough/core';
import { tr } from '../../lib/i18n';

const RECENT_KEY = 'mindough:tz-recent';

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 记一下最近用过的时区（这台设备，最多 5 个）。 */
export function rememberTimeZone(tz: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecentTimeZone(loadRecent(), tz)));
  } catch {
    /* 存不下就算了 */
  }
}

export function TimeZoneRow({ value, date, onChange }: { value: string | null; date: DateKey; onChange: (tz: string) => void }) {
  const device = deviceTimeZone();
  const current = value ?? device;
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const common = useMemo(() => commonTimeZones(device, loadRecent()), [device, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => (more ? allTimeZones() : []), [more]);
  const list = more ? all.filter((tz) => matchTimeZone(tz, q, date)) : common;

  const pick = (tz: string) => {
    rememberTimeZone(tz);
    onChange(tz);
    setOpen(false);
    setMore(false);
    setQ('');
  };

  return (
    <div className={`tz-row${open ? ' is-open' : ''}`}>
      <RacButton className="tz-toggle" aria-expanded={open} onPress={() => setOpen((o) => !o)}>
        <Globe size={14} aria-hidden />
        <span className="tz-name">{tr('时区')}</span>
        <span className="tz-value">
          {timeZoneLabel(current, date)}
          {!value && <span className="tz-follow">{tr('（跟着设备）')}</span>}
        </span>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      </RacButton>
      {open && (
        <div className="tz-list-wrap">
          {more && (
            <label className="tz-search">
              <Search size={14} aria-hidden />
              <input className="input" autoFocus placeholder={tr('搜索城市或时区')} aria-label={tr('搜索城市或时区')} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          )}
          <div className="tz-list" role="group" aria-label={more ? tr('全部时区') : tr('常用时区')}>
            {list.map((tz) => (
              <RacButton key={tz} className={`tz-item${tz === current ? ' is-selected' : ''}`} onPress={() => pick(tz)} aria-label={timeZoneLabel(tz, date)}>
                <span className="tz-item-label">{timeZoneLabel(tz, date)}</span>
                {tz === device && <span className="tz-item-note">{tr('这台设备')}</span>}
                {tz === current && <Check size={14} aria-hidden />}
              </RacButton>
            ))}
            {more && !list.length && <div className="tz-empty">{tr('没有找到这个时区')}</div>}
          </div>
          {!more && (
            <RacButton className="tz-more" onPress={() => setMore(true)}>
              {tr('显示更多')}
            </RacButton>
          )}
        </div>
      )}
    </div>
  );
}
