/** 全局搜索（⌘K / Ctrl+K）：搜正文、类型字段（片名、店名…）、人物、组。 */
import { fieldText, taskTitle } from './preview';
import type { Group, Person, Task, TaskPerson, TaskType } from './types';

export type SearchHit =
  | { kind: 'task'; id: string; title: string; snippet: string; score: number; task: Task }
  | { kind: 'person'; id: string; title: string; snippet: string; score: number; person: Person }
  | { kind: 'group'; id: string; title: string; snippet: string; score: number; group: Group };

export interface SearchIndexInput {
  tasks: readonly Task[];
  types: readonly TaskType[];
  people: readonly Person[];
  groups: readonly Group[];
  taskPeople: readonly TaskPerson[];
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
  const hits: SearchHit[] = [];
  for (const t of input.tasks) {
    if (t.deleted) continue;
    const type = t.type_id ? typeById.get(t.type_id) : undefined;
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
      const done = t.status === '完成' || t.status === '取消' ? -2 : 0;
      hits.push({ kind: 'task', id: t.id, title, snippet: snippetAround(`${t.body_md} ${extra}`, terms[0]!), score: s + titleBoost + done, task: t });
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
