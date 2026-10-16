/**
 * 在线找资料的界面件（M4）：选择框里的在线结果（OnlineOptions）、资料卡上的来源小字（SourceNote）、
 * 编辑资料里的自动补全（AutofillPanel）。逻辑在 lib/lookup.ts 与 core 的 lookup.ts；文案见 docs/COPY.md「资料库 · 在线找」。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button as RacButton, Checkbox } from 'react-aria-components';
import { Check, ChevronLeft, Globe } from 'lucide-react';
import {
  LOOKUP_SOURCES,
  PRIMARY_SOURCE,
  applyAutofill,
  fieldText,
  linksOf,
  lookupCover,
  lookupKindOf,
  lookupQueryOf,
  planAutofill,
  siteIdOf,
  type FieldValue,
  type FillRow,
  type ItemSource,
  type LookupKind,
  type LookupResult,
  type LookupSource,
  type Store,
  type TaskType,
} from '@mindough/core';
import { LookupHttpError, fetchLookupItem, importLookupImage, searchOnline, type OnlineSearchState } from '../../lib/lookup';
import { statusZh } from '../../lib/account';
import { imageUrl } from '../../lib/view';
import { Button } from '../../ui/primitives';
import { ExtLink } from './LinkFields';
import { ItemArt, artShape, type ArtShape, type ItemDraft } from './Library';

import { dataLabel, tr } from '../../lib/i18n';

const sourceLabel = (s: LookupSource) => LOOKUP_SOURCES[s].label;

/** 「503 服务不可用」。 */
const statusText = (code: number | undefined) => (code ? `${code} ${statusZh(code)}`.trim() : '');

/** 在线结果的一行简介：2024 · 剧集 · Dune: Prophecy。 */
export function onlineSubtitle(r: LookupResult): string {
  const kind = typeof r.fields.kind === 'string' ? dataLabel(r.fields.kind) : '';
  return [r.year ? String(r.year) : '', kind, r.subtitle ?? ''].filter(Boolean).join(' · ');
}

/**
 * 在线结果的小图：只在列表里显示（选中后封面由 Worker 拉进 R2）。豆瓣的图不带 Referer 才给看。
 * 不带封面的来源（书：封面纯手填，Rei 2026-10-17）一律用占位图。
 */
function OnlineArt({ r, shape, className = 'lib-option-art' }: { r: LookupResult; shape: ArtShape; className?: string }) {
  const [failed, setFailed] = useState(false);
  const thumb = lookupCover(r).thumb;
  if (!thumb || failed) return <ItemArt src={null} name={r.name} shape={shape} className={className} />;
  return (
    <span className={`art art-${shape} has-image ${className}`} aria-hidden>
      <img src={thumb} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </span>
  );
}

/** 这次问了哪些来源：「TMDB、豆瓣」。没配置的不算在标题里（下面单独提一句）。 */
function headLabel(kind: LookupKind, state: OnlineSearchState): string {
  const asked = state.sources.filter((s) => s.status !== 'unconfigured').map((s) => s.source);
  const list = asked.length ? asked : [PRIMARY_SOURCE[kind]];
  return list.map(sourceLabel).join(tr('、'));
}

/**
 * 选择框里本地结果下方的在线结果：标题「从 TMDB 找」，每行小图 + 名字 + 年份 · 类别 · 原名，右边来源。
 * 键盘上下移动与本地结果连在一起（index 从 start 开始）。
 */
