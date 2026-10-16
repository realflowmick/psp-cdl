// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic auto-arrange from roles: request-side ring stops stack upward from the Initiator,
 * response-side stops downward from the Model, bootstraps sit left of the request half and
 * auxiliaries right of the response half. No positions are stored; free nodes keep an editor-only
 * position for the session.
 */
import {
  attachment, backendNodeId, CONTEXT_NODE, filtersOf, halfId, primaryProxy, PSP_NODE, replyMode, ringStops, structuralEdges, terminals, TERMINATOR,
  type Component, type EdgeKind, type PipelineConfig, type Side
} from "@psp-cdl/studio-core";

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type CardType = "half" | "ring" | "model" | "initiator" | "loop" | "backend" | "psp" | "context" | "aux" | "free" | "terminator";
export interface CardSpec { id: string; type: CardType; componentId?: string; side?: Side; rect: Rect }
export interface EdgeSpec { id: string; kind: EdgeKind; source: string; target: string; sourceHandle: string; targetHandle: string; dashed: boolean }

export const CARD_W = 250, GAP_Y = 46, COL = { boot: 0, request: 330, center: 660, response: 990, aux: 1320 };
const SLOT_H = 26;
/** Height of an LLMProxy half: header plus one row per filter slot plus the trailing drop zone. */
export const halfHeight = (proxy: Component | undefined, side: Side): number => 74 + SLOT_H * (filtersOf(proxy, side).length + 1);
const heightOf = (type: CardType, c?: Component, side?: Side): number => type === "half" ? halfHeight(c, side!) : type === "terminator" ? 20 : type === "backend" || type === "context" ? 76 : 96;

/** Cards and their rectangles for one configuration. */
export function arrange(config: PipelineConfig, free: Record<string, Point> = {}): CardSpec[] {
  const cards: CardSpec[] = [];
  const { model, initiator } = terminals(config);
  const proxy = primaryProxy(config);
  const request = ringStops(config, "request"), response = ringStops(config, "response");
  const loops = config.components.filter(c => c.role === "loop" && attachment(config, c) === "loop");
  const byId = new Map(config.components.map(c => [c.id, c]));
  const stopCard = (stop: { componentId: string; side: Side; nodeId: string }): Omit<CardSpec, "rect"> & { h: number } => {
    const c = byId.get(stop.componentId)!;
    const type: CardType = c.kind === "llmproxy" ? "half" : "ring";
    return { id: stop.nodeId, type, componentId: c.id, side: stop.side, h: heightOf(type, c, stop.side) };
  };

  // Top row: Model, then each MCPProxy with its backend below it.
  const modelH = heightOf("model");
  if (model) cards.push({ id: model.id, type: "model", componentId: model.id, rect: { x: COL.center, y: 0, w: CARD_W, h: modelH } });
  loops.forEach((loop, i) => {
    const x = COL.response + i * (CARD_W + 60);
    cards.push({ id: loop.id, type: "loop", componentId: loop.id, rect: { x, y: 0, w: CARD_W, h: 96 } });
    if (typeof loop.backend === "string" && loop.backend) cards.push({ id: backendNodeId(loop.id), type: "backend", componentId: loop.id, rect: { x, y: 96 + 40, w: CARD_W, h: 76 } });
  });

  // Response column runs down from below the loop row.
  let y = loops.length ? 96 + 40 + 76 + 70 : modelH + 60;
  const responseRects = new Map<string, Rect>();
  for (const stop of response) {
    const s = stopCard(stop);
    const rect = { x: COL.response, y, w: CARD_W, h: s.h };
    responseRects.set(stop.nodeId, rect);
    cards.push({ ...s, rect });
    y += s.h + GAP_Y;
  }
  const responseBottom = y;

  // Request column stacks upward from the Initiator; the Initiator sits below whichever column is taller.
  const requestHeights = request.map(stop => stopCard(stop).h);
  const requestTotal = requestHeights.reduce((n, h) => n + h + GAP_Y, 0);
  const initiatorY = Math.max(responseBottom + 30, modelH + 60 + requestTotal + 30);
  let up = initiatorY - 30;
  const requestRects = new Map<string, Rect>();
  request.forEach((stop, i) => {
    const s = stopCard(stop), h = requestHeights[i]!;
    up -= h;
    const rect = { x: COL.request, y: up, w: CARD_W, h };
    requestRects.set(stop.nodeId, rect);
    cards.push({ ...s, rect });
    up -= GAP_Y;
  });
  if (initiator) cards.push({ id: initiator.id, type: "initiator", componentId: initiator.id, rect: { x: COL.center, y: initiatorY, w: CARD_W, h: 96 } });
  if (initiator && replyMode(initiator) === "none") {
    const last = response.length ? responseRects.get(response.at(-1)!.nodeId)! : null;
    cards.push({ id: TERMINATOR, type: "terminator", rect: { x: COL.response + 45, y: last ? last.y + last.h + 40 : responseBottom, w: CARD_W - 90, h: 20 } });
  }

  // Bootstrap slot: left of the request half, always shown (an empty dashed slot when psp is null).
  const requestHalf = proxy ? requestRects.get(halfId(proxy.id, "request")) : undefined;
  const bootY = requestHalf ? requestHalf.y : initiatorY - 260;
  cards.push({ id: PSP_NODE, type: "psp", rect: { x: COL.boot, y: bootY, w: CARD_W, h: 110 } });
  if (config.psp) cards.push({ id: CONTEXT_NODE, type: "context", rect: { x: COL.boot, y: bootY + 110 + 30, w: CARD_W, h: 76 } });

  // Auxiliaries right of the response half, in configuration order.
  const responseHalf = proxy ? responseRects.get(halfId(proxy.id, "response")) : undefined;
  let auxY = responseHalf ? responseHalf.y : responseBottom;
  const freeAt = { x: COL.aux, y: Math.max(initiatorY, responseBottom) + 160 };
  for (const c of config.components) {
    const where = attachment(config, c);
    if (c.role === "aux" && where === "tap") { cards.push({ id: c.id, type: "aux", componentId: c.id, rect: { x: COL.aux, y: auxY, w: CARD_W, h: 96 } }); auxY += 96 + 28; continue; }
    if (where === "free" || where === "extra" || (c.role === "loop" && where !== "loop")) {
      const at = free[c.id] ?? { ...freeAt };
      if (!free[c.id]) freeAt.y += 96 + 28;
      cards.push({ id: c.id, type: "free", componentId: c.id, rect: { x: at.x, y: at.y, w: CARD_W, h: 96 } });
    }
  }
  return cards;
}

