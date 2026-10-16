// SPDX-License-Identifier: Apache-2.0
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, Position, ReactFlow, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  filterInfo, filterKind, filterOptionsOf, filtersOf, inferProvider, kindInfo, moveFilter, registrationsFor, removeComponent, removeFilter, replyMode, serverName, tap,
  updateComponent, type Component, type Side
} from "@psp-cdl/studio-core";
import { truncate } from "../../lib/format";
import { applyIntent, dropIntent, intentLabel, PALETTE_MIME, type DragItem, type DropIntent } from "../../pipeline/drop";
import { arrange, edgeSpecs, handleSide, type CardSpec, type CardType, type EdgeSpec, type Point } from "../../pipeline/layout";
import { pspSummaryOf, usePipelineEditor } from "../../pipeline/store";

export const SLOT_MIME = "application/x-psp-pipeline-slot";
type CardData = { spec: CardSpec };
type CardNode = Node<CardData, "card">;
type RingEdgeData = { kind: EdgeSpec["kind"]; dashed: boolean; spliceSide?: Side };
type PipelineEdge = Edge<RingEdgeData, "pipeline">;
const POSITION = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right } as const;

/** The palette item being dragged; dataTransfer types are all a dragover can read. */
export function readItem(e: DragEvent): DragItem | null {
  const live = usePipelineEditor.getState().drag?.item;
  if (live) return live;
  try { const raw = e.dataTransfer.getData(PALETTE_MIME); return raw ? JSON.parse(raw) as DragItem : null; } catch { return null; }
}

/** Applies an intent through the store: one undoable configuration edit. */
export function commitDrop(item: DragItem, intent: DropIntent): void {
  const store = usePipelineEditor.getState();
  if (!store.config) return;
  if (intent.kind === "refuse") { store.report(intentLabel(store.config, item, intent)); return; }
  try {
    const result = applyIntent(store.config, item, intent);
    if (result.config !== store.config) store.apply(result.config);
    if (result.free) store.setFree(result.free.id, result.free.at); else if (item.existing) store.setFree(item.existing, null);
    if (result.openPsp) store.openDialog({ kind: "psp", tab: "source" });
    else if (intent.kind === "attach-loop" && result.componentId) store.openDialog({ kind: "component", componentId: result.componentId, tab: "backend" });
    if (result.componentId) store.select({ componentId: result.componentId });
    store.report(null);
  } catch (e) { store.report((e as Error).message); }
}

function Handles({ spec }: { spec: CardSpec }) {
  const config = usePipelineEditor(s => s.config)!;
  const list: { id: string; type: "source" | "target"; className?: string }[] = [];
  switch (spec.type) {
    case "half": case "ring":
      list.push({ id: "in", type: "target" }, { id: "out", type: "source" });
      if (spec.type === "half" && spec.side === "request") list.push({ id: "boot", type: "target", className: "square" });
      if (spec.type === "half" && spec.side === "response") list.push({ id: "aux", type: "source", className: "aux" });
      break;
    case "model": list.push({ id: "in", type: "target" }, { id: "out", type: "source" }); break;
    case "initiator": {
      const initiator = config.components.find(c => c.id === spec.componentId);
      list.push({ id: "out", type: "source" });
      if (replyMode(initiator) !== "none") list.push({ id: "in", type: "target" });
      break;
    }
    case "loop": list.push({ id: "in", type: "target" }, { id: "out", type: "source" }, { id: "port", type: "source" }); break;
    case "backend": case "terminator": list.push({ id: "in", type: "target" }); break;
    case "psp": if (config.psp) list.push({ id: "out", type: "source", className: "square" }); break;
    case "context": list.push({ id: "out", type: "source", className: "square" }); break;
    case "aux": case "free": list.push({ id: "in", type: "target", className: "aux" }); break;
  }
  return <>{list.map(h => <Handle key={h.id} id={h.id} type={h.type} position={POSITION[handleSide(spec, h.id)]} className={h.className} isConnectable={h.id === "aux" || (spec.type === "model" && h.id === "out") || (spec.type === "aux" || spec.type === "free" || spec.type === "loop") && h.id === "in"} />)}</>;
}

