// SPDX-License-Identifier: Apache-2.0
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position, ReactFlow, useReactFlow,
  type Connection, type Edge, type EdgeChange, type EdgeProps, type Node, type NodeChange, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { blockBody, blockOf, childNodes, isContainerNode } from "../../psp/model";
import { kindOf } from "../../psp/kinds";
import { truncate } from "../../lib/format";
import { useEditor } from "./editor";

export const NODE_TYPE_MIME = "application/x-psp-node-type";

type CardData = {
  key: string; label: string; tone: string; summary: string; entry: boolean; container: boolean; childCount: number;
  agents: number; signed: boolean; output: boolean; missing: boolean;
};
type CardNode = Node<CardData, "psp">;
type TransitionData = { order: number; condition: string | null; priority: number | null; offset: number; dangling: boolean };
type TransitionEdgeType = Edge<TransitionData, "transition">;

function NodeCard({ data, selected }: NodeProps<CardNode>) {
  const editor = useEditor();
  if (data.missing) {
    return (
      <div className={`psp-node missing${selected ? " selected" : ""}`} title="No node with this id exists in this scope" aria-label={`Missing node ${data.key}`}>
        <Handle type="target" position={Position.Left} />
        <div className="psp-node-head"><span className="psp-node-type">missing</span></div>
        <div className="psp-node-id">{data.key}</div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }
  return (
    <div className={`psp-node tone-${data.tone}${selected ? " selected" : ""}`} aria-label={`${data.label} node ${data.key}`}>
      <Handle type="target" position={Position.Left} />
      <div className="psp-node-head">
        <span className="psp-node-type">{data.label}</span>
        {data.entry && <span className="psp-chip" title="The first node in this scope: PSP's usual entry point">start</span>}
      </div>
      <div className="psp-node-id">{data.key}</div>
      {data.summary && <div className="psp-node-summary">{data.summary}</div>}
      <div className="psp-node-foot">
        {data.output && <span className="psp-chip" title="Declares an output schema">output</span>}
        {data.agents > 0 && <span className="psp-chip" title="Declared agents">{data.agents} agent{data.agents === 1 ? "" : "s"}</span>}
        {data.signed && <span className="psp-chip warn" title="Carries a stored signature">signed</span>}
        <span className="spacer" />
        {data.container && (
          <button type="button" className="nodrag psp-open" onClick={e => { e.stopPropagation(); editor.openScope([...editor.scope, data.key]); }}>
            Open ({data.childCount}) ›
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/** A cubic edge that fans out parallel transitions and draws a loop for a node that routes to itself. */
function TransitionEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<TransitionEdgeType>) {
  const editor = useEditor();
  const offset = data?.offset ?? 0;
  let path: string, x: number, y: number;
  if (source === target) {
    const lift = 90 + Math.abs(offset) * 1.5;
    path = `M ${sourceX} ${sourceY} C ${sourceX + 90} ${sourceY - lift}, ${targetX - 90} ${targetY - lift}, ${targetX} ${targetY}`;
    x = (sourceX + targetX) / 2; y = (sourceY + targetY) / 2 - lift * 0.75;
  } else {
    const dx = Math.max(70, Math.abs(targetX - sourceX) / 2);
    const c1 = [sourceX + dx, sourceY + offset], c2 = [targetX - dx, targetY + offset];
    path = `M ${sourceX} ${sourceY} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${targetX} ${targetY}`;
    x = (sourceX + 3 * c1[0]! + 3 * c2[0]! + targetX) / 8; y = (sourceY + 3 * c1[1]! + 3 * c2[1]! + targetY) / 8;
  }
  const condition = data?.condition ?? null;
  return (
    <>
      <BaseEdge id={id} path={path} {...(markerEnd ? { markerEnd } : {})} className={data?.dangling ? "dangling" : undefined} />
      <EdgeLabelRenderer>
        <button type="button" className={`psp-edge-label nodrag nopan${selected ? " selected" : ""}`} title={condition ?? "No condition"}
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
          aria-label={`Transition ${source} to ${target}${condition ? `: ${condition}` : ""}`}
          onClick={e => { e.stopPropagation(); editor.select({ kind: "edge", key: id }); }}>
          <span className="psp-edge-order">{data?.order ?? ""}</span>
          <span className={condition ? undefined : "muted"}>{condition ? truncate(condition, 42) : "no condition"}</span>
          {data?.priority !== null && data?.priority !== undefined && <span className="psp-chip">p{data.priority}</span>}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { psp: NodeCard };
const edgeTypes = { transition: TransitionEdge };
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

/** The diagram for one scope. Positions come from the layout sidecar; everything else from the PSP text. */
export function Canvas() {
  const editor = useEditor();
  const flow = useReactFlow();
  const { graph, positions, selection } = editor;
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const dragging = useRef(false);

  const nodes = useMemo<CardNode[]>(() => {
    const real = graph.nodes.map(n => {
      const kind = kindOf(n.nodeType);
      const system = blockOf(n.section, "system");
      const agents = (n.section.attributes.agents ?? "").split(",").map(s => s.trim()).filter(Boolean).length;
      const data: CardData = {
        key: n.key, label: kind.label === "Node" ? n.nodeType || "node" : kind.label, tone: kind.tone,
        summary: system ? truncate(blockBody(system).replace(/\s+/g, " "), 90) : "", entry: graph.entry === n.key,
        container: isContainerNode(n.section), childCount: childNodes(editor.doc, n.path).length, agents,
        signed: !!system?.attributes.signature, output: !!blockOf(n.section, "output-schema"), missing: false
      };
      return { id: n.key, type: "psp" as const, position: positions[n.key] ?? { x: 0, y: 0 }, data, selected: selection?.kind === "node" && selection.key === n.key, ...(measured[n.key] ? { measured: measured[n.key] } : {}) };
    });
    const ghosts = graph.missing.map(key => ({
      id: key, type: "psp" as const, position: positions[key] ?? { x: 0, y: 0 }, selected: selection?.kind === "missing" && selection.key === key,
      data: { key, label: "missing", tone: "missing", summary: "", entry: false, container: false, childCount: 0, agents: 0, signed: false, output: false, missing: true },
      ...(measured[key] ? { measured: measured[key] } : {})
    }));
    return [...real, ...ghosts];
  }, [graph, positions, selection, measured, editor.doc]);

  const edges = useMemo<TransitionEdgeType[]>(() => {
    const pairs = new Map<string, string[]>(), order = new Map<string, number>();
    for (const e of graph.edges) {
      const pair = `${e.source}\u0000${e.target}`;
      (pairs.get(pair) ?? pairs.set(pair, []).get(pair)!).push(e.key);
    }
    const known = new Set(graph.nodes.map(n => n.key));
    return graph.edges.map(e => {
      const siblings = pairs.get(`${e.source}\u0000${e.target}`)!, i = siblings.indexOf(e.key);
      const n = (order.get(e.source) ?? 0) + 1; order.set(e.source, n);
      return {
        id: e.key, source: e.source, target: e.target, type: "transition" as const, selected: selection?.kind === "edge" && selection.key === e.key,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        data: { order: n, condition: e.condition, priority: e.priority, offset: (i - (siblings.length - 1) / 2) * 44, dangling: !known.has(e.target) || !known.has(e.source) }
      };
    });
  }, [graph, selection]);

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        const d = c.dimensions;
        setMeasured(m => m[c.id]?.width === d.width && m[c.id]?.height === d.height ? m : { ...m, [c.id]: d });
      } else if (c.type === "position" && c.position) editor.moveNode(c.id, c.position, !!c.dragging);
      else if (c.type === "select" && c.selected) editor.select({ kind: graph.missing.includes(c.id) ? "missing" : "node", key: c.id });
    }
  };
  const onEdgesChange = (changes: EdgeChange<TransitionEdgeType>[]) => {
    for (const c of changes) if (c.type === "select" && c.selected) editor.select({ kind: "edge", key: c.id });
  };
  const onConnect = (c: Connection) => { if (c.source && c.target) editor.connect(c.source, c.target); };
  const onReconnect = (old: TransitionEdgeType, c: Connection) => {
    const edge = graph.edges.find(e => e.key === old.id);
    if (!edge || !c.target) return;
    if (c.source !== edge.source) { editor.report("A transition keeps its source. Draw a new transition from the other node instead."); return; }
    if (c.target !== edge.target) editor.retarget(edge, c.target);
  };
  const onDragOver = (e: DragEvent) => { if (e.dataTransfer.types.includes(NODE_TYPE_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(NODE_TYPE_MIME);
    if (!type) return;
    e.preventDefault();
    editor.addNode(type, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key !== "Delete" && e.key !== "Backspace") || isTyping(e.target) || !selection) return;
    e.preventDefault();
    if (selection.kind === "node") editor.deleteNode(selection.key);
    else if (selection.kind === "edge") { const edge = graph.edges.find(x => x.key === selection.key); if (edge) editor.deleteEdge(edge); }
  };

  return (
    <div className="psp-canvas" onDragOver={onDragOver} onDrop={onDrop} onKeyDown={onKeyDown}>
      <ReactFlow<CardNode, TransitionEdgeType>
        key={editor.scope.join("/")}
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onReconnect={onReconnect} edgesReconnectable
        onNodeDragStart={() => { dragging.current = true; editor.startDrag(); }}
        onNodeDragStop={() => { if (dragging.current) { dragging.current = false; editor.endDrag(); } }}
        onNodeDoubleClick={(_, node) => {
          const n = graph.nodes.find(x => x.key === node.id);
          if (n && isContainerNode(n.section)) editor.openScope([...editor.scope, n.key]);
        }}
        onPaneClick={() => editor.select(null)}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
        fitView fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }} minZoom={0.2} colorMode="system"
        aria-label="PSP diagram">
        <Background gap={20} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
