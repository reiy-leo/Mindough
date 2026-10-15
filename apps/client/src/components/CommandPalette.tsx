import { useEffect, useMemo, useState } from 'react';
import { Dialog, Input, Modal, ModalOverlay, SearchField, Button as RacButton } from 'react-aria-components';
import { CornerDownLeft, FolderOpen, Plus, Search, Sun, SunDim, UserRound } from 'lucide-react';
import { search, type SearchHit } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { navigate } from '../lib/router';
import { toggleMyDay } from '../lib/actions';
import { viewOf } from '../lib/view';
import { TaskThumb } from './TaskRow';
import { Avatar } from './Avatar';

/** ⌘K / Ctrl+K 全局搜索：搜正文、类型字段、人物、组；结果直接“加入我的一天”。 */
export function CommandPalette() {
  const ui = useUi();
  const store = useStore();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!ui.paletteOpen) {
      setQ('');
      setActive(0);
    }
  }, [ui.paletteOpen]);

  const hits = useMemo<SearchHit[]>(
    () =>
      search(
        { tasks: store.list('task'), types: store.list('task_type'), people: store.list('person'), groups: store.list('group'), taskPeople: store.list('task_person') },
        q,
        20,
      ),
    [q, store, store.version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const recent = useMemo(() => (q ? [] : store.tasks().filter((t) => t.status !== '完成' && t.status !== '取消').slice(-6).reverse()), [q, store, store.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => ui.setPaletteOpen(false);
  const createFromQuery = () => {
    const t = store.createTask({ body_md: q.trim() });
    store.addToMyDay(t.id);
    ui.toast({ tone: 'success', message: `已新建并加入我的一天：「${q.trim()}」` }, 3000);
    close();
  };
  const openHit = (h: SearchHit) => {
    close();
    if (h.kind === 'task') ui.openEditor(h.id);
    else if (h.kind === 'person') navigate({ page: 'person', id: h.id });
    else navigate({ page: 'group', id: h.id });
  };
  const count = (q.trim() ? 1 : 0) + hits.length;

  const taskItem = (id: string, title: string, snippet: string, index: number) => {
    const t = store.get('task', id);
    if (!t) return null;
    const v = viewOf(store, t);
    const inDay = store.isInMyDay(id);
    return (
      <li key={id} className={`palette-item${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)}>
        <RacButton className="palette-main" onPress={() => { close(); ui.openEditor(id); }}>
          <TaskThumb media={v.media} layout={v.type?.layout ?? 'text'} isAvatar={v.mediaIsAvatar} color={v.type?.color} icon={v.type?.icon} />
          <span className="palette-text">
            <span className="palette-title">{title}</span>
            <span className="palette-snippet">
              {v.type && v.type.layout !== 'text' ? `${v.type.name} · ` : ''}
              {t.status}
              {snippet ? ` · ${snippet}` : ''}
            </span>
          </span>
        </RacButton>
        <RacButton className={`btn btn-tonal palette-add${inDay ? ' is-on' : ''}`} onPress={() => toggleMyDay(store, ui, id)} aria-label={inDay ? '移出我的一天' : '加入我的一天'}>
          {inDay ? <Sun size={15} /> : <SunDim size={15} />}
          {inDay ? '已在今天' : '加入我的一天'}
        </RacButton>
      </li>
    );
  };

  return (
    <ModalOverlay isOpen={ui.paletteOpen} onOpenChange={ui.setPaletteOpen} isDismissable className="overlay overlay-top">
      <Modal className="modal palette">
        <Dialog aria-label="搜索" className="dialog">
          <SearchField
            aria-label="搜索任务、人物、组"
            className="palette-search"
            value={q}
            onChange={(v) => {
              setQ(v);
              setActive(0);
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, Math.max(0, count - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
            }}
            onSubmit={() => {
              if (q.trim() && active === 0) createFromQuery();
              else {
                const h = hits[active - (q.trim() ? 1 : 0)];
                if (h) openHit(h);
              }
            }}
          >
            <Search size={18} className="palette-icon" aria-hidden />
            <Input className="palette-input" placeholder="搜索任务、片名、店名、人物、组…" />
            <kbd className="kbd">Esc</kbd>
          </SearchField>
          <ul className="palette-list">
            {q.trim() && (
              <li className={`palette-item${active === 0 ? ' is-active' : ''}`} onMouseEnter={() => setActive(0)}>
                <RacButton className="palette-main" onPress={createFromQuery}>
                  <span className="thumb thumb-icon"><Plus size={16} /></span>
                  <span className="palette-text">
                    <span className="palette-title">新建「{q.trim()}」并加入我的一天</span>
                  </span>
                  <CornerDownLeft size={14} className="muted" />
                </RacButton>
              </li>
            )}
            {!q && <li className="palette-group">最近的任务</li>}
            {recent.map((t, i) => taskItem(t.id, viewOf(store, t).title, '', i))}
            {hits.map((h, i) => {
              const index = i + (q.trim() ? 1 : 0);
              if (h.kind === 'task') return taskItem(h.id, h.title, h.snippet, index);
              return (
                <li key={h.id} className={`palette-item${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)}>
                  <RacButton className="palette-main" onPress={() => openHit(h)}>
                    {h.kind === 'person' ? <Avatar store={store} person={h.person} size={32} /> : <span className="thumb thumb-icon">{h.group.icon || <FolderOpen size={16} />}</span>}
                    <span className="palette-text">
                      <span className="palette-title">{h.title}</span>
                      <span className="palette-snippet">
                        {h.kind === 'person' ? <><UserRound size={11} /> 人物{h.snippet ? ` · ${h.snippet}` : ''}</> : '组'}
                      </span>
                    </span>
                  </RacButton>
                </li>
              );
            })}
            {q.trim() && hits.length === 0 && <li className="palette-empty">没找到「{q}」，按回车直接新建</li>}
          </ul>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
