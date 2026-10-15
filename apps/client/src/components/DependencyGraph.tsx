import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Check, CircleSlash, Lock, Play } from 'lucide-react';
import type { Store, Task } from '@mindough/core';
import { useUi } from '../lib/ui';
import { tryAddDependency } from '../lib/actions';
import { STATE_CLASS, viewOf } from '../lib/view';
import { useSettings } from '../lib/settings';
import { TaskThumb } from './TaskRow';
import { relatedClusters } from '../lib/graph-layout';

const elk = new ELK();
const NODE_W = 220;
const NODE_H = 64;

interface NodeData extends Record<string, unknown> {
  title: string;
  state: string;
  sub: string;
  media: string | null;
  layout: string;
  isAvatar: boolean;
  artName: string | null;
  color?: string;
  icon?: string;
  /** 并排的相关任务之间的点线从侧边连：向下排时左右，向右排时上下。 */
  relSide: 'h' | 'v';
}

const STATE_LABEL: Record<string, string> = { 完成: '完成', 关闭: '已关闭', 可开始: '可开始', 被阻塞: '还不能开始' };

const TaskNode = memo(function TaskNode({ data, targetPosition, sourcePosition }: NodeProps<Node<NodeData>>) {
  const Icon = data.state === '完成' ? Check : data.state === '关闭' ? CircleSlash : data.state === '被阻塞' ? Lock : Play;
  return (
    <div className={`graph-node ${STATE_CLASS[data.state] ?? ''}`}>
      <Handle type="target" position={targetPosition ?? Position.Left} className="graph-handle" />
      <TaskThumb media={data.media} layout={data.layout} isAvatar={data.isAvatar} color={data.color} icon={data.icon} name={data.artName} />
      <div className="graph-node-text">
        <div className="graph-node-title">{data.title}</div>
        <div className="graph-node-sub">
          <Icon size={11} />
          {STATE_LABEL[data.state] ?? data.state}
          {data.sub && ` · ${data.sub}`}
        </div>
      </div>
      <Handle type="source" position={sourcePosition ?? Position.Right} className="graph-handle" />
      <Handle type="source" id="rel-out" position={data.relSide === 'h' ? Position.Right : Position.Bottom} className="graph-handle graph-handle-rel" isConnectable={false} />
      <Handle type="target" id="rel-in" position={data.relSide === 'h' ? Position.Left : Position.Top} className="graph-handle graph-handle-rel" isConnectable={false} />
    </div>
  );
});

const nodeTypes = { task: TaskNode };

const CLUSTER_GAP = 28;

/**
 * 排布：前后关系的边决定分层；相关的几件合成一个并排组（lib/graph-layout），在同一层里挨着放。
 * 向右排时并排 = 上下叠在同一列；向下排（手机）时并排 = 左右挨着。
 */
async function layoutPositions(tasks: Task[], edges: { pred_id: string; succ_id: string }[], links: { a: string; b: string }[], direction: 'RIGHT' | 'DOWN') {
  const ids = new Set(tasks.map((t) => t.id));
  const clusters = relatedClusters(tasks.map((t) => t.id), edges, links);
  const clusterOf = new Map<string, number>();
  clusters.forEach((g, i) => g.forEach((id) => clusterOf.set(id, i)));
  const nodeOf = (id: string) => (clusterOf.has(id) ? `cluster:${clusterOf.get(id)}` : id);
  const across = (n: number) => n * (direction === 'RIGHT' ? NODE_H : NODE_W) + (n - 1) * CLUSTER_GAP;
  const children = [
    ...tasks.filter((t) => !clusterOf.has(t.id)).map((t) => ({ id: t.id, width: NODE_W, height: NODE_H })),
    ...clusters.map((g, i) => ({ id: `cluster:${i}`, width: direction === 'RIGHT' ? NODE_W : across(g.length), height: direction === 'RIGHT' ? across(g.length) : NODE_H })),
  ];
  const seen = new Set<string>();
  const elkEdges = [];
  for (const e of edges) {
    if (!ids.has(e.pred_id) || !ids.has(e.succ_id)) continue;
    const s = nodeOf(e.pred_id);
    const t = nodeOf(e.succ_id);
    if (s === t || seen.has(`${s}>${t}`)) continue;
    seen.add(`${s}>${t}`);
    elkEdges.push({ id: `e${elkEdges.length}`, sources: [s], targets: [t] });
  }
  // 没能并排的相关（两组间有前后关系路径）也当一条边，好让它们靠近
  for (const l of links) {
    if (!ids.has(l.a) || !ids.has(l.b)) continue;
    const s = nodeOf(l.a);
    const t = nodeOf(l.b);
    if (s === t || seen.has(`${s}>${t}`) || seen.has(`${t}>${s}`)) continue;
    seen.add(`${s}>${t}`);
    elkEdges.push({ id: `e${elkEdges.length}`, sources: [s], targets: [t] });
  }
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.nodeNode': '20',
      'elk.spacing.componentComponent': '36',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // 几块互不相连的图怎么摆：手机竖屏往下叠，桌面横着排
      'elk.aspectRatio': direction === 'DOWN' ? '0.45' : '1.8',
    },
    children,
    edges: elkEdges,
  });
  const map = new Map<string, { x: number; y: number }>();
  for (const c of res.children ?? []) {
    const x = c.x ?? 0;
    const y = c.y ?? 0;
    if (!c.id.startsWith('cluster:')) {
      map.set(c.id, { x, y });
      continue;
    }
    const g = clusters[Number(c.id.slice(8))] ?? [];
    g.forEach((id, i) => map.set(id, direction === 'RIGHT' ? { x, y: y + i * (NODE_H + CLUSTER_GAP) } : { x: x + i * (NODE_W + CLUSTER_GAP), y }));
  }
  return map;
}

