/** 全局搜索（⌘K / Ctrl+K）：搜正文、类型字段（片名、店名…）、资料库、人物、组。 */
import { fieldText, taskTitle } from './preview';
import { itemSubtitle, mergedData } from './library';
import { isFinished, type Group, type LibraryItem, type Person, type Task, type TaskPerson, type TaskType } from './types';

export type SearchHit =
  | { kind: 'task'; id: string; title: string; snippet: string; score: number; task: Task }
  | { kind: 'person'; id: string; title: string; snippet: string; score: number; person: Person }
  | { kind: 'group'; id: string; title: string; snippet: string; score: number; group: Group }
  | { kind: 'item'; id: string; title: string; snippet: string; score: number; item: LibraryItem; type: TaskType | undefined };

export interface SearchIndexInput {
  tasks: readonly Task[];
  types: readonly TaskType[];
  people: readonly Person[];
  groups: readonly Group[];
  taskPeople: readonly TaskPerson[];
  /** 资料库条目：任务按它补全片名等字段，条目本身也能搜到。 */
  items?: readonly LibraryItem[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFKC');

function scoreText(hay: string, terms: string[]): number {
  const h = norm(hay);
  let score = 0;
  for (const t of terms) {
    const i = h.indexOf(t);
    if (i < 0) return 0;
    score += i === 0 ? 3 : 1;
  }
  return score;
}

function snippetAround(text: string, term: string, radius = 24): string {
  // 去掉 markdown 标记（# 标题、> 引用、- [ ] 清单、**粗体**）再取片段
  const flat = text
    .replace(/(^|\n)\s*(#{1,6}|>|[-*+](\s+\[[ xX]\])?|\d+[.)])\s+/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const i = norm(flat).indexOf(term);
  if (i < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  return (start > 0 ? '…' : '') + flat.slice(start, i + term.length + radius) + (i + term.length + radius < flat.length ? '…' : '');
}

export function search(input: SearchIndexInput, query: string, limit = 30): SearchHit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const typeById = new Map(input.types.map((t) => [t.id, t]));
  const personById = new Map(input.people.filter((p) => !p.deleted).map((p) => [p.id, p]));
  const groupById = new Map(input.groups.filter((g) => !g.deleted).map((g) => [g.id, g]));
  const peopleOfTask = new Map<string, string[]>();
  for (const tp of input.taskPeople) {
    if (tp.deleted) continue;
    const name = personById.get(tp.person_id)?.name;
    if (name) peopleOfTask.set(tp.task_id, [...(peopleOfTask.get(tp.task_id) ?? []), name]);
  }
  const itemById = new Map((input.items ?? []).filter((i) => !i.deleted).map((i) => [i.id, i]));
  const hits: SearchHit[] = [];
  for (const it of itemById.values()) {
    const type = typeById.get(it.type_id);
    const sub = itemSubtitle(type, it.fields);
    const s = scoreText(`${it.name} ${Object.values(it.fields).map(fieldText).join(' ')} ${it.note_md}`, terms);
    if (s > 0) hits.push({ kind: 'item', id: it.id, title: it.name, snippet: sub, score: s + (scoreText(it.name, terms) > 0 ? 6 : 0), item: it, type });
  }
  for (const t0 of input.tasks) {
    if (t0.deleted) continue;
    const type = t0.type_id ? typeById.get(t0.type_id) : undefined;
    const item = t0.library_item_id ? itemById.get(t0.library_item_id) : undefined;
    const t = item ? { ...t0, type_data: mergedData(type, t0, item) } : t0;
    const fields = Object.entries(t.type_data)
      .map(([k, v]) => {
        const def = type?.fields.find((f) => f.key === k);
        if (def?.kind === 'person' && typeof v === 'string') return personById.get(v)?.name ?? '';
        if (def?.kind === 'image') return '';
        return fieldText(v);
      })
      .join(' ');
    const extra = [fields, (peopleOfTask.get(t.id) ?? []).join(' '), t.group_id ? (groupById.get(t.group_id)?.name ?? '') : ''].join(' ');
    const title = taskTitle(t, type, (def, v) => (def.kind === 'person' && typeof v === 'string' ? (personById.get(v)?.name ?? '') : fieldText(v)));
    const s = scoreText(`${title} ${t.body_md} ${extra}`, terms);
    if (s > 0) {
      const titleBoost = scoreText(title, terms) > 0 ? 5 : 0;
      const done = isFinished(t.status) ? -2 : 0;
      // 片段只取内容里命中的那段；资料字段（年份、平台…）不拼进片段，免得一长串
      const inBody = norm(t.body_md).includes(terms[0]!);
      hits.push({ kind: 'task', id: t.id, title, snippet: inBody ? snippetAround(t.body_md, terms[0]!) : '', score: s + titleBoost + done, task: t0 });
    }
  }
  for (const p of personById.values()) {
    const s = scoreText(`${p.name} ${p.relation ?? ''} ${p.note_md}`, terms);
    if (s > 0) hits.push({ kind: 'person', id: p.id, title: p.name, snippet: p.relation ?? '', score: s + 4, person: p });
  }
  for (const g of groupById.values()) {
    const s = scoreText(g.name, terms);
    if (s > 0) hits.push({ kind: 'group', id: g.id, title: g.name, snippet: '组', score: s + 4, group: g });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