/** The ordered filter slots inside an LLMProxy half. Each slot is a drop target and can be dragged to reorder. */
function Slots({ proxy, side }: { proxy: Component; side: Side }) {
  const selection = usePipelineEditor(s => s.selection);
  const record = usePipelineEditor(s => s.run.records.at(-1));
  const [over, setOver] = useState<number | null>(null);
  const list = filtersOf(proxy, side);
  const store = usePipelineEditor.getState;
  const onDragOver = (index: number) => (e: DragEvent) => {
    const item = readItem(e);
    const moving = e.dataTransfer.types.includes(SLOT_MIME);
    if (!moving && item?.role !== "filter") return;
    if (item && filterInfo(item.kind)?.side !== side) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = moving ? "move" : "copy";
    setOver(index);
    if (item) store().setDrag({ item, intent: { kind: "slot", componentId: proxy.id, side, index }, label: intentLabel(store().config!, item, { kind: "slot", componentId: proxy.id, side, index }) });
  };
  const onDrop = (index: number) => (e: DragEvent) => {
    setOver(null);
    const moving = e.dataTransfer.getData(SLOT_MIME);
    if (moving) {
      e.preventDefault(); e.stopPropagation();
      const from = JSON.parse(moving) as { componentId: string; side: Side; index: number };
      if (from.componentId !== proxy.id || from.side !== side) return;
      store().apply(c => moveFilter(c, proxy.id, side, from.index, index > from.index ? index - 1 : index));
      store().select({ filter: { componentId: proxy.id, side, index: index > from.index ? index - 1 : index } });
      return;
    }
    const item = readItem(e);
    if (item?.role !== "filter" || filterInfo(item.kind)?.side !== side) return;
    e.preventDefault(); e.stopPropagation();
    commitDrop(item, { kind: "slot", componentId: proxy.id, side, index });
    store().setDrag(null);
    store().select({ filter: { componentId: proxy.id, side, index } });
  };
  const verdict = (kind: string) => side === "response" ? record?.responseFilters.find(f => f.kind === kind) : undefined;
  const chip = (kind: string, options: Record<string, unknown>): ReactNode => {
    const v = verdict(kind);
    if (v) return <span className={`pl-chip verdict-${v.verdict}`} title={v.evidence}>{v.verdict}</span>;
    if (kind === "exfil-guard") return <span className="pl-chip">{typeof options.threshold === "number" ? `cos ≤ ${options.threshold}` : "lexical + semantic"}</span>;
    if (!filterInfo(kind)) return <span className="pl-chip warn">unknown</span>;
    if (!filterInfo(kind)!.supported) return <span className="pl-chip warn">unsupported</span>;
    return null;
  };
  return (
    <ol className="pl-slots nodrag">
      {list.map((spec, index) => {
        const kind = filterKind(spec), info = filterInfo(kind);
        const selected = selection.filter?.componentId === proxy.id && selection.filter.side === side && selection.filter.index === index;
        return (
          <li key={`${index}:${kind}`} className={`pl-slot${selected ? " selected" : ""}${over === index ? " over" : ""}`} draggable
            aria-label={`${side} filter slot ${index + 1}: ${info?.label ?? kind}`}
            onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData(SLOT_MIME, JSON.stringify({ componentId: proxy.id, side, index })); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={onDragOver(index)} onDragLeave={() => setOver(null)} onDrop={onDrop(index)}
            onClick={e => { e.stopPropagation(); store().select({ filter: { componentId: proxy.id, side, index } }); }}
            onDoubleClick={e => { e.stopPropagation(); store().openDialog({ kind: "filter", componentId: proxy.id, side, index }); }}>
            <span className="pl-slot-n">{index + 1}</span>
            <span className="pl-slot-label">{info?.label ?? kind}</span>
            {chip(kind, filterOptionsOf(spec))}
          </li>
        );
      })}
      <li className={`pl-slot drop${over === list.length ? " over" : ""}`} aria-label={`Drop a ${side} filter at the end`}
        onDragOver={onDragOver(list.length)} onDragLeave={() => setOver(null)} onDrop={onDrop(list.length)}>drop a {side} filter here</li>
    </ol>
  );
}