function GraphInner({ store, tasks, height }: { store: Store; tasks: Task[]; height: number | string }) {
  const ui = useUi();
  const { layout } = useSettings();
  const allEdges = store.edges();
  const ids = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const edges = useMemo(() => allEdges.filter((e) => ids.has(e.pred_id) && ids.has(e.succ_id)), [allEdges, ids]);
  // 相关任务：无方向、不阻塞，画成没有箭头的点线（和前后关系分开）
  const links = store.taskLinks().filter((l) => ids.has(l.a_task_id) && ids.has(l.b_task_id));
  const layoutLinks = links.map((l) => ({ a: l.a_task_id, b: l.b_task_id }));
  const [positions, setPositions] = useState<{ key: string; map: Map<string, { x: number; y: number }> } | null>(null);
  const [dragged, setDragged] = useState<Map<string, { x: number; y: number }>>(new Map());
  const direction = layout === 'mobile' ? 'DOWN' : 'RIGHT';
  const structureKey = `${direction}|${tasks.map((t) => t.id).join(',')}|${edges.map((e) => `${e.pred_id}>${e.succ_id}`).join(',')}|${layoutLinks.map((l) => `${l.a}~${l.b}`).join(',')}`;

  useEffect(() => {
    let alive = true;
    layoutPositions(tasks, edges, layoutLinks, direction).then((map) => {
      if (!alive) return;
      setPositions((prev) => {
        // 结构变了（加/删节点或边）才重新铺排；只是状态变化时保留拖动后的位置
        if (prev && prev.key !== structureKey) setDragged(new Map());
        return { key: structureKey, map };
      });
    });
    return () => {
      alive = false;
    };
  }, [structureKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes: Node<NodeData>[] = tasks.map((t) => {
    const v = viewOf(store, t);
    const state = v.derived?.state ?? '可开始';
    return {
      id: t.id,
      type: 'task',
      position: dragged.get(t.id) ?? positions?.map.get(t.id) ?? { x: 0, y: 0 },
      targetPosition: direction === 'RIGHT' ? Position.Left : Position.Top,
      sourcePosition: direction === 'RIGHT' ? Position.Right : Position.Bottom,
      data: {
        title: v.title,
        state,
        sub: state === '被阻塞' ? `还在等 ${v.derived!.missing.length} 件事` : (v.group?.name ?? ''),
        media: v.media,
        layout: v.type?.layout ?? 'text',
        isAvatar: v.mediaIsAvatar,
        artName: v.artName,
        color: v.type?.color,
        icon: v.type?.icon,
        relSide: direction === 'DOWN' ? 'h' : 'v',
      },
      style: { width: NODE_W },
    };
  });

  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const flowEdges: Edge[] = edges.map((e) => {
    const done = status.get(e.pred_id) === '完成';
    return {
      id: `${e.pred_id}>${e.succ_id}`,
      source: e.pred_id,
      target: e.succ_id,
      type: 'smoothstep',
      animated: !done && store.derived().get(e.pred_id)?.state === '可开始' && status.get(e.pred_id) === '进行中',
      className: done ? 'edge-done' : 'edge-pending',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    };
  });

  // 并排组里相邻的两件用侧边的点连（直线），其余的相关照常从进出点连
  const clusterIndex = new Map<string, number>();
  for (const g of relatedClusters(tasks.map((t) => t.id), edges, layoutLinks)) g.forEach((id, i) => clusterIndex.set(id, i));
  for (const l of links) {
    const ia = clusterIndex.get(l.a_task_id);
    const ib = clusterIndex.get(l.b_task_id);
    const side = ia !== undefined && ib !== undefined && Math.abs(ia - ib) === 1;
    const [src, dst] = side && ib! < ia! ? [l.b_task_id, l.a_task_id] : [l.a_task_id, l.b_task_id];
    flowEdges.push({
      id: `rel:${l.a_task_id}~${l.b_task_id}`,
      source: src,
      target: dst,
      ...(side ? { sourceHandle: 'rel-out', targetHandle: 'rel-in' } : {}),
      type: side ? 'straight' : 'smoothstep',
      className: 'edge-related',
      ariaLabel: '相关（不分先后）',
    });
  }

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) tryAddDependency(store, ui, c.source, c.target);
  }, [store, ui]);

  if (!positions) return <div className="graph graph-loading" style={{ height }}>正在排布…</div>;
  return (
    <div className="graph" style={{ height }}>
      <ReactFlow
        key={`${direction}-${tasks.length}`}
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onNodesChange={(changes) => {
          const next = new Map(dragged);
          for (const ch of changes) if (ch.type === 'position' && ch.position) next.set(ch.id, ch.position);
          if (next.size !== dragged.size || changes.some((c) => c.type === 'position')) setDragged(next);
        }}
        onEdgesDelete={(es) => es.forEach((e) => (e.id.startsWith('rel:') ? store.unlinkTasks(e.source, e.target) : store.removeDependency(e.source, e.target)))}
        onNodeDoubleClick={(_, n) => ui.openEditor(n.id)}
        onNodeClick={(_, n) => layout === 'mobile' && ui.openEditor(n.id)}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: layout === 'mobile' ? 0.9 : 1.1 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--graph-dot)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

export function DependencyGraph(props: { store: Store; tasks: Task[]; height: number | string }) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
