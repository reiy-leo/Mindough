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
    </div>
  );
});

const nodeTypes = { task: TaskNode };

/** 排布：前后关系的边决定分层；相关的两件也当成一条边参与排布，好让它们挨在一起。 */
async function layoutPositions(tasks: Task[], edges: { pred_id: string; succ_id: string }[], direction: 'RIGHT' | 'DOWN') {
  const ids = new Set(tasks.map((t) => t.id));
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.nodeNode': '20',
      'elk.spacing.componentComponent': '36',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: tasks.map((t) => ({ id: t.id, width: NODE_W, height: NODE_H })),
    edges: edges.filter((e) => ids.has(e.pred_id) && ids.has(e.succ_id)).map((e, i) => ({ id: `e${i}`, sources: [e.pred_id], targets: [e.succ_id] })),
  });
  return new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}

function GraphInner({ store, tasks, height }: { store: Store; tasks: Task[]; height: number | string }) {
  const ui = useUi();
  const { layout } = useSettings();
  const allEdges = store.edges();
  const ids = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const edges = useMemo(() => allEdges.filter((e) => ids.has(e.pred_id) && ids.has(e.succ_id)), [allEdges, ids]);
  // 相关任务：无方向、不阻塞，画成没有箭头的点线（和前后关系分开）
  const links = store.taskLinks().filter((l) => ids.has(l.a_task_id) && ids.has(l.b_task_id));
  const layoutEdges = [...edges, ...links.map((l) => ({ pred_id: l.a_task_id, succ_id: l.b_task_id }))];
  const [positions, setPositions] = useState<{ key: string; map: Map<string, { x: number; y: number }> } | null>(null);
  const [dragged, setDragged] = useState<Map<string, { x: number; y: number }>>(new Map());
  const direction = layout === 'mobile' ? 'DOWN' : 'RIGHT';
  const structureKey = `${direction}|${tasks.map((t) => t.id).join(',')}|${layoutEdges.map((e) => `${e.pred_id}>${e.succ_id}`).join(',')}`;

  useEffect(() => {
    let alive = true;
    layoutPositions(tasks, layoutEdges, direction).then((map) => {
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

  for (const l of links)
    flowEdges.push({
      id: `rel:${l.a_task_id}~${l.b_task_id}`,
      source: l.a_task_id,
      target: l.b_task_id,
      type: 'straight',
      className: 'edge-related',
      ariaLabel: '相关（不分先后）',
    });

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
