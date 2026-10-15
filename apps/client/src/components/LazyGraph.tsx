import { lazy, Suspense } from 'react';
import type { Store, Task } from '@mindough/core';

// React Flow + elkjs 体积较大，按需加载
const Graph = lazy(() => import('./DependencyGraph').then((m) => ({ default: m.DependencyGraph })));

export function LazyGraph(props: { store: Store; tasks: Task[]; height: number | string }) {
  return (
    <Suspense fallback={<div className="graph graph-loading" style={{ height: props.height }}>正在加载依赖图…</div>}>
      <Graph {...props} />
    </Suspense>
  );
}