function CardBody({ spec }: { spec: CardSpec }) {
  const config = usePipelineEditor(s => s.config)!;
  const env = usePipelineEditor(s => s.env);
  const run = usePipelineEditor(s => s.run);
  const drift = usePipelineEditor(s => s.drift);
  const vectors = usePipelineEditor(s => s.vectors);
  const problems = usePipelineEditor(s => s.problems);
  const c = spec.componentId ? config.components.find(x => x.id === spec.componentId) : undefined;
  const psp = pspSummaryOf(env);
  const flagged = c ? problems.filter(p => p.target?.componentId === c.id && p.severity !== "info") : [];
  const flag = flagged.length ? <span className={`pl-chip ${flagged.some(p => p.severity === "error") ? "error" : "warn"}`} title={flagged.map(p => p.message).join("\n")}>{flagged.length}</span> : null;
  const head = (type: string, extra?: ReactNode) => <div className="pl-card-head"><span className="pl-card-type">{type}</span>{extra}<span className="spacer" />{flag}</div>;
  switch (spec.type) {
    case "half":
      return <>{head("LLMProxy", <span className="pl-chip">{spec.side} ½</span>)}<div className="pl-card-id">{c!.id}</div><Slots proxy={c!} side={spec.side!} /></>;
    case "ring":
      return <>{head(kindInfo(c!.kind)?.label ?? c!.kind, <span className="pl-chip">{spec.side}</span>)}<div className="pl-card-id">{c!.id}</div></>;
    case "model": {
      const preview = registrationsFor(config, psp, env.catalogs ?? {});
      const allowed = run.session ? run.session.registrations.allowed.length : preview.allowed.length;
      return <>{head("Model", <span className="pl-chip">terminal</span>)}<div className="pl-card-id">{String(c!.model ?? "")}</div>
        <div className="pl-card-line">{inferProvider(String(c!.model ?? ""), c!.provider) ?? "provider?"} · {allowed} registration{allowed === 1 ? "" : "s"} from LLMProxy</div></>;
    }
    case "initiator": {
      const reply = replyMode(c);
      return <>{head("Initiator", <span className="pl-chip">{String(c!.trigger)}</span>)}<div className="pl-card-id">{c!.id}</div>
        <div className="pl-card-line">{reply === "none" ? "trigger only · reply: none" : "initiator → request path · response path → reply"}</div></>;
    }
    case "loop": {
      const report = drift[c!.id];
      const session = run.session?.registrations;
      const server = serverName(c!);
      const allowed = session ? session.allowed.filter(t => t.startsWith(server + ".")).length : null;
      const withheld = session ? [...session.withheldByNode, ...session.withheldByCovenant.map(w => w.tool), ...session.withheldByMode].filter(t => t.startsWith(server + ".")).length : null;
      const refused = run.records.at(-1)?.toolLoop.calls.some(x => x.proxyId === c!.id && x.drift === "refused");
      return <>{head("MCPProxy", <span className="pl-chip">loop</span>)}<div className="pl-card-id">{c!.id}</div>
        <div className="pl-card-line">on drift: {String(c!.drift ?? "refuse")} · no filtering</div>
        <div className="pl-card-foot">
          <span className={`pl-chip drift-${refused ? "refusing" : report?.status ?? "unknown"}`} title={report?.detail}>{refused ? "refused on drift" : report ? report.status : "drift status unknown"}</span>
          {allowed !== null && <span className="pl-chip">{allowed} of {allowed + withheld!} registered</span>}
        </div></>;
    }
    case "backend": {
      let host = String(c!.backend);
      try { const u = new URL(host); host = u.host + u.pathname; } catch { /* shown as written */ }
      const report = drift[c!.id];
      return <>{head("MCP Server", <span className="pl-chip">backend</span>)}<div className="pl-card-id">{serverName(c!)}</div>
        <div className="pl-card-line">{truncate(host, 40)}{report?.baseline ? ` · ${report.baseline.tools} tools · baseline ${report.baseline.capturedAt.slice(0, 10)}` : ""}</div></>;
    }
    case "psp":
      if (!config.psp) return <div className="pl-empty-slot">No PSP — drop one or run without</div>;
      return <>{head("PSP Document", <span className="pl-chip">bootstrap</span>)}<div className="pl-card-id">{psp?.path ?? config.psp.document}</div>
        <div className="pl-card-line">{config.psp.signOnRetrieval ? `signed on retrieval · ${config.psp.signOnRetrieval}` : psp?.signed ? "signed in the document" : "unsigned"}</div>
        <div className="pl-card-foot">{psp ? <>{psp.sections.length} section{psp.sections.length === 1 ? "" : "s"}{psp.covenants.map(t => <span key={t} className="pl-chip">{t}</span>)}</> : <span className="muted">{env.psp?.status === "unresolved" ? env.psp.reason : "resolving…"}</span>}</div></>;
    case "context": {
      const context = run.records.at(-1)?.context ?? run.session?.context;
      return <>{head("PSP Context", <span className="pl-chip">state</span>)}
        <div className="pl-card-line">{context ? `turn ${context.turn} · loops ${context.loops} · node ${context.node ?? "none"} · decisions ${context.decisions}` : "created with each session"}</div></>;
    }
    case "aux": case "free": {
      const kind = kindInfo(c!.kind)?.label ?? c!.kind;
      const status = c!.kind === "vector-store" ? vectors[c!.id] : undefined;
      const tapped = run.records.at(-1)?.taps.find(t => t.id === c!.id);
      return <>{head(kind, <span className={`pl-chip${spec.type === "free" ? " error" : ""}`}>{spec.type === "free" ? "free" : "auxiliary"}</span>)}<div className="pl-card-id">{c!.id}</div>
        <div className="pl-card-line">{c!.kind === "vector-store" ? `${String(c!.engine ?? "")} · ${String(c!.embedding ?? "psp-exfil-hash-384-v1")}` : c!.kind === "logger" ? `${String(c!.sink ?? "./runs/")} · redact ${String(c!.redact ?? "covenant")}` : String(c!.endpoint ?? c!.kind)}</div>
        <div className="pl-card-foot">
          {status && <span className="pl-chip">{status.exists ? `${status.sections} sections · ${status.chunks} chunks` : "empty"}</span>}
          {tapped && <span className={`pl-chip ${tapped.status === "unsupported" ? "warn" : ""}`}>{tapped.status}</span>}
        </div></>;
    }
    case "terminator":
      return <div className="pl-terminator" title="reply: none — the response path ends at LLMProxy's response half">recorded, not delivered</div>;
  }
}

