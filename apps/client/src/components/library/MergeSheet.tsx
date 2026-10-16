/**
 * 资料合并（M4）：合并弹层（几条并排对比，挑留下哪条、有冲突的字段各选一个值）、
 * 「合并到…」挑目标、资料库页的「可能重复」逐组确认。逻辑在 core（Store.mergeLibraryItems / mergePeople）。
 * 文案见 docs/COPY.md「资料合并」。
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Check } from 'lucide-react';
import {
  fieldDisplay,
  fieldText,
  formatDateZh,
  isPersonLibrary,
  itemData,
  libraryCopy,
  planItemMerge,
  planPersonMerge,
  type FieldValue,
  type MergeChoices,
  type MergeConflict,
  type MergeResult,
  type Store,
  type TaskType,
} from '@mindough/core';
import { useUi } from '../../lib/ui';
import { imageUrl } from '../../lib/view';
import { Button, Sheet } from '../../ui/primitives';
import { ItemArt, LibraryPicker, artShape } from './Library';

import { tr } from '../../lib/i18n';

interface Candidate {
  id: string;
  name: string;
  image: string | null;
  uses: number;
  /** 各字段的值（资料：itemData 展开；人物：列名）。 */
  values: Record<string, FieldValue>;
}

function useCandidates(store: Store, type: TaskType, ids: readonly string[]): Candidate[] {
  const person = isPersonLibrary(type);
  return ids
    .map((id): Candidate | null => {
      if (person) {
        const p = store.get('person', id);
        return p ? { id, name: p.name, image: p.avatar_asset_id, uses: store.tasksOfPerson(id).length, values: { name: p.name, avatar_asset_id: p.avatar_asset_id, relation: p.relation, birthday: p.birthday } } : null;
      }
      const it = store.get('library_item', id);
      return it ? { id, name: it.name, image: it.image, uses: store.tasksOfItem(id).length, values: itemData(type, it) } : null;
    })
    .filter((c): c is Candidate => !!c);
}

function valueText(c: MergeConflict, v: FieldValue | undefined): string {
  if (c.key === 'birthday' && typeof v === 'string' && v) return formatDateZh(v, false);
  return c.def ? fieldDisplay(c.def, v) : fieldText(v);
}

/** 用当前的目标与选择算合并计划（资料 / 人物）。 */
function plan(store: Store, type: TaskType, targetId: string, others: string[], choices: MergeChoices): MergeConflict[] {
  if (isPersonLibrary(type)) {
    const t = store.get('person', targetId);
    const src = others.map((id) => store.get('person', id)).filter((x) => !!x);
    return t ? planPersonMerge(t, src, choices).conflicts : [];
  }
  const t = store.get('library_item', targetId);
  const src = others.map((id) => store.get('library_item', id)).filter((x) => !!x);
  return t ? planItemMerge(type, t, src, choices).conflicts : [];
}

/**
 * 合并弹层：几条并排（手机上两条也并排，多了横向滚动），点上面的卡片选留下哪条；
 * 下面只列有冲突的字段，每格是那条的值，点一格就用它。没冲突的字段自动合在一起，备注接在后面。
 */