export function OnlineOptions({
  kind,
  state,
  results,
  start,
  active,
  shape,
  optId,
  onHover,
  onChoose,
}: {
  kind: LookupKind;
  state: OnlineSearchState;
  /** 已经去掉库里有的同一条。 */
  results: readonly LookupResult[];
  start: number;
  active: number;
  shape: ArtShape;
  optId: (i: number) => string;
  onHover: (i: number) => void;
  onChoose: (i: number) => void;
}) {
  if (state.status === 'idle') return null;
  const unconfigured = state.sources.find((s) => s.status === 'unconfigured');
  const failed = state.sources.filter((s) => s.status === 'error' || s.status === 'blocked');
  const notes: ReactNode[] = [];
  if (state.status === 'loading' && results.length === 0) notes.push(tr('正在找…'));
  if (state.status === 'error') notes.push(tr('暂时找不到（{status}）', { status: statusText(state.error?.status) || tr('连不上') }));
  if (unconfigured) notes.push(tr('{source} 还没配置', { source: sourceLabel(unconfigured.source) }));
  // 豆瓣是尽力而为：别的来源有结果时不提它
  for (const f of failed) if (results.length === 0 && f.source !== 'douban') notes.push(tr('{source} 暂时连不上（{status}）', { source: sourceLabel(f.source), status: statusText(f.code) }));
  if (state.status === 'done' && results.length === 0 && !unconfigured && failed.length === 0) notes.push(tr('在线也没有找到'));
  return (
    <>
      <li role="presentation" className="lib-picker-group lib-online-head">
        <Globe size={11} aria-hidden />
        {tr('从 {source} 找', { source: headLabel(kind, state) })}
        {state.status === 'loading' && results.length > 0 && <span className="lib-online-spin" aria-label={tr('正在找…')} />}
      </li>
      {results.map((r, j) => {
        const i = start + j;
        return (
          <li
            key={`${r.source}:${r.sourceId}`}
            id={optId(i)}
            data-index={i}
            role="option"
            aria-selected={i === active}
            className={`lib-option lib-option-online${i === active ? ' is-active' : ''}`}
            onMouseMove={() => onHover(i)}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onChoose(i)}
          >
            <OnlineArt r={r} shape={shape} />
            <span className="lib-option-text">
              <span className="lib-option-name">{r.name}</span>
              {onlineSubtitle(r) && <span className="lib-option-sub">{onlineSubtitle(r)}</span>}
            </span>
            <span className="lib-option-meta">{sourceLabel(r.source)}</span>
          </li>
        );
      })}
      {notes.map((n, k) => (
        <li key={`note-${k}`} role="presentation" className="lib-picker-empty lib-online-note">
          {n}
        </li>
      ))}
    </>
  );
}

/** 资料卡上的来源小字：「资料来自 TMDB」，点开是这一条在来源上的页面。 */
export function SourceNote({ source, className }: { source: ItemSource | null | undefined; className?: string }) {
  if (!source) return null;
  return (
    <div className={`source-note${className ? ` ${className}` : ''}`}>
      {tr('资料来自')}{' '}
      <ExtLink href={source.url} label={tr('在 {label} 打开', { label: source.label })}>
        {source.label}
      </ExtLink>
    </div>
  );
}

// ───────────── 自动补全 ─────────────

