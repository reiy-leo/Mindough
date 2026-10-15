/**
 * 关系图排布：相关任务（不分先后）并排放——同一层里挨着，中间一条点线。
 *
 * 做法：把相关的几件合成一个「并排组」交给 elk 当一个节点排（大小 = 几件并排），排完再把组里各件按顺序摆开。
 * 两组之间有前后关系的路径时不合（合了会在图里绕圈），这一条相关就只画线、不并排。
 */
export interface PairEdge {
  pred_id: string;
  succ_id: string;
}

/** 按相关关系把任务分成并排组（只含 2 件以上的组），组内按 order 里的先后。 */
export function relatedClusters(order: readonly string[], edges: readonly PairEdge[], links: readonly { a: string; b: string }[]): string[][] {
  const ids = new Set(order);
  const out = new Map<string, string[]>();
  for (const e of edges) if (ids.has(e.pred_id) && ids.has(e.succ_id)) (out.get(e.pred_id) ?? out.set(e.pred_id, []).get(e.pred_id)!).push(e.succ_id);
  const parent = new Map(order.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const members = (root: string) => order.filter((id) => find(id) === root);
  // 从 from 组出发沿前后关系能不能走到 to 组
  const reaches = (from: Set<string>, to: Set<string>) => {
    const seen = new Set<string>();
    const stack = [...from];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of out.get(n) ?? []) {
        if (to.has(m)) return true;
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    return false;
  };
  for (const { a, b } of links) {
    if (!ids.has(a) || !ids.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    const A = new Set(members(ra));
    const B = new Set(members(rb));
    if (reaches(A, B) || reaches(B, A)) continue;
    parent.set(rb, ra);
  }
  const groups = new Map<string, string[]>();
  for (const id of order) (groups.get(find(id)) ?? groups.set(find(id), []).get(find(id))!).push(id);
  return [...groups.values()].filter((g) => g.length > 1);
}