/** Double-click opens the properties of whatever the card shows. */
function openFor(spec: CardSpec): void {
  const store = usePipelineEditor.getState();
  if (spec.type === "psp" || spec.type === "context") store.openDialog({ kind: "psp" });
  else if (spec.type === "backend") store.openDialog({ kind: "component", componentId: spec.componentId!, tab: "backend" });
  else if (spec.componentId) store.openDialog({ kind: "component", componentId: spec.componentId });
}

function Card({ data, selected }: NodeProps<CardNode>) {
  const { spec } = data;
  const config = usePipelineEditor(s => s.config)!;
  const onDragOver = (e: DragEvent) => {
    const item = readItem(e);
    if (spec.type === "psp" && item?.role === "bootstrap") { e.preventDefault(); e.stopPropagation(); usePipelineEditor.getState().setDrag({ item, intent: { kind: "attach-bootstrap" }, label: intentLabel(config, item, { kind: "attach-bootstrap" }) }); }
    if (spec.type === "half" && spec.side === "response" && item?.role === "aux") { e.preventDefault(); e.stopPropagation(); const intent: DropIntent = { kind: "tap", target: spec.componentId!, side: "response" }; usePipelineEditor.getState().setDrag({ item, intent, label: intentLabel(config, item, intent) }); }
  };
  const onDrop = (e: DragEvent) => {
    const item = readItem(e);
    if (spec.type === "psp" && item?.role === "bootstrap") { e.preventDefault(); e.stopPropagation(); commitDrop(item, { kind: "attach-bootstrap" }); usePipelineEditor.getState().setDrag(null); }
    if (spec.type === "half" && spec.side === "response" && item?.role === "aux") { e.preventDefault(); e.stopPropagation(); commitDrop(item, { kind: "tap", target: spec.componentId!, side: "response" }); usePipelineEditor.getState().setDrag(null); }
  };
  const label = spec.type === "half" ? `LLMProxy ${spec.side} half ${spec.componentId}` : spec.type === "psp" ? (config.psp ? "PSP Document" : "Empty PSP slot") : spec.type === "context" ? "PSP Context" : spec.type === "terminator" ? "Response path terminator" : spec.type === "backend" ? `MCP Server for ${spec.componentId}` : `${cardKind(spec.type)} ${spec.componentId}`;
  return (
    <div className={`pl-card type-${spec.type}${spec.side ? ` side-${spec.side}` : ""}${selected ? " selected" : ""}${spec.type === "psp" && !config.psp ? " empty" : ""}`} style={{ width: spec.rect.w, minHeight: spec.rect.h }}
      aria-label={label} onDragOver={onDragOver} onDrop={onDrop} onDoubleClick={e => { e.stopPropagation(); openFor(spec); }}>
      <Handles spec={spec} />
      <CardBody spec={spec} />
    </div>
  );
}
const cardKind = (type: CardType) => ({ model: "Model", initiator: "Initiator", loop: "MCPProxy", aux: "Auxiliary", free: "Free node", ring: "Ring component" } as Record<string, string>)[type] ?? type;

