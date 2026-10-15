// SPDX-License-Identifier: Apache-2.0
/**
 * Drop semantics. The palette item declares its role; the drop target decides what happens, and the
 * hover HUD shows that outcome before release. Each intent maps to one configuration edit.
 */
import {
  addComponent, attachLoop, createComponent, filterInfo, insertFilter, kindInfo, primaryProxy, spliceRing, tap, terminals, updateComponent,
  type Component, type PipelineConfig, type Role, type Side
} from "@psp-cdl/studio-core";
import { handlePoint, type CardSpec, type EdgeSpec, type Point } from "./layout";

export type DragRole = Role | "filter" | "bootstrap";
export interface DragItem { role: DragRole; kind: string; label: string; existing?: string }
export type DropIntent =
  | { kind: "splice"; edge: [string, string]; side: Side }
  | { kind: "slot"; componentId: string; side: Side; index: number }
  | { kind: "attach-loop"; caller: string }
  | { kind: "attach-bootstrap" }
  | { kind: "tap"; target: string; side: Side }
  | { kind: "free"; at: Point }
  | { kind: "refuse"; reason: string };

export const PALETTE_MIME = "application/x-psp-pipeline-item";
export const SPLICE_PX = 24, TAP_PX = 48;

const inside = (p: Point, r: CardSpec["rect"], pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const distanceToRect = (p: Point, r: CardSpec["rect"]) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Slot index from the pointer's height inside an LLMProxy half. */
export function slotIndex(card: CardSpec, count: number, p: Point): number {
  const top = card.rect.y + 60, slot = 26;
  return Math.max(0, Math.min(count, Math.round((p.y - top) / slot)));
}

/** The intent for dropping `item` at `p` (flow coordinates). `zoom` scales the pixel tolerances. */
export function dropIntent(config: PipelineConfig, item: DragItem, p: Point, cards: readonly CardSpec[], edges: readonly EdgeSpec[], zoom = 1): DropIntent {
  const byId = new Map(cards.map(c => [c.id, c]));
  if (item.role === "ring") {
    if (item.kind === "llmproxy" && primaryProxy(config)) return { kind: "refuse", reason: "The ring already has an LLMProxy" };
    let best: { d: number; edge: EdgeSpec } | null = null;
    for (const e of edges) {
      if (e.kind !== "request" && e.kind !== "response") continue;
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b) continue;
      const d = distanceToSegment(p, handlePoint(a, e.sourceHandle), handlePoint(b, e.targetHandle));
      if (!best || d < best.d) best = { d, edge: e };
    }
    if (best && best.d <= SPLICE_PX / zoom) return { kind: "splice", edge: [best.edge.source, best.edge.target], side: best.edge.kind === "request" ? "request" : "response" };
    return { kind: "free", at: p };
  }
  if (item.role === "filter") {
    const side = filterInfo(item.kind)?.side;
    const half = cards.find(c => c.type === "half" && inside(p, c.rect));
    if (!half) return { kind: "refuse", reason: "Filters drop only into an LLMProxy half" };
    if (side && half.side !== side) return { kind: "refuse", reason: `${filterInfo(item.kind)!.label} is a ${side} filter` };
    const proxy = config.components.find(c => c.id === half.componentId);
    return { kind: "slot", componentId: half.componentId!, side: half.side!, index: slotIndex(half, proxy?.filters?.[half.side!]?.length ?? 0, p) };
  }
  if (item.role === "bootstrap") {
    const slot = cards.find(c => c.type === "psp");
    return slot && inside(p, slot.rect, 16) ? { kind: "attach-bootstrap" } : { kind: "refuse", reason: "Drop the PSP Document on the slot left of the request half" };
  }
  if (item.role === "loop") {
    const { model } = terminals(config);
    if (!model) return { kind: "refuse", reason: "A loop component needs the Model" };
    const modelCard = byId.get(model.id);
    return modelCard && p.y <= modelCard.rect.y + modelCard.rect.h + 40 ? { kind: "attach-loop", caller: model.id } : { kind: "free", at: p };
  }
  if (item.role === "aux") {
    const halves = cards.filter(c => c.type === "half" && c.side === "response").map(c => ({ c, d: distanceToRect(p, c.rect) })).sort((a, b) => a.d - b.d);
    if (halves[0] && halves[0].d <= TAP_PX / zoom) return { kind: "tap", target: halves[0].c.componentId!, side: "response" };
    return { kind: "free", at: p };
  }
  if (item.role === "terminal") {
    const info = kindInfo(item.kind);
    if (info?.singleton && config.components.some(c => c.kind === item.kind && c.id !== item.existing)) return { kind: "refuse", reason: `The pipeline already has its ${info.label}` };
    return { kind: "free", at: p };
  }
  return { kind: "free", at: p };
}