/** 一个值的显示：编号显示编号、链接显示网站名、空的显示「空」。 */
function valueText(row: FillRow, v: FieldValue | undefined): string {
  if (row.def.kind === 'site_id') return siteIdOf(row.def.site, v) ?? fieldText(v);
  if (row.def.kind === 'links') return linksOf(v).map((l) => l.label || l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')).join(tr('、'));
  if (row.def.kind === 'number' && row.def.unit && fieldText(v)) return `${fieldText(v)} ${dataLabel(row.def.unit)}`;
  return fieldText(v);
}

type Phase =
  | { at: 'loading' }
  | { at: 'pick'; results: LookupResult[]; note?: string }
  | { at: 'review'; result: LookupResult; rows: FillRow[]; chosen: Set<string>; fromPick: LookupResult[] | null }
  | { at: 'message'; text: string };

function errorText(e: unknown, source?: string): string {
  if (e instanceof LookupHttpError) {
    if (e.state === 'unconfigured') return tr('{source} 还没配置', { source: source ?? 'TMDB' });
    if (e.status === 404) return tr('{source} 上没有找到这一条', { source: source ?? '' }).trim();
    return tr('暂时找不到（{status}）', { status: statusText(e.status) || tr('连不上') });
  }
  return tr('暂时找不到（{status}）', { status: tr('连不上') });
}

/**
 * 编辑资料里的「自动补全」：按已填的 IMDb / 豆瓣编号、书的 ISBN 直接取，没有就按名字搜、挑一条
 * （书按名字找到的是作品，只补书名、作者、首版年份、页数，并提示出版社、ISBN 要按 ISBN 取那一版）；
 * 然后逐项列出要填进去的值，空缺的默认勾上，已有值的默认不勾（勾上就覆盖）。
 */
export function AutofillPanel({ store, type, draft, onApply, onCancel }: { store: Store; type: TaskType; draft: ItemDraft; onApply: (d: ItemDraft) => void; onCancel: () => void }) {
  const kind = lookupKindOf(type)!;
  const shape = artShape(type);
  const [phase, setPhase] = useState<Phase>({ at: 'loading' });
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const emptyHint = kind === 'book' ? tr('先填书名，或者 ISBN') : tr('先填名字，或者 IMDb / 豆瓣编号');

  const review = async (r: LookupResult, fromPick: LookupResult[] | null) => {
    setPhase({ at: 'loading' });
    let full = r;
    try {
      ctrl.current = new AbortController();
      full = await fetchLookupItem(r.source, r.sourceId, ctrl.current.signal);
    } catch (e) {
      if (ctrl.current?.signal.aborted) return;
      /* 详情拿不到：用搜索结果 */
    }
    const rows = planAutofill(type, draft, full);
    setPhase({ at: 'review', result: full, rows, chosen: new Set(rows.filter((x) => x.apply).map((x) => x.key)), fromPick });
  };

  useEffect(() => {
    const q = lookupQueryOf(type, draft);
    const c = new AbortController();
    ctrl.current = c;
    const byName = async (raw: string, note?: string) => {
      const nq = lookupQueryOf(type, { name: raw, fields: { ...draft.fields, imdb: null, douban: null, isbn: null } });
      const name = nq?.by === 'name' ? nq.q : '';
      if (nq?.by === 'id') return setPhase({ at: 'message', text: note ?? emptyHint });
      if (!name) return setPhase({ at: 'message', text: note ?? emptyHint });
      try {
        const res = await searchOnline(kind, name, c.signal, undefined, nq?.by === 'name' && nq.media ? { media: nq.media } : {});
        if (c.signal.aborted) return;
        const unconfigured = res.sources.find((s) => s.status === 'unconfigured');
        const extra = unconfigured ? tr('{source} 还没配置', { source: sourceLabel(unconfigured.source) }) : undefined;
        if (!res.results.length) return setPhase({ at: 'message', text: [note, extra ?? tr('没有找到「{name}」', { name })].filter(Boolean).join(tr('；')) });
        setPhase({ at: 'pick', results: res.results.slice(0, 8), ...(note || extra ? { note: [note, extra].filter(Boolean).join(tr('；')) } : {}) });
      } catch (e) {
        if (!c.signal.aborted) setPhase({ at: 'message', text: errorText(e, sourceLabel(PRIMARY_SOURCE[kind])) });
      }
    };
    (async () => {
      if (!q) return setPhase({ at: 'message', text: emptyHint });
      if (q.by === 'id') {
        try {
          const r = await fetchLookupItem(q.source, q.id, c.signal);
          if (c.signal.aborted) return;
          const rows = planAutofill(type, draft, r);
          setPhase({ at: 'review', result: r, rows, chosen: new Set(rows.filter((x) => x.apply).map((x) => x.key)), fromPick: null });
        } catch (e) {
          if (c.signal.aborted) return;
          // 按编号取不到（TMDB 没配置、豆瓣要验证）：退回按名字找
          const label = q.source === 'imdb' ? 'TMDB' : q.source === 'isbn' ? 'Open Library' : tr('豆瓣');
          await byName(draft.name.trim(), tr('按编号没取到：{why}', { why: errorText(e, label) }));
        }
      } else await byName(draft.name);
    })();
    return () => c.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    if (phase.at !== 'review') return;
    setBusy(true);
    const imgRow = phase.rows.find((r) => r.def.media && !r.def.primary);
    let asset: string | null = null;
    if (imgRow && phase.chosen.has(imgRow.key) && typeof imgRow.next === 'string') asset = await importLookupImage(store, imgRow.next, artShape(type));
    setBusy(false);
    onApply(applyAutofill(draft, phase.rows, phase.chosen, phase.result, asset));
  };

  const toggle = (key: string, on: boolean) => {
    if (phase.at !== 'review') return;
    const chosen = new Set(phase.chosen);
    if (on) chosen.add(key);
    else chosen.delete(key);
    setPhase({ ...phase, chosen });
  };

  let body: ReactNode;
  if (phase.at === 'loading') body = <div className="autofill-note">{tr('正在找…')}</div>;
  else if (phase.at === 'message') body = <div className="autofill-note">{phase.text}</div>;
  else if (phase.at === 'pick')
    body = (
      <>
        <div className="autofill-head">{tr('选一条来补全')}</div>
        {phase.note && <div className="autofill-note small">{phase.note}</div>}
        <ul className="autofill-pick" role="listbox" aria-label={tr('选一条来补全')}>
          {phase.results.map((r) => (
            <li key={`${r.source}:${r.sourceId}`} role="option" aria-selected={false}>
              <RacButton className="lib-option autofill-pick-btn" onPress={() => void review(r, phase.results)}>
                <OnlineArt r={r} shape={shape} />
                <span className="lib-option-text">
                  <span className="lib-option-name">{r.name}</span>
                  {onlineSubtitle(r) && <span className="lib-option-sub">{onlineSubtitle(r)}</span>}
                </span>
                <span className="lib-option-meta">{sourceLabel(r.source)}</span>
              </RacButton>
            </li>
          ))}
        </ul>
      </>
    );
  else {
    const r = phase.result;
    body = (
      <>
        <div className="autofill-result">
          <OnlineArt r={{ ...r, thumb: r.thumb ?? r.image }} shape={shape} className="autofill-result-art" />
          <div className="autofill-result-text">
            <div className="autofill-result-name">{r.name}</div>
            {onlineSubtitle(r) && <div className="lib-option-sub">{onlineSubtitle(r)}</div>}
            <SourceNote source={{ source: r.source, sourceId: r.sourceId, label: sourceLabel(r.source), url: r.url }} />
          </div>
        </div>
        {kind === 'book' && r.source === 'openlibrary' && /W$/.test(r.sourceId) && <div className="autofill-note small">{tr('按书名找到的是作品，只补作者、首版年份、页数；要出版社和 ISBN，先填 ISBN 再自动补全')}</div>}
        {phase.rows.length === 0 ? (
          <div className="autofill-note">{tr('没有要补的，资料都已经填好了')}</div>
        ) : (
          <ul className="autofill-rows" aria-label={tr('要填进去的值')}>
            {phase.rows.map((row) => {
              const on = phase.chosen.has(row.key);
              const isImage = !!row.def.media && !row.def.primary;
              const curImg = isImage ? imageUrl(store, row.current as string | null) : null;
              return (
                <li key={row.key}>
                  <Checkbox className="autofill-row" isSelected={on} onChange={(v) => toggle(row.key, v)}>
                    <span className="autofill-check" aria-hidden>
                      {on && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="autofill-label">{dataLabel(row.def.label)}</span>
                    <span className="autofill-values">
                      {isImage ? (
                        <span className="autofill-image">
                          {curImg && <ItemArt src={curImg} name={draft.name} shape={shape} className="autofill-thumb is-old" />}
                          <img className={`autofill-thumb art-${shape}`} src={String(row.next)} alt="" referrerPolicy="no-referrer" />
                        </span>
                      ) : (
                        <>
                          <span className="autofill-next">{valueText(row, row.next)}</span>
                          {row.filled && row.def.kind !== 'links' && <span className="autofill-old">{tr('现在：{v}', { v: valueText(row, row.current) })}</span>}
                        </>
                      )}
                      {row.filled && row.def.kind !== 'links' && <span className="autofill-tag">{on ? tr('覆盖') : tr('已有，不动')}</span>}
                    </span>
                  </Checkbox>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  const count = phase.at === 'review' ? phase.chosen.size : 0;
  return (
    <section className="autofill" aria-label={tr('自动补全')}>
      {body}
      <div className="autofill-actions">
        {phase.at === 'review' && phase.fromPick && (
          <RacButton className="link-btn autofill-back" onPress={() => setPhase({ at: 'pick', results: phase.fromPick! })}>
            <ChevronLeft size={14} aria-hidden />
            {tr('换一条')}
          </RacButton>
        )}
        <span className="grow" />
        <Button variant="secondary" onPress={onCancel}>
          {tr('不用了')}
        </Button>
        {phase.at === 'review' && phase.rows.length > 0 && (
          <Button variant="primary" isDisabled={count === 0 || busy} onPress={() => void apply()}>
            {busy ? tr('正在拉图片…') : tr('填进去 {n} 项', { n: count })}
          </Button>
        )}
      </div>
    </section>
  );
}
