// SPDX-License-Identifier: Apache-2.0
import { defaultLiveLoopScenario, type EngineKind, type LiveLoopScenario, type PolicyOverride, type Scenario, type ScenarioCollection, type ScriptedReply, type SyntheticTool } from "@psp-cdl/studio-core";
import type { Templates } from "./api";

/**
 * Pure edits over scenarios. Every operation keeps the cross references consistent: a turn's scripted
 * replies move with it, completion and policy overrides follow turn numbers, and a renamed tool keeps
 * its node affinity and its place in the mock script.
 */
export const FALLBACK_TEMPLATES: Templates = {
  campaignConfig: null,
  heldout: { plan: "conformance/vectors/evaluation/heldout-request-0.1.json", corpus: "conformance/vectors/evaluation/heldout-corpus-0.1.json" },
  jointCaseIds: [],
  studyConditions: ["unprotected", "psp-only", "cdl-only", "combined"],
  languages: ["typescript", "python"]
};
export const ENGINE_LABELS: Record<EngineKind, string> = {
  "live-loop": "Live loop (in-process llmproxy and mcpproxy)",
  campaign: "Campaign (multi-turn evaluation, Python)",
  joint: "Joint interpreter validation (Python)",
  study: "Study runner (Python)",
  heldout: "Held-out executor (Python)"
};

export function uniqueId(prefix: string, taken: readonly string[]): string {
  for (let i = 1; ; i++) { const id = `${prefix}-${i}`; if (!taken.includes(id)) return id; }
}
export const toolName = (t: Pick<SyntheticTool, "server" | "name">): string => `${t.server}.${t.name}`;
export const toolUri = (t: Pick<SyntheticTool, "server" | "name">): string => `mcp://${t.server}/${t.name}`;

export function templateFor(kind: EngineKind, base: { id: string; label: string; description?: string }, templates: Templates): Scenario {
  const common = { id: base.id, label: base.label, ...(base.description ? { description: base.description } : {}) };
  switch (kind) {
    case "live-loop": { const s = defaultLiveLoopScenario(base.id); delete s.description; return { ...s, ...common }; }
    case "campaign": return { kind, ...common, config: structuredClone(templates.campaignConfig ?? {}), live: false };
    case "joint": return { kind, ...common, language: "python", mode: "rehearsal" };
    case "study": return { kind, ...common, mode: "offline", hosts: ["python"], peers: ["python"], conditions: ["combined"], repeats: 1 };
    case "heldout": return { kind, ...common, mode: "rehearsal", plan: templates.heldout.plan, corpus: templates.heldout.corpus };
  }
}

/** Short engine detail for grids: loop and provider, or mode and language. */
export function scenarioDetail(s: Scenario): string {
  switch (s.kind) {
    case "live-loop": return `${s.loop} · ${s.provider.kind}`;
    case "campaign": return s.live ? "live" : "offline";
    case "joint": return `${s.mode} · ${s.language}`;
    case "study": return `${s.mode} · ${s.conditions.join(", ")}`;
    case "heldout": return s.mode;
  }
}

export function replaceScenario(collection: ScenarioCollection, originalId: string | null, scenario: Scenario): ScenarioCollection {
  const index = originalId === null ? -1 : collection.scenarios.findIndex(s => s.id === originalId);
  const scenarios = [...collection.scenarios];
  if (index < 0) scenarios.push(scenario); else scenarios[index] = scenario;
  return { ...collection, scenarios };
}

const isMock = (s: LiveLoopScenario): boolean => s.provider.kind === "mock";
export function scriptFor(s: LiveLoopScenario, index: number): ScriptedReply[] {
  return s.provider.kind === "mock" ? structuredClone(s.provider.script[index] ?? []) : [];
}
function paddedScript(s: LiveLoopScenario, length: number): ScriptedReply[][] {
  const script = s.provider.kind === "mock" ? s.provider.script.map(r => [...r]) : [];
  while (script.length < length) script.push([]);
  return script;
}
function withScript(s: LiveLoopScenario, script: ScriptedReply[][]): LiveLoopScenario {
  return s.provider.kind === "mock" ? { ...s, provider: { kind: "mock", script } } : s;
}
/** Applies a turn-number remapping to completion and policy overrides; null drops the reference. */
function remapTurns(s: LiveLoopScenario, map: (turn: number) => number | null): LiveLoopScenario {
  const complete = s.plan.completeOnTurn;
  const plan = { ...s.plan, ...(complete ? { completeOnTurn: map(complete) } : {}) };
  const overrides = s.policy.overrides?.flatMap((o): PolicyOverride[] => {
    if (o.turn === undefined) return [o];
    const turn = map(o.turn);
    return turn === null ? [] : [{ ...o, turn }];
  });
  return { ...s, plan, policy: { ...s.policy, ...(overrides ? { overrides } : {}) } };
}