const HANDLES: Record<EdgeKind, [string, string]> = {
  request: ["out", "in"], response: ["out", "in"], loop: ["out", "in"], "loop-return": ["out", "in"], backend: ["port", "in"], bootstrap: ["out", "boot"], aux: ["aux", "in"]
};
/** Structural edges with React Flow handle ids, limited to cards that exist. */
export function edgeSpecs(config: PipelineConfig, cards: readonly CardSpec[]): EdgeSpec[] {
  const ids = new Set(cards.map(c => c.id));
  return structuralEdges(config).filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({
    id: e.id, kind: e.kind, source: e.source, target: e.target, sourceHandle: HANDLES[e.kind][0], targetHandle: HANDLES[e.kind][1], dashed: !!e.dashed
  }));
}

/** Where a handle sits on its card, for drop geometry. */
export function handlePoint(card: CardSpec, handle: string): Point {
  const { x, y, w, h } = card.rect;
  const side = handleSide(card, handle);
  return side === "top" ? { x: x + w / 2, y } : side === "bottom" ? { x: x + w / 2, y: y + h } : side === "left" ? { x, y: y + h / 2 } : { x: x + w, y: y + h / 2 };
}
/** Handle placement derived from role and side, never chosen by the user (the topology table). */
export function handleSide(card: Pick<CardSpec, "type" | "side">, handle: string): "top" | "bottom" | "left" | "right" {
  switch (card.type) {
    case "half": case "ring":
      if (handle === "boot") return "left";
      if (handle === "aux") return "right";
      return card.side === "request" ? (handle === "in" ? "bottom" : "top") : (handle === "in" ? "top" : "bottom");
    case "model": return handle === "in" ? "left" : "right";
    case "initiator": return handle === "in" ? "right" : "left";
    case "loop": return handle === "in" ? "left" : handle === "port" ? "bottom" : "top";
    case "backend": case "terminator": return "top";
    case "psp": case "context": return "right";
    default: return "left";
  }
}
