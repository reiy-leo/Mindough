import { useEffect, useMemo, useState } from 'react';
import { Dialog, Input, Modal, ModalOverlay, SearchField, Button as RacButton } from 'react-aria-components';
import { CornerDownLeft, FileDown, FolderOpen, NotebookPen, Plus, Search, Sun, SunDim, UserRound } from 'lucide-react';
import { TASK_STATUS_LABEL, isFinished, libraryCopy, search, type SearchHit } from '@mindough/core';
import { MoodIcon } from './journal/MoodIcon';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { navigate } from '../lib/router';
import { toggleMyDay } from '../lib/actions';
import { viewOf } from '../lib/view';
import { TaskThumb } from './TaskRow';
import { Avatar } from './Avatar';
import { ItemArt, artShape } from './library/Library';
import { imageUrl } from '../lib/view';

import { dataLabel, tr } from '../lib/i18n';
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
        { tasks: store.list('task'), types: store.list('task_type'), people: store.list('person'), groups: store.list('group'), taskPeople: store.list('task_person'), items: store.list('library_item'), journal: store.list('journal_entry') },
        q,
        20,
      ),
    [q, store, store.version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const recent = useMemo(() => (q ? [] : store.tasks().filter((t) => !isFinished(t.status)).slice(-6).reverse()), [q, store, store.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => ui.setPaletteOpen(false);
  // 「写今天的日记」：没输入时排最前；输入像「日记 / journal / 写」时也出来
  const showJournal = !q.trim() || /日记|journal|diary|^写/i.test(q.trim()); // i18n-ignore 匹配用的关键词
  const writeJournal = () => {
    close();
    navigate({ page: 'journal' });
  };
  // 「从滴答清单导入…」：没输入时排在日记后面；输入像「滴答 / dida / ticktick / 导入 / import」时也出来
  const showDida = !q.trim() || /滴答|dida|tick|导入|import/i.test(q.trim()); // i18n-ignore 匹配用的关键词
  const importDida = () => {
    close();
    ui.setDidaImportOpen(true);
  };
  const journalIndex = q.trim() ? 1 : 0;
  const didaIndex = journalIndex + (showJournal ? 1 : 0);
  const offset = didaIndex + (showDida ? 1 : 0);
  const createFromQuery = () => {
    const t = store.createTask({ body_md: q.trim() });
    store.addToMyDay(t.id);
    ui.toast({ tone: 'success', message: tr('已新建并加入我的一天：「{trim}」', { trim: q.trim() }) }, 3000);
    close();
  };
  const openHit = (h: SearchHit) => {
    close();
    if (h.kind === 'task') ui.openEditor(h.id);
    else if (h.kind === 'person') navigate({ page: 'person', id: h.id });
    else if (h.kind === 'item') navigate({ page: 'libitem', typeId: h.item.type_id, id: h.id });
    else if (h.kind === 'journal') navigate({ page: 'journal', date: h.entry.date });
    else navigate({ page: 'group', id: h.id });
  };
  const count = offset + (q ? hits.length : recent.length);

  const taskItem = (id: string, title: string, snippet: string, index: number) => {
    const t = store.get('task', id);
    if (!t) return null;
    const v = viewOf(store, t);
    const inDay = store.isInMyDay(id);
    return (
      <li key={id} className={`palette-item${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)}>
        <RacButton className="palette-main" onPress={() => { close(); ui.openEditor(id); }}>
          <TaskThumb media={v.media} layout={v.type?.layout ?? 'text'} isAvatar={v.mediaIsAvatar} color={v.type?.color} icon={v.type?.icon} name={v.artName} />
          <span className="palette-text">
            <span className="palette-title">{title}</span>
            <span className="palette-snippet">
              {v.type && v.type.layout !== 'text' ? `${dataLabel(v.type.name)} · ` : ''}
              {TASK_STATUS_LABEL[t.status]}
              {snippet ? ` · ${snippet}` : ''}
            </span>
          </span>
        </RacButton>
        <RacButton className={`btn btn-tonal palette-add${inDay ? ' is-on' : ''}`} onPress={() => toggleMyDay(store, ui, id)} aria-label={inDay ? tr('移出我的一天') : tr('加入我的一天')}>
          {inDay ? <Sun size={15} /> : <SunDim size={15} />}
          {inDay ? tr('已在今天') : tr('加入我的一天')}
        </RacButton>
      </li>
    );
  };

  return (
    <ModalOverlay isOpen={ui.paletteOpen} onOpenChange={ui.setPaletteOpen} isDismissable className="overlay overlay-top">
      <Modal className="modal palette">
        <Dialog aria-label={tr('搜索')} className="dialog">
          <SearchField
            aria-label={tr('搜索任务、资料库、人物、组')}
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
              else if (showJournal && active === journalIndex) writeJournal();
              else if (showDida && active === didaIndex) importDida();
              else if (!q) {
                const t = recent[active - offset];
                if (t) {
                  close();
                  ui.openEditor(t.id);
                }
              } else {
                const h = hits[active - offset];
                if (h) openHit(h);
              }
            }}
          >
            <Search size={18} className="palette-icon" aria-hidden />
            <Input className="palette-input" placeholder={tr('搜索任务、资料库、人物、组…')} />
            <kbd className="kbd">Esc</kbd>
          </SearchField>
          <ul className="palette-list">
            {q.trim() && (
              <li className={`palette-item${active === 0 ? ' is-active' : ''}`} onMouseEnter={() => setActive(0)}>
                <RacButton className="palette-main" onPress={createFromQuery}>
                  <span className="thumb thumb-icon"><Plus size={16} /></span>
                  <span className="palette-text">
                    <span className="palette-title">{tr('新建「{trim}」并加入我的一天', { trim: q.trim() })}</span>
                  </span>
                  <CornerDownLeft size={14} className="muted" />
                </RacButton>
              </li>
            )}
            {showJournal && (
              <li className={`palette-item${active === journalIndex ? ' is-active' : ''}`} onMouseEnter={() => setActive(journalIndex)}>
                <RacButton className="palette-main" onPress={writeJournal}>
                  <span className="thumb thumb-icon"><NotebookPen size={16} /></span>
                  <span className="palette-text">
                    <span className="palette-title">{tr('写今天的日记')}</span>
                  </span>
                </RacButton>
              </li>
            )}
            {showDida && (
              <li className={`palette-item${active === didaIndex ? ' is-active' : ''}`} onMouseEnter={() => setActive(didaIndex)}>
                <RacButton className="palette-main" onPress={importDida}>
                  <span className="thumb thumb-icon"><FileDown size={16} /></span>
                  <span className="palette-text">
                    <span className="palette-title">{tr('从滴答清单导入…')}</span>
                  </span>
                </RacButton>
              </li>
            )}
            {!q && recent.length > 0 && <li className="palette-group">{tr('最近的任务')}</li>}
            {recent.map((t, i) => taskItem(t.id, viewOf(store, t).title, '', i + offset))}
            {hits.map((h, i) => {
              const index = i + offset;
              if (h.kind === 'task') return taskItem(h.id, h.title, h.snippet, index);
              if (h.kind === 'journal')
                return (
                  <li key={h.id} className={`palette-item${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)}>
                    <RacButton className="palette-main" onPress={() => openHit(h)}>
                      <span className="thumb thumb-icon">{h.entry.mood ? <MoodIcon mood={h.entry.mood} size={22} /> : <NotebookPen size={16} />}</span>
                      <span className="palette-text">
                        <span className="palette-title">{h.title}</span>
                        <span className="palette-snippet">
                          {tr('日记')}
                          {h.snippet ? ` · ${h.snippet}` : ''}
                        </span>
                      </span>
                    </RacButton>
                  </li>
                );
              if (h.kind === 'item')
                return (
                  <li key={h.id} className={`palette-item${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)}>
                    <RacButton className="palette-main" onPress={() => openHit(h)}>
                      <ItemArt src={imageUrl(store, h.item.image)} name={h.title} shape={artShape(h.type)} className="palette-art" />
                      <span className="palette-text">
                        <span className="palette-title">{h.title}</span>
                        <span className="palette-snippet">
                          {h.type ? libraryCopy(h.type).name : tr('资料库')}
                          {h.snippet ? ` · ${h.snippet}` : ''}
                        </span>
                      </span>
                    </RacButton>
                    <RacButton
                      className="btn btn-tonal palette-add"
                      onPress={() => {
                        close();
                        ui.openQuickCreate({ type_id: h.item.type_id, library_item_id: h.id });
                      }}
                    >
                      <Plus size={15} />
                      {tr('用它新建任务')}</RacButton>
                  </li>
                );
              return (
                <li key={h.id} className={`palette-item${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)}>
                  <RacButton className="palette-main" onPress={() => openHit(h)}>
                    {h.kind === 'person' ? <Avatar store={store} person={h.person} size={32} /> : h.kind === 'group' ? <span className="thumb thumb-icon">{h.group.icon || <FolderOpen size={16} />}</span> : null}
                    <span className="palette-text">
                      <span className="palette-title">{h.title}</span>
                      <span className="palette-snippet">
                        {h.kind === 'person' ? <><UserRound size={11} /> {tr('人物')}{h.snippet ? ` · ${h.snippet}` : ''}</> : tr('组')}
                      </span>
                    </span>
                  </RacButton>
                </li>
              );
            })}
            {q.trim() && hits.length === 0 && <li className="palette-empty">{tr('没找到「{q}」，按回车直接新建', { q })}</li>}
          </ul>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