/** HUD text, shown before release. */
export function intentLabel(config: PipelineConfig, item: DragItem, intent: DropIntent): string {
  const name = (node: string) => {
    const id = node.replace(/\.(request|response)$/, "");
    const c = config.components.find(x => x.id === id);
    return c?.kind === "initiator" ? (String(c.trigger) === "chat" ? "Chat" : `Initiator (${String(c.trigger)})`) : c ? kindInfo(c.kind)?.label ?? c.id : node;
  };
  switch (intent.kind) {
    case "splice": return `Insert inline · splice ${name(intent.edge[0])} → ${name(intent.edge[1])}`;
    case "slot": return `Insert as ${intent.side} filter · slot ${intent.index + 1} of ${intent.componentId}`;
    case "attach-loop": return `Attach to the turn · called by ${intent.caller}`;
    case "attach-bootstrap": return "Attach as the PSP document · one per pipeline";
    case "tap": return `${item.kind === "vector-store" ? "Read by response filters" : "Tap"} · ${intent.target}.${intent.side}`;
    case "free": return "Free node · flagged by Validate";
    case "refuse": return `Cannot drop here · ${intent.reason}`;
  }
}

export interface Applied { config: PipelineConfig; componentId?: string; free?: { id: string; at: Point }; openPsp?: boolean }
/** Applies an intent. A palette item creates a component; a dragged card (`existing`) is moved. */
export function applyIntent(config: PipelineConfig, item: DragItem, intent: DropIntent): Applied {
  if (intent.kind === "refuse") return { config };
  if (intent.kind === "slot") return { config: insertFilter(config, intent.componentId, intent.side, intent.index, item.kind) };
  if (intent.kind === "attach-bootstrap") return { config, openPsp: true };
  const existing = item.existing ? config.components.find(c => c.id === item.existing) : undefined;
  if (existing) {
    if (intent.kind === "tap") return { config: tap(config, existing.id, intent.target, intent.side), componentId: existing.id };
    if (intent.kind === "attach-loop") return { config: updateComponent(config, existing.id, { caller: intent.caller }), componentId: existing.id };
    if (intent.kind === "splice") {
      const without = { ...config, components: config.components.filter(c => c.id !== existing.id) };
      const { side: _side, ...rest } = existing;
      return { config: spliceRing(without, rest as Component, { side: intent.side, source: intent.edge[0], target: intent.edge[1] }), componentId: existing.id };
    }
    return { config, componentId: existing.id, free: { id: existing.id, at: intent.at } };
  }
  const component = createComponent(config, item.kind, item.role === "ring" || item.role === "loop" || item.role === "aux" || item.role === "terminal" ? { role: kindInfo(item.kind)?.role ?? item.role } : {});
  switch (intent.kind) {
    case "splice": return { config: spliceRing(config, component, { side: intent.side, source: intent.edge[0], target: intent.edge[1] }), componentId: component.id };
    case "attach-loop": return { config: attachLoop(config, component), componentId: component.id };
    case "tap": {
      const added = addComponent(config, component.kind === "vector-store" ? component : { ...component });
      return { config: tap(added, component.id, intent.target, intent.side), componentId: component.id };
    }
    case "free": {
      const { caller: _caller, taps: _taps, ...loose } = component;
      return { config: addComponent(config, loose as Component), componentId: component.id, free: { id: component.id, at: intent.at } };
    }
  }
}