/** Ring edges carry a splice target at their midpoint; every edge is coloured by kind. */
function PipelineEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<PipelineEdge>) {
  const [path, x, y] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const dragging = usePipelineEditor(s => s.drag?.item.role === "ring");
  const [source, target] = id.replace(/^(request|response):/, "").split("->") as [string, string];
  const spliceable = data?.kind === "request" || data?.kind === "response";
  const drop = (e: DragEvent, commit: boolean) => {
    const item = readItem(e);
    if (item?.role !== "ring") return;
    e.preventDefault(); e.stopPropagation();
    const intent: DropIntent = { kind: "splice", edge: [source, target], side: data!.kind === "request" ? "request" : "response" };
    const store = usePipelineEditor.getState();
    if (commit) { commitDrop(item, intent); store.setDrag(null); } else store.setDrag({ item, intent, label: intentLabel(store.config!, item, intent) });
  };
  return (
    <>
      <BaseEdge id={id} path={path} className={`pl-edge kind-${data?.kind}${data?.dashed ? " dashed" : ""}`} {...(markerEnd ? { markerEnd } : {})} />
      {spliceable && (
        <EdgeLabelRenderer>
          <div className={`pl-splice nodrag nopan${dragging ? " active" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            aria-label={`Splice into ${data!.kind} edge ${source} to ${target}`} onDragOver={e => drop(e, false)} onDrop={e => drop(e, true)} />
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { card: Card };
const edgeTypes = { pipeline: PipelineEdgeView };
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

export function PipelineCanvas() {
  const flow = useReactFlow();
  const config = usePipelineEditor(s => s.config)!;
  const free = usePipelineEditor(s => s.free);
  const selection = usePipelineEditor(s => s.selection);
  const drag = usePipelineEditor(s => s.drag);
  const notice = usePipelineEditor(s => s.notice);
  const [moving, setMoving] = useState<Record<string, Point>>({});
  const cards = useMemo(() => arrange(config, free), [config, free]);
  const specs = useMemo(() => edgeSpecs(config, cards), [config, cards]);
  const store = usePipelineEditor.getState;
  const zoom = () => { try { return flow.getZoom(); } catch { return 1; } };
  const dragged = useRef<string | null>(null);

  const nodes = useMemo<CardNode[]>(() => cards.map(spec => ({
    id: spec.id, type: "card" as const, position: moving[spec.id] ?? { x: spec.rect.x, y: spec.rect.y }, data: { spec },
    draggable: spec.type === "aux" || spec.type === "free" || spec.type === "loop",
    selected: (!!spec.componentId && selection.componentId === spec.componentId && spec.type !== "backend") || (spec.type === "psp" && !!selection.psp),
    width: spec.rect.w
  })), [cards, moving, selection]);
  const edges = useMemo<PipelineEdge[]>(() => specs.map(e => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: "pipeline" as const,
    data: { kind: e.kind, dashed: e.dashed }, selectable: false
  })), [specs]);

  const itemFor = (id: string): DragItem | null => {
    const c = config.components.find(x => x.id === id);
    return c ? { role: c.role, kind: c.kind, label: c.id, existing: c.id } : null;
  };
  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        setMoving(m => ({ ...m, [change.id]: change.position! }));
        const item = itemFor(change.id);
        if (item && change.dragging) {
          const card = cards.find(c => c.id === change.id)!;
          const at = { x: change.position.x + card.rect.w / 2, y: change.position.y + card.rect.h / 2 };
          const intent = dropIntent(config, item, at, cards.filter(c => c.id !== change.id), specs, zoom());
          store().setDrag({ item, intent, label: intentLabel(config, item, intent) });
          dragged.current = change.id;
        }
      }
    }
  };
  const onNodeDragStop = () => {
    const id = dragged.current; dragged.current = null;
    const intent = store().drag?.intent, item = store().drag?.item;
    setMoving({}); store().setDrag(null);
    if (!id || !intent || !item) return;
    if (intent.kind === "free") { const card = cards.find(c => c.id === id)!; commitDrop(item, { kind: "free", at: { x: intent.at.x - card.rect.w / 2, y: intent.at.y - card.rect.h / 2 } }); return; }
    commitDrop(item, intent);
  };
  const onDragOver = (e: DragEvent) => {
    const item = readItem(e);
    if (!item) return;
    e.preventDefault();
    const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const intent = dropIntent(config, item, at, cards, specs, zoom());
    e.dataTransfer.dropEffect = intent.kind === "refuse" ? "none" : "copy";
    store().setDrag({ item, intent, label: intentLabel(config, item, intent) });
  };
  const onDrop = (e: DragEvent) => {
    const item = readItem(e);
    if (!item) return;
    e.preventDefault();
    const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    commitDrop(item, dropIntent(config, item, at, cards, specs, zoom()));
    store().setDrag(null);
  };
  const isValidConnection = (c: Connection | Edge) => {
    const source = cards.find(x => x.id === c.source), target = cards.find(x => x.id === c.target);
    if (!source || !target) return false;
    if (source.type === "half" && c.sourceHandle === "aux") return target.type === "aux" || (target.type === "free" && config.components.find(x => x.id === target.componentId)?.role === "aux");
    if (source.type === "model" && c.sourceHandle === "out") return target.type === "loop" || (target.type === "free" && config.components.find(x => x.id === target.componentId)?.role === "loop");
    return false;
  };
  const onConnect = (c: Connection) => {
    if (!isValidConnection(c)) return;
    const source = cards.find(x => x.id === c.source)!, target = cards.find(x => x.id === c.target)!;
    if (source.type === "half") store().apply(cfg => tap(cfg, target.componentId!, source.componentId!, "response"));
    else store().apply(cfg => updateComponent(cfg, target.componentId!, { caller: source.componentId }));
    store().setFree(target.componentId!, null);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key !== "Delete" && e.key !== "Backspace") || isTyping(e.target)) return;
    const s = store();
    if (s.selection.filter) { e.preventDefault(); const f = s.selection.filter; s.apply(cfg => removeFilter(cfg, f.componentId, f.side, f.index)); s.select({}); return; }
    if (s.selection.componentId) {
      e.preventDefault();
      const c = config.components.find(x => x.id === s.selection.componentId);
      if (c?.kind === "llmproxy" && !window.confirm(`Delete ${c.id}? Both halves and their filters go with it.`)) return;
      s.apply(cfg => removeComponent(cfg, s.selection.componentId!)); s.setFree(s.selection.componentId, null); s.select({});
    }
  };
  return (
    <div className="pl-canvas" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={e => { if (e.currentTarget === e.target) store().setDrag(null); }} onKeyDown={onKeyDown}>
      {drag?.label && <div className={`pl-hud${drag.intent?.kind === "refuse" ? " refuse" : ""}`} role="status">{drag.label}</div>}
      {!drag && notice && <div className="pl-hud refuse" role="status">{notice} <button type="button" onClick={() => store().report(null)}>Dismiss</button></div>}
      <ReactFlow<CardNode, PipelineEdge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onConnect={onConnect} isValidConnection={isValidConnection}
        onNodeClick={(_, node) => { const spec = node.data.spec; store().select(spec.type === "psp" || spec.type === "context" ? { psp: true } : spec.componentId ? { componentId: spec.componentId } : {}); }}
        onPaneClick={() => store().select({})}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} nodesConnectable edgesFocusable={false} zoomOnDoubleClick={false}
        fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.2} colorMode="system" aria-label="Pipeline diagram">
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

