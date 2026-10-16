// SPDX-License-Identifier: Apache-2.0
/**
 * The ring and its attachments, derived from roles and properties. There is no stored graph: edges
 * are a projection of the configuration, so a graph edit is always a configuration edit.
 */
import { filterKind } from "./kinds.js";
import type { Component, PipelineBody, Side } from "./types.js";

/** One card on the ring. LLMProxy appears twice, once per half. */
export interface RingStop { componentId: string; side: Side; nodeId: string }
export const halfId = (componentId: string, side: Side): string => `${componentId}.${side}`;
export const BACKEND_SUFFIX = ".backend";
export const PSP_NODE = "psp-document", CONTEXT_NODE = "psp-context";

export type EdgeKind = "request" | "response" | "loop" | "loop-return" | "backend" | "bootstrap" | "aux";
export interface StructuralEdge { id: string; kind: EdgeKind; source: string; target: string; dashed?: boolean }

const isLlmProxy = (c: Component) => c.kind === "llmproxy" && c.role === "ring";
export const onSide = (c: Component, side: Side): boolean => c.role === "ring" && (c.kind === "llmproxy" || c.side === side);

export function terminals(body: PipelineBody): { model?: Component; initiator?: Component } {
  const model = body.components.find(c => c.kind === "model" && c.role === "terminal");
  const initiator = body.components.find(c => c.kind === "initiator" && c.role === "terminal");
  return { ...(model ? { model } : {}), ...(initiator ? { initiator } : {}) };
}
export const llmProxies = (body: PipelineBody): Component[] => body.components.filter(isLlmProxy);
export const primaryProxy = (body: PipelineBody): Component | undefined => llmProxies(body)[0];

/** Request side runs up from the Initiator in array order; response side runs down from the Model in array order. */
export function ringStops(body: PipelineBody, side: Side): RingStop[] {
  return body.components.filter(c => onSide(c, side)).map(c => ({ componentId: c.id, side, nodeId: c.kind === "llmproxy" ? halfId(c.id, side) : c.id }));
}
/** `[initiator, ...request, model, ...response, initiator]` as node ids. */
export function ringOrder(body: PipelineBody): string[] {
  const { model, initiator } = terminals(body);
  const ends = initiator ? [initiator.id] : [];
  return [...ends, ...ringStops(body, "request").map(s => s.nodeId), ...(model ? [model.id] : []), ...ringStops(body, "response").map(s => s.nodeId), ...ends];
}
export const replyMode = (initiator: Component | undefined): "channel" | "none" => initiator?.reply === "none" ? "none" : "channel";
export const TERMINATOR = "terminator";

export function ringEdges(body: PipelineBody): StructuralEdge[] {
  const { model, initiator } = terminals(body);
  if (!model) return [];
  const edges: StructuralEdge[] = [];
  const request = [...(initiator ? [initiator.id] : []), ...ringStops(body, "request").map(s => s.nodeId), model.id];
  const response = [model.id, ...ringStops(body, "response").map(s => s.nodeId)];
  if (initiator) response.push(replyMode(initiator) === "none" ? TERMINATOR : initiator.id);
  for (let i = 0; i + 1 < request.length; i++) edges.push({ id: `request:${request[i]}->${request[i + 1]}`, kind: "request", source: request[i]!, target: request[i + 1]! });
  for (let i = 0; i + 1 < response.length; i++) edges.push({ id: `response:${response[i]}->${response[i + 1]}`, kind: "response", source: response[i]!, target: response[i + 1]! });
  return edges;
}

/** A tap target such as `llmproxy_1.response`; null when it is malformed. */
export function parseTap(value: unknown): { componentId: string; side: Side } | null {
  if (typeof value !== "string") return null;
  const m = /^(.+)\.(request|response)$/.exec(value);
  return m ? { componentId: m[1]!, side: m[2] as Side } : null;
}
export const backendNodeId = (proxyId: string): string => proxyId + BACKEND_SUFFIX;