/** Writes turn `index` (0-based); `index === turns.length` appends. Replies apply to mock providers only. */
export function putTurn(s: LiveLoopScenario, index: number, turn: LiveLoopScenario["turns"][number], replies?: ScriptedReply[]): LiveLoopScenario {
  const turns = [...s.turns];
  turns[index] = turn;
  let next: LiveLoopScenario = { ...s, turns };
  if (replies && isMock(s)) {
    const script = paddedScript(s, turns.length);
    script[index] = replies;
    next = withScript(next, script);
  }
  return next;
}
export function moveTurn(s: LiveLoopScenario, index: number, delta: number): LiveLoopScenario {
  const target = index + delta;
  if (target < 0 || target >= s.turns.length || delta === 0) return s;
  const turns = [...s.turns];
  [turns[index], turns[target]] = [turns[target]!, turns[index]!];
  let next: LiveLoopScenario = { ...s, turns };
  if (isMock(s)) {
    const script = paddedScript(s, s.turns.length);
    [script[index], script[target]] = [script[target]!, script[index]!];
    next = withScript(next, script);
  }
  const a = index + 1, b = target + 1;
  return remapTurns(next, t => t === a ? b : t === b ? a : t);
}
export function deleteTurn(s: LiveLoopScenario, index: number): LiveLoopScenario {
  const removed = index + 1;
  let next: LiveLoopScenario = { ...s, turns: s.turns.filter((_, i) => i !== index) };
  if (isMock(s)) next = withScript(next, paddedScript(s, s.turns.length).filter((_, i) => i !== index));
  return remapTurns(next, t => t === removed ? null : t > removed ? t - 1 : t);
}

/** Inserts or replaces a tool. A rename carries its node affinity and mock-script references along. */
export function putTool(s: LiveLoopScenario, originalName: string | null, tool: SyntheticTool, allowAtNode: boolean): LiveLoopScenario {
  const index = originalName === null ? -1 : s.tools.findIndex(t => toolName(t) === originalName);
  const previous = index >= 0 ? s.tools[index]! : null;
  const tools = [...s.tools];
  if (index >= 0) tools[index] = tool; else tools.push(tool);
  const oldUri = previous ? toolUri(previous) : null, newUri = toolUri(tool);
  let agents = s.node.agents.filter(a => a !== oldUri && a !== newUri);
  if (allowAtNode) agents = [...agents, newUri];
  let next: LiveLoopScenario = { ...s, tools, node: { ...s.node, agents } };
  if (previous && toolName(previous) !== toolName(tool) && isMock(s)) {
    const from = toolName(previous), to = toolName(tool);
    next = withScript(next, paddedScript(s, 0).map(replies => replies.map(r => r.type === "tool" && r.name === from ? { ...r, name: to } : r)));
  }
  return next;
}
export function deleteTool(s: LiveLoopScenario, name: string): LiveLoopScenario {
  const tool = s.tools.find(t => toolName(t) === name);
  if (!tool) return s;
  return { ...s, tools: s.tools.filter(t => t !== tool), node: { ...s.node, agents: s.node.agents.filter(a => a !== toolUri(tool)) } };
}
/** Mock-script replies that call a tool; used to warn before deleting it. */
export function scriptReferences(s: LiveLoopScenario, name: string): number {
  return s.provider.kind === "mock" ? s.provider.script.flat().filter(r => r.type === "tool" && r.name === name).length : 0;
}

export const LOOP_HINTS: Record<LiveLoopScenario["loop"], string> = {
  buffered: "One buffered turn per message. Nothing persists between turns.",
  durable: "Each turn commits state to the store and restarts from the signed prompt. The session locks after completion.",
  refreshing: "Durable turns plus automatic signed-prompt refresh on interval or expiry.",
  context: "Context/service transport. The model proposes workflow service operations; the host enforces them."
};

/** Changing the loop keeps only the settings that loop understands. */
export function applyLoop(s: LiveLoopScenario, loop: LiveLoopScenario["loop"]): LiveLoopScenario {
  const { refresh, ...rest } = s;
  const next: LiveLoopScenario = { ...rest, loop };
  if (loop === "refreshing") next.refresh = refresh ?? { policy: "interval", interval: 2, ttl: 600 };
  if (loop === "context") {
    next.limits = { ...s.limits, maxRounds: s.limits.maxRounds ?? 4 };
    if (s.interpreter === "none") next.interpreter = "psp-core-3.2-draft-0.1";
  } else if (s.limits.maxRounds !== undefined) {
    const { maxRounds: _unused, ...limits } = s.limits;
    next.limits = limits;
  }
  return next;
}

/** Non-blocking checks shown above the editor; the server and engines still decide. */
export function scenarioChecks(s: Scenario): string[] {
  if (s.kind !== "live-loop") {
    if ((s.kind === "study" || s.kind === "heldout") && s.mode === "live") return [`Live ${s.kind} runs are not supported from the studio; prepare reports UNSUPPORTED_MODE. Use the CLI flow.`];
    return [];
  }
  const checks: string[] = [];
  const names = new Set(s.tools.map(toolName)), atNode = new Set(s.node.agents);
  if (s.provider.kind === "anthropic" && !s.provider.model.trim()) checks.push("The Anthropic adapter needs a model id; prepare reports INVALID_CONFIGURATION without one.");
  if (s.provider.kind === "mock") {
    s.turns.forEach((_, i) => {
      const replies = scriptFor(s, i), n = i + 1;
      if (!replies.length) checks.push(`Turn ${n} has no scripted replies; the mock provider will fail with SCRIPT_EXHAUSTED.`);
      else if (replies[replies.length - 1]!.type !== "final") checks.push(`Turn ${n} ends with a tool call; add a final reply.`);
      if (replies.length > s.limits.maxSteps) checks.push(`Turn ${n} scripts ${replies.length} replies but maxSteps is ${s.limits.maxSteps}.`);
      for (const r of replies) if (r.type === "tool" && names.has(r.name) && !atNode.has(`mcp://${r.name.replace(".", "/")}`)) checks.push(`Turn ${n} calls ${r.name}, which is not available at the starting node; the gate will answer TOOL_NOT_ALLOWED.`);
    });
  }
  const complete = s.plan.completeOnTurn;
  if (complete && complete < s.turns.length && s.loop !== "buffered" && s.loop !== "context") checks.push(`The session completes on turn ${complete}; turns after it will meet the post-completion lockdown.`);
  return [...new Set(checks)];
}