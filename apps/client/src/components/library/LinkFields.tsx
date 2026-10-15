/**
 * 资料上的链接：站点编号输入（IMDb / 豆瓣：填编号或粘贴整条链接）、更多链接（可增删、可调顺序）、链接小标签。
 * 认编号、认网站名都在 core 的 links.ts。文案见 docs/COPY.md「资料库 · 链接」。
 */
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { ArrowDown, ArrowUp, ExternalLink, Plus, X } from 'lucide-react';
import { SITES, detectLinkLabel, linksOf, normalizeUrl, type FieldDef, type FieldValue, type LinkChip, type LinkValue } from '@mindough/core';
import { Field, Tip } from '../../ui/primitives';

/** 链接打开方式：新标签页（Tauri 里由 webview 交给系统浏览器）。 */
export function ExtLink({ href, className, children, label }: { href: string; className?: string; children: React.ReactNode; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...(label ? { 'aria-label': label } : {})}>
      {children}
    </a>
  );
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** 站点编号：填编号（tt0816692）或直接粘贴整条链接，自动只留编号；格式不对轻提示一句。 */
export function SiteIdInput({ def, value, onChange }: { def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const site = def.site ? SITES[def.site] : undefined;
  const stored = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(stored);
  const [blurred, setBlurred] = useState(stored !== '');
  // 外部改了（换了一条资料）：跟上
  useEffect(() => {
    if (!site) return;
    if (stored !== text && (site.parse(text) ?? (text.trim() || '')) !== stored) setText(stored);
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!site) return <Field label={def.label} value={text} onChange={(v) => (setText(v), onChange(v || null))} />;
  const id = site.parse(text);
  const commit = (t: string) => {
    setText(t);
    const parsed = site.parse(t);
    // 认不出也先存着原文（不丢），只是不显示成链接
    onChange(parsed ?? (t.trim() || null));
  };
  const bad = blurred && text.trim() !== '' && !id;
  return (
    <Field
      label={def.label}
      value={text}
      onChange={(v) => {
        commit(v);
        if (!v.trim()) setBlurred(false);
      }}
      onPaste={(t, e) => {
        const parsed = site.parse(t);
        if (parsed) {
          e.preventDefault();
          commit(parsed);
          setBlurred(true);
        }
      }}
      onBlur={() => {
        setBlurred(true);
        if (id && text !== id) setText(id);
      }}
      placeholder={def.placeholder ?? site.placeholder}
      inputClassName="mono-id"
      isInvalid={bad}
      description={
        bad ? (
          site.hint
        ) : id ? (
          <ExtLink href={site.url(id)} className="field-hint-link">
            {shortUrl(site.url(id))}
            <ExternalLink size={11} aria-hidden />
          </ExtLink>
        ) : null
      }
    />
  );
}

/** 更多链接：每行一条（名字可改，空着就按网址自动认），最后一行粘贴新链接。 */
export function LinksInput({ def, value, onChange }: { def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const links = linksOf(value);
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);
  const labelId = useId();
  const set = (next: LinkValue[]) => onChange(next.length ? next : null);
  const add = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) {
      setBad(raw.trim() !== '');
      return false;
    }
    if (!links.some((l) => l.url === url)) set([...links, { url }]);
    setDraft('');
    setBad(false);
    return true;
  };
  const patch = (i: number, p: Partial<LinkValue>) =>
    set(
      links.map((l, j) => {
        if (j !== i) return l;
        const n = { ...l, ...p };
        if (!n.label?.trim()) delete n.label;
        return n;
      }),
    );
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      add(draft);
    }
  };
  return (
    <div className="field links-field" role="group" aria-labelledby={labelId}>
      <span className="field-label" id={labelId}>
        {def.label}
      </span>
      {links.length > 0 && (
        <ul className="links-list">
          {links.map((l, i) => (
            <li key={`${i}-${l.url}`} className="links-row">
              <input
                className="input links-label"
                aria-label="链接名字"
                value={l.label ?? ''}
                placeholder={detectLinkLabel(l.url)}
                onChange={(e) => patch(i, { label: e.target.value })}
              />
              <input
                className="input links-url"
                aria-label="链接"
                type="url"
                value={l.url}
                onChange={(e) => patch(i, { url: e.target.value })}
                onBlur={(e) => {
                  const u = normalizeUrl(e.target.value);
                  if (u && u !== l.url) patch(i, { url: u });
                }}
              />
              <span className="links-row-actions">
                {links.length > 1 && (
                  <>
                    <Tip content="上移">
                      <RacButton className="icon-btn links-move" aria-label="上移" isDisabled={i === 0} onPress={() => move(i, -1)}>
                        <ArrowUp size={14} />
                      </RacButton>
                    </Tip>
                    <Tip content="下移">
                      <RacButton className="icon-btn links-move" aria-label="下移" isDisabled={i === links.length - 1} onPress={() => move(i, 1)}>
                        <ArrowDown size={14} />
                      </RacButton>
                    </Tip>
                  </>
                )}
                <Tip content="去掉">
                  <RacButton className="icon-btn" aria-label={`去掉 ${l.label || detectLinkLabel(l.url)}`} onPress={() => set(links.filter((_, j) => j !== i))}>
                    <X size={15} />
                  </RacButton>
                </Tip>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="links-add">
        <Plus size={15} className="links-add-icon" aria-hidden />
        <input
          className={`input links-add-input${bad ? ' is-invalid' : ''}`}
          aria-label="添加链接"
          aria-invalid={bad || undefined}
          value={draft}
          placeholder={links.length ? '再粘贴一条链接' : '粘贴链接，比如烂番茄、EXT、TMDB'}
          onChange={(e) => {
            setDraft(e.target.value);
            if (bad) setBad(false);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (normalizeUrl(t) && !draft.trim()) {
              e.preventDefault();
              add(t);
            }
          }}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      {bad && <span className="field-hint is-invalid">这不像链接，以 https:// 开头试试</span>}
    </div>
  );
}

/** 资料上的链接小标签：IMDb、豆瓣，再是更多链接，点开新标签页。 */
export function LinkChips({ links, className }: { links: readonly LinkChip[] | undefined; className?: string }) {
  if (!links?.length) return null;
  return (
    <ul className={`link-chips${className ? ` ${className}` : ''}`} aria-label="链接">
      {links.map((l) => (
        <li key={l.key}>
          <ExtLink href={l.url} className="link-chip" label={`在 ${l.label} 打开`}>
            {l.label}
            <ExternalLink size={11} aria-hidden />
          </ExtLink>
        </li>
      ))}
    </ul>
  );
}
