// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { formatConfig, parsePspp, ringOrder } from "@psp-cdl/studio-core";
import EXAMPLE from "../../../examples/pipelines/evaluator-ring.pspp?raw";
import { applyIntent, dropIntent, intentLabel } from "../src/pipeline/drop";
import { arrange, edgeSpecs, handlePoint } from "../src/pipeline/layout";
import { jsonRanges, rangeFor } from "../src/pipeline/jsonPaths";
import { parseDocument, problemPath } from "../src/pages/pipelines/DocumentMode";

const config = () => parsePspp(EXAMPLE);
const card = (cards: ReturnType<typeof arrange>, id: string) => cards.find(c => c.id === id)!;
const center = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

describe("auto-arrange", () => {
  it("is deterministic and follows the topology: request up the left, Model top, response down the right", () => {
    const cards = arrange(config());
    expect(arrange(config())).toEqual(cards);
    const model = card(cards, "model_1").rect, initiator = card(cards, "initiator_1").rect;
    const request = card(cards, "llmproxy_1.request").rect, response = card(cards, "llmproxy_1.response").rect;
    expect(model.y).toBe(0);
    expect(initiator.y).toBeGreaterThan(request.y);
    expect(request.x).toBeLessThan(model.x);
    expect(response.x).toBeGreaterThan(model.x);
    expect(card(cards, "mcpproxy_1").rect.y).toBe(0);
    expect(card(cards, "mcpproxy_1.backend").rect.y).toBeGreaterThan(0);
    expect(card(cards, "psp-document").rect.x).toBeLessThan(request.x);
    expect(card(cards, "log_1").rect.x).toBeGreaterThan(response.x);
    expect(card(cards, "protected_vectors").type).toBe("aux");
    const edges = edgeSpecs(config(), cards).map(e => `${e.kind}:${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`);
    expect(edges).toContain("request:initiator_1.out->llmproxy_1.request.in");
    expect(edges).toContain("loop-return:mcpproxy_1.out->model_1.in");
    expect(edges).toContain("aux:llmproxy_1.response.aux->log_1.in");
    expect(edges).toContain("bootstrap:psp-document.out->llmproxy_1.request.boot");
  });
  it("draws the ring open with a terminator when the Initiator has no sink", () => {
    const c = config();
    c.components = c.components.map(x => x.id === "initiator_1" ? { ...x, trigger: "email", mailbox: "intake@keystone.example", reply: "none" } : x);
    const cards = arrange(c);
    expect(cards.some(x => x.type === "terminator")).toBe(true);
    expect(edgeSpecs(c, cards).some(e => e.target === "terminator")).toBe(true);
    expect(edgeSpecs(c, cards).some(e => e.kind === "response" && e.target === "initiator_1")).toBe(false);
  });
});

