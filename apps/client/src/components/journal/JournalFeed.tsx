/**
 * 日记的条目列表（Rei 2026-10-28 Feed 流）：按天分组，新的日子在上，一天里新的在上。每条：时间、心情图标、正文。
 * 发了不能改（Rei：「a feed提交之后就不能修改了，心情也不能修改」），所以没有编辑；右键 / 长按（或 ··· 菜单）只有「删除」，
 * 先确认，删了提示里能撤销。旧日记转来的条目，旧日记上的附件跟着显示（只读）。
 */
import { useState, type CSSProperties } from 'react';
import { Trash2 } from 'lucide-react';
import { formatDate, moodLabel, postTime, relativeDayZh, type DateKey, type JournalPost } from '@mindough/core';
import { useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { ConfirmDialog, MenuAt, OverflowMenu, useContextMenuAt, type MenuAction } from '../../ui/primitives';
import { Markdown } from '../Markdown';
import { Attachments } from '../attachments/Attachments';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

/** 「今天 · 10月28日 周三」「10月26日 周一」。 */
export function dayTitle(day: DateKey, today: DateKey): string {
  const date = formatDate(day, { weekday: true, year: day.slice(0, 4) !== today.slice(0, 4) });
  const rel = relativeDayZh(day, today);
  return rel && rel !== formatDate(day) && rel !== date ? `${rel} · ${date}` : date;
}

export function JournalFeed({ groups, today }: { groups: ReadonlyArray<{ day: DateKey; posts: JournalPost[] }>; today: DateKey }) {
  const store = useStore();
  const ui = useUi();
  const [confirm, setConfirm] = useState<JournalPost | null>(null);
  const remove = (p: JournalPost) => {
    store.deleteJournalPost(p.id);
    ui.toast({ message: tr('删了一条日记'), actions: [{ label: tr('撤销'), onPress: () => store.restoreJournalPost(p.id) }] }, 6000);
  };
  return (
    <div className="jfeed">
      {groups.map((g) => (
        <section key={g.day} className="jfeed-day" aria-label={dayTitle(g.day, today)}>
          <h3 className="jfeed-day-title">
            <span>{dayTitle(g.day, today)}</span>
            <span className="jfeed-day-count">{tr('{n} 条', { n: g.posts.length })}</span>
          </h3>
          <ul className="jfeed-list">
            {g.posts.map((p) => (
              <Post key={p.id} post={p} onDelete={() => setConfirm(p)} />
            ))}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        isOpen={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={tr('删除这条日记？')}
        message={tr('删了以后在提示里还能撤销。')}
        confirmLabel={tr('删除')}
        danger
        onConfirm={() => {
          if (confirm) remove(confirm);
          setConfirm(null);
        }}
      />
    </div>
  );
}

function Post({ post, onDelete }: { post: JournalPost; onDelete: () => void }) {
  const store = useStore();
  const menu = useContextMenuAt();
  const items: MenuAction[] = [{ id: 'delete', label: tr('删除'), icon: <Trash2 size={16} />, danger: true, onAction: onDelete }];
  const attached = store.attachmentsOfPost(post).length > 0;
  const entryId = attached ? store.attachmentsOfPost(post)[0]!.owner_id : null;
  const time = postTime(post.created_at);
  return (
    <li className={`jpost${post.mood ? ' has-mood' : ''}`} style={post.mood ? ({ '--jm': `var(--mood-${post.mood})` } as CSSProperties) : undefined} {...menu.props}>
      <div className="jpost-side">
        <time className="jpost-time" dateTime={post.created_at}>
          {time}
        </time>
      </div>
      <div className="jpost-main">
        {post.mood && (
          <div className="jpost-mood">
            <MoodIcon mood={post.mood} size={22} />
            <span>{moodLabel(post.mood) || post.mood}</span>
          </div>
        )}
        {post.body_md.trim() ? <Markdown source={post.body_md} className="jpost-body" /> : null}
        {entryId && <Attachments owner={{ type: 'journal', id: entryId, date: post.day }} bare disabled />}
      </div>
      <OverflowMenu className="jpost-more" label={tr('这条日记的操作')} items={items} />
      <MenuAt at={menu.at} label={tr('这条日记的操作')} items={items} onClose={menu.close} />
    </li>
  );
}