export function MergeSheet({
  store,
  type,
  ids,
  onClose,
  title,
  heading,
  extraActions,
  stayOpen,
  onMerged,
}: {
  store: Store;
  type: TaskType;
  /** 参与合并的条目，第一个是默认留下的。 */
  ids: readonly string[];
  onClose: () => void;
  title?: string;
  /** 弹层正文最上面的一行（「可能重复」里显示第几组、为什么）。 */
  heading?: ReactNode;
  /** 底栏左边的额外按钮（「不是同一个」「跳过」）。 */
  extraActions?: ReactNode;
  /** 合并后不关（「可能重复」接着看下一组）。 */
  stayOpen?: boolean;
  onMerged?: (r: MergeResult) => void;
}) {
  const ui = useUi();
  const person = isPersonLibrary(type);
  const shape = artShape(type);
  const cands = useCandidates(store, type, ids);
  const idsKey = ids.join('|');
  const [targetId, setTargetId] = useState(ids[0] ?? '');
  const [choices, setChoices] = useState<MergeChoices>({});
  useEffect(() => {
    setTargetId(ids[0] ?? '');
    setChoices({});
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = cands.map((c) => c.id).filter((id) => id !== targetId);
  const conflicts = useMemo(() => plan(store, type, targetId, others, choices), [store, store.version, type, targetId, others.join('|'), choices]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = cands.find((c) => c.id === targetId);
  const moving = cands.filter((c) => c.id !== targetId).reduce((n, c) => n + c.uses, 0);
  const cols = { '--merge-cols': String(cands.length), '--chip-color': type.color } as CSSProperties;

  const merge = () => {
    if (!target || !others.length) return;
    try {
      const r = person ? store.mergePeople(targetId, others, choices) : store.mergeLibraryItems(targetId, others, choices);
      const name = (person ? store.get('person', targetId)?.name : store.get('library_item', targetId)?.name) ?? target.name;
      ui.toast({ message: tr('已合并到「{name}」', { name }), actions: [{ label: tr('撤销'), onPress: () => store.undoMerge(r.undo) }] }, 6000);
      onMerged?.(r);
      if (!stayOpen) onClose();
    } catch (e) {
      ui.toast({ message: e instanceof Error ? e.message : String(e), tone: 'error' }, 4000);
    }
  };

  return (
    <Sheet
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={title ?? tr('合并资料')}
      className="modal-merge"
      wide={cands.length > 2}
      footer={
        <>
          {extraActions}
          {!extraActions && moving > 0 && <span className="foot-note">{tr('{n} 件任务会改用留下的这条', { n: moving })}</span>}
          <span className="grow" />
          {!extraActions && (
            <Button variant="secondary" onPress={onClose}>
              {tr('取消')}
            </Button>
          )}
          <Button variant="primary" isDisabled={!target || !others.length} onPress={merge}>
            {tr('合并')}
          </Button>
        </>
      }
    >
      {heading && <div className="merge-heading">{heading}</div>}
      <div className="merge-scroll">
        <div className="merge-grid" style={cols} role="group" aria-label={tr('留下哪一条')}>
          {cands.map((c) => {
            const on = c.id === targetId;
            return (
              <RacButton
                key={c.id}
                className={`merge-cand shape-${shape}${on ? ' is-target' : ''}`}
                aria-pressed={on}
                onPress={() => {
                  setTargetId(c.id);
                  setChoices({});
                }}
              >
                <ItemArt src={imageUrl(store, c.image)} name={c.name} shape={shape} className="merge-cand-art" />
                <span className="merge-cand-name">{c.name}</span>
                <span className="merge-cand-sub">{c.uses ? tr('{uses} 件任务', { uses: c.uses }) : tr('没有任务')}</span>
                <span className={`merge-cand-badge${on ? ' is-on' : ''}`}>
                  {on ? (
                    <>
                      <Check size={12} aria-hidden />
                      {tr('留下')}
                    </>
                  ) : (
                    tr('并进去')
                  )}
                </span>
              </RacButton>
            );
          })}
        </div>
        {conflicts.length > 0 ? (
          <div className="merge-conflicts">
            <div className="merge-section-title">{tr('两边不一样，选一个')}</div>
            {conflicts.map((cf) => {
              const chosen = cf.options.find((o) => o.from === cf.chosen)?.value;
              return (
                <div key={cf.key} className="merge-row" role="group" aria-label={cf.label}>
                  <div className="merge-row-label">{cf.label}</div>
                  <div className="merge-grid" style={cols}>
                    {cands.map((c) => {
                      const v = c.values[cf.key];
                      const has = fieldText(v).trim() !== '' && v !== null;
                      const on = has && JSON.stringify(v) === JSON.stringify(chosen);
                      return (
                        <RacButton
                          key={c.id}
                          className={`merge-cell${on ? ' is-chosen' : ''}${has ? '' : ' is-empty'}`}
                          aria-pressed={on}
                          isDisabled={!has}
                          onPress={() => setChoices((x) => ({ ...x, [cf.key]: c.id }))}
                        >
                          {cf.kind === 'image' ? (
                            has ? (
                              <ItemArt src={imageUrl(store, typeof v === 'string' ? v : null)} name={c.name} shape={shape} className="merge-cell-art" />
                            ) : (
                              <span className="merge-cell-text">—</span>
                            )
                          ) : (
                            <span className="merge-cell-text">{has ? valueText(cf, v) : '—'}</span>
                          )}
                          {on && <Check size={14} className="merge-cell-check" aria-hidden />}
                        </RacButton>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="merge-none">{tr('没有冲突的资料。')}</p>
        )}
      </div>
      <p className="merge-hint">{tr('空着的用另一条补上，备注接在后面。合并后可以撤销。')}</p>
    </Sheet>
  );
}

/** 「合并到…」：先挑同一个库里的另一条（不能新建），再打开合并弹层（挑中的那条默认留下）。 */
export function MergeIntoSheet({ store, type, sourceId, onClose, onMerged }: { store: Store; type: TaskType; sourceId: string; onClose: () => void; onMerged?: (r: MergeResult) => void }) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const copy = libraryCopy(type);
  if (target) return <MergeSheet store={store} type={type} ids={[target, sourceId]} onClose={onClose} {...(onMerged ? { onMerged } : {})} />;
  return (
    <Sheet isOpen onOpenChange={(o) => !o && onClose()} title={tr('合并到…')} className="modal-merge-pick">
      <p className="merge-pick-hint">{tr('选{name}里的另一条，两条合成一条。', { name: copy.name })}</p>
      <LibraryPicker store={store} type={type} query={query} onQueryChange={setQuery} exclude={sourceId} autoFocus allowCreate={false} onPick={(e) => setTarget(e.id)} onCreate={() => {}} />
    </Sheet>
  );
}

/** 「可能重复 N 组」：一组一组看，合并、不是同一个（以后不再提示）或跳过。 */
export function DuplicatesSheet({ store, type, onClose }: { store: Store; type: TaskType; onClose: () => void }) {
  const ui = useUi();
  const [skipped, setSkipped] = useState<string[]>([]);
  const groups = store.duplicateGroups(type.id).filter((g) => !skipped.includes(g.key));
  const total = groups.length + skipped.length;
  const g = groups[0];
  useEffect(() => {
    if (!g) onClose();
  }, [g, onClose]);
  if (!g) return null;
  const n = skipped.length + 1;
  return (
    <MergeSheet
      store={store}
      type={type}
      ids={g.ids}
      onClose={onClose}
      title={tr('可能重复')}
      stayOpen
      heading={
        <>
          <span className="merge-heading-count">{tr('第 {n} 组，共 {total} 组', { n, total })}</span>
          {g.reason && <span className="merge-heading-reason">{g.reason}</span>}
        </>
      }
      extraActions={
        <>
          <Button
            variant="quiet"
            onPress={() => {
              store.dismissDuplicateGroup(g.key);
              ui.toast({ message: tr('这组以后不再提示') }, 2500);
            }}
          >
            {tr('不是同一个')}
          </Button>
          <Button variant="quiet" onPress={() => setSkipped((s) => [...s, g.key])}>
            {tr('跳过')}
          </Button>
        </>
      }
    />
  );
}