describe("drop intents", () => {
  it("splices a ring item into the nearest ring edge within 24 px, else leaves it free", () => {
    const c = config(), cards = arrange(c), edges = edgeSpecs(c, cards);
    const edge = edges.find(e => e.kind === "request" && e.target === "model_1")!;
    const a = handlePoint(card(cards, edge.source), edge.sourceHandle), b = handlePoint(card(cards, edge.target), edge.targetHandle);
    const mid = { x: (a.x + b.x) / 2 + 10, y: (a.y + b.y) / 2 };
    const item = { role: "ring" as const, kind: "redactor", label: "Redactor" };
    const intent = dropIntent(c, item, mid, cards, edges);
    expect(intent).toEqual({ kind: "splice", edge: ["llmproxy_1.request", "model_1"], side: "request" });
    expect(intentLabel(c, item, intent)).toBe("Insert inline · splice LLMProxy → Model");
    expect(dropIntent(c, item, { x: mid.x + 200, y: mid.y }, cards, edges).kind).toBe("free");
    const applied = applyIntent(c, item, intent);
    expect(ringOrder(applied.config)).toEqual(["initiator_1", "llmproxy_1.request", "redactor_1", "model_1", "llmproxy_1.response", "initiator_1"]);
  });
  it("puts a filter into the half of its side, at the slot under the pointer, and refuses elsewhere", () => {
    const c = config(), cards = arrange(c), edges = edgeSpecs(c, cards);
    const half = card(cards, "llmproxy_1.response").rect;
    const item = { role: "filter" as const, kind: "covenant-gate", label: "Covenant Gate" };
    const intent = dropIntent(c, item, { x: half.x + 20, y: half.y + 60 + 26 }, cards, edges);
    expect(intent).toEqual({ kind: "slot", componentId: "llmproxy_1", side: "response", index: 1 });
    expect(intentLabel(c, item, intent)).toBe("Insert as response filter · slot 2 of llmproxy_1");
    expect(dropIntent(c, item, center(card(cards, "llmproxy_1.request").rect), cards, edges)).toEqual({ kind: "refuse", reason: "Covenant Gate is a response filter" });
    expect(dropIntent(c, item, { x: -500, y: -500 }, cards, edges).kind).toBe("refuse");
  });
  it("taps an auxiliary dropped within 48 px of the response half, attaches loops in the top row and bootstraps on the slot", () => {
    const c = config(), cards = arrange(c), edges = edgeSpecs(c, cards);
    const half = card(cards, "llmproxy_1.response").rect;
    const logger = { role: "aux" as const, kind: "logger", label: "Logger" };
    expect(dropIntent(c, logger, { x: half.x + half.w + 40, y: half.y + 10 }, cards, edges)).toEqual({ kind: "tap", target: "llmproxy_1", side: "response" });
    expect(dropIntent(c, logger, { x: half.x + half.w + 400, y: half.y + 10 }, cards, edges).kind).toBe("free");
    const added = applyIntent(c, logger, { kind: "tap", target: "llmproxy_1", side: "response" });
    expect(added.config.components.at(-1)).toMatchObject({ id: "log_2", kind: "logger", taps: "llmproxy_1.response" });
    const free = applyIntent(c, logger, { kind: "free", at: { x: 1, y: 2 } });
    expect(free.config.components.at(-1)!.taps).toBeUndefined();
    expect(free.free).toEqual({ id: "log_2", at: { x: 1, y: 2 } });
    const loop = { role: "loop" as const, kind: "mcpproxy", label: "MCPProxy" };
    expect(dropIntent(c, loop, { x: 1300, y: 20 }, cards, edges)).toEqual({ kind: "attach-loop", caller: "model_1" });
    const boot = { role: "bootstrap" as const, kind: "psp-document", label: "PSP Document" };
    expect(dropIntent(c, boot, center(card(cards, "psp-document").rect), cards, edges)).toEqual({ kind: "attach-bootstrap" });
    expect(dropIntent(c, { role: "ring", kind: "llmproxy", label: "LLMProxy" }, { x: 0, y: 0 }, cards, edges).kind).toBe("refuse");
  });
});

describe("document mode helpers", () => {
  it("maps JSON paths to offsets and parses leniently", () => {
    const text = formatConfig(config());
    const ranges = jsonRanges(text)!;
    const r = rangeFor(ranges, ["components", 3, "drift"])!;
    expect(text.slice(r.start, r.end)).toBe("\"refuse\"");
    expect(rangeFor(ranges, ["components", 3, "missing"])).toEqual(ranges.get(JSON.stringify(["components", 3])));
    expect(jsonRanges("{")).toBeNull();
    const loose = text.replace("\"drift\": \"refuse\"", "\"drift\": \"sometimes\"");
    expect("config" in parseDocument(loose)).toBe(true);
    expect(parseDocument("[]")).toEqual({ error: "The document must be one JSON object." });
    expect(problemPath(config(), { id: "x", severity: "error", code: "X", message: "", target: { componentId: "log_1" } })).toEqual(["components", 5]);
  });
});