/** Every structural edge: ring, tool loop, backend ports, bootstrap and auxiliary taps. */
export function structuralEdges(body: PipelineBody): StructuralEdge[] {
  const edges = ringEdges(body);
  const ids = new Set(body.components.map(c => c.id));
  for (const c of body.components) {
    if (c.role === "loop" && typeof c.caller === "string" && ids.has(c.caller)) {
      edges.push({ id: `loop:${c.caller}->${c.id}`, kind: "loop", source: c.caller, target: c.id });
      edges.push({ id: `loop-return:${c.id}->${c.caller}`, kind: "loop-return", source: c.id, target: c.caller, dashed: true });
    }
    if (c.kind === "mcpproxy" && typeof c.backend === "string" && c.backend) edges.push({ id: `backend:${c.id}`, kind: "backend", source: c.id, target: backendNodeId(c.id) });
    if (c.role === "aux") {
      const tap = parseTap(c.taps);
      if (tap && ids.has(tap.componentId)) edges.push({ id: `aux:${c.id}`, kind: "aux", source: halfId(tap.componentId, tap.side), target: c.id, dashed: true });
    }
  }
  for (const proxy of llmProxies(body)) {
    if (typeof proxy.vectorStore === "string" && ids.has(proxy.vectorStore)) edges.push({ id: `aux:${proxy.vectorStore}`, kind: "aux", source: halfId(proxy.id, "response"), target: proxy.vectorStore, dashed: true });
  }
  const proxy = primaryProxy(body);
  if (body.psp && proxy) {
    edges.push({ id: "bootstrap:document", kind: "bootstrap", source: PSP_NODE, target: halfId(proxy.id, "request") });
    edges.push({ id: "bootstrap:context", kind: "bootstrap", source: CONTEXT_NODE, target: halfId(proxy.id, "request") });
  }
  return edges;
}

export type Attachment = "ring" | "terminal" | "loop" | "tap" | "free" | "extra";
/** Where a component hangs: on the ring, as a terminal, in the tool loop, as a tap, or free. */
export function attachment(body: PipelineBody, c: Component): Attachment {
  const ids = new Set(body.components.map(x => x.id));
  if (c.role === "terminal") {
    const first = body.components.find(x => x.kind === c.kind && x.role === "terminal");
    return (c.kind === "model" || c.kind === "initiator") && first !== c ? "extra" : "terminal";
  }
  if (c.role === "ring") return c.kind === "llmproxy" ? (primaryProxy(body) === c ? "ring" : "extra") : c.side ? "ring" : "free";
  if (c.role === "loop") return typeof c.caller === "string" && ids.has(c.caller) ? "loop" : "free";
  if (c.kind === "vector-store") return llmProxies(body).some(p => p.vectorStore === c.id) ? "tap" : "free";
  const tap = parseTap(c.taps);
  return tap && ids.has(tap.componentId) ? "tap" : "free";
}

/** References to ids that do not exist. */
export function danglingReferences(body: PipelineBody): { componentId: string; key: string; value: string }[] {
  const ids = new Set(body.components.map(c => c.id));
  const out: { componentId: string; key: string; value: string }[] = [];
  for (const c of body.components) {
    if (typeof c.vectorStore === "string" && !ids.has(c.vectorStore)) out.push({ componentId: c.id, key: "vectorStore", value: c.vectorStore });
    if (c.role === "loop" && typeof c.caller === "string" && !ids.has(c.caller)) out.push({ componentId: c.id, key: "caller", value: c.caller });
    const tap = parseTap(c.taps);
    if (tap && !ids.has(tap.componentId)) out.push({ componentId: c.id, key: "taps", value: String(c.taps) });
  }
  return out;
}

export const filtersOf = (proxy: Component | undefined, side: Side): unknown[] => {
  const list = proxy?.filters?.[side];
  return Array.isArray(list) ? list : [];
};
export const hasFilter = (proxy: Component | undefined, side: Side, kind: string): boolean => filtersOf(proxy, side).some(s => filterKind(s) === kind);

/** Default MCP server segment: the backend URL's last path segment, reduced to the URI-safe alphabet. */
export function serverName(proxy: Component): string {
  if (typeof proxy.server === "string" && proxy.server) return proxy.server;
  try {
    const url = new URL(String(proxy.backend));
    const last = url.pathname.split("/").filter(Boolean).pop() ?? url.hostname.split(".")[0] ?? proxy.id;
    return last.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || proxy.id;
  } catch { return proxy.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64); }
}

/** CDL capabilities each sink exercises when a reply is delivered through it. */
export const SINK_CAPABILITIES: Record<string, string[]> = {
  chat: ["can-display"],
  file: ["can-write-filesystem", "persists-data"],
  email: ["can-send-email"],
  webhook: ["can-transmit-externally"],
  schedule: ["persists-data"]
};
export function sinkCapabilities(initiator: Component | undefined): string[] {
  if (!initiator || replyMode(initiator) === "none") return [];
  return SINK_CAPABILITIES[String(initiator.trigger)] ?? [];
}
/** Capabilities an auxiliary tap exercises on what it receives. */
export const TAP_CAPABILITIES: Record<string, string[]> = { logger: ["logs-data"], otel: ["logs-operations", "can-transmit-externally"] };
