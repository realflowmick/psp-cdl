// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@psp-cdl/core";
import { LockdownError, ContextLlmLoop, DurableLlmLoop, RefreshingLlmLoop } from "@psp-cdl/llmproxy";
import type { ObserveEvent, ObserveOptions } from "@psp-cdl/mcpproxy";
import { classifyObserverEvent, type EngineEvent, type LiveLoopScenario, type PreparedRun, type RunSummary } from "@psp-cdl/studio-core";
import { EngineError, type Engine, type EngineContext, type PrepareContext } from "../types.js";
import { buildHarness, resolveApplication, signingMaterial, OPERATOR_TOKEN, type Harness } from "./harness.js";

export const admissionDigest = (scenario: LiveLoopScenario): string => createHash("sha256").update(canonicalJson(scenario)).digest("hex");
const isLive = (scenario: LiveLoopScenario): boolean => scenario.provider.kind !== "mock";

function observer(emit: (event: EngineEvent) => void, turn: () => number, inspect: boolean): ObserveOptions {
  return {
    observer: (e: ObserveEvent) => emit({
      source: e.source, type: e.type, severity: classifyObserverEvent(e.type, e.data), turn: turn(),
      ...(e.scope.step !== undefined ? { step: e.scope.step } : {}), ...(e.scope.round !== undefined ? { round: e.scope.round } : {}),
      data: { ...e.data, scope: e.scope }
    }),
    level: inspect ? "inspect" : "digest"
  };
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "UNEXPECTED_ERROR";
}

/** Runs a scenario's turns through the reference loops in-process. The model's decisions are observed, never replaced. */
export class LiveLoopEngine implements Engine<LiveLoopScenario> {
  readonly kind = "live-loop" as const;
  async prepare(scenario: LiveLoopScenario, context: PrepareContext): Promise<PreparedRun> {
    const warnings: string[] = [];
    const app = resolveApplication(scenario, context);
    const signing = signingMaterial(context);
    if (signing.source === "ephemeral") warnings.push("No signing key is stored in the vault; prompts are signed with a per-run ephemeral HMAC key.");
    if (isLive(scenario) && scenario.clock === "virtual") warnings.push("Live providers run on the wall clock; the virtual clock setting is ignored.");
    if (scenario.provider.kind === "openai" && scenario.provider.model) warnings.push("The OpenAI adapter pins its own model; the scenario's model field is informational.");
    if (scenario.refresh && scenario.refresh.ttl <= (scenario.refresh.grace ?? 300)) warnings.push("refresh.ttl is within the grace window, so every turn will trigger an expiration refresh.");
    if (scenario.interpreter === "none") warnings.push("No interpreter instructions are attached; the model receives the application text alone.");
    const dir = mkdtempSync(join(tmpdir(), "psp-studio-prepare-"));
    let harness: Harness | undefined;
    try {
      harness = await buildHarness(scenario, context, { dir, runId: "prepare", observe: undefined, emit: () => {}, cancelled: () => false, live: isLive(scenario) });
      return {
        engine: "live-loop", scenarioId: scenario.id,
        preview: {
          loop: scenario.loop, interpreter: scenario.interpreter, clock: isLive(scenario) ? "wall" : scenario.clock,
          provider: { kind: scenario.provider.kind, id: harness.provider.id, revision: harness.provider.revision, live: isLive(scenario) },
          tools: scenario.tools.map(t => `${t.server}.${t.name}`), nodes: app.nodes, turns: scenario.turns.length,
          promptBytes: Buffer.byteLength(app.text), signing: harness.signing, inspectAllowed: context.inspectAllowed
        },
        ...(isLive(scenario) ? { admissionDigest: admissionDigest(scenario) } : {}),
        warnings
      };
    } finally {
      harness?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  async run(scenario: LiveLoopScenario, context: EngineContext): Promise<RunSummary> {
    if (isLive(scenario) && context.admissionDigest !== admissionDigest(scenario)) throw new EngineError("NOT_ADMITTED", "Live runs require the admission digest from prepare.");
    const harness = await buildHarness(scenario, context, { dir: context.artifactDir, runId: context.runId, observe: observer(context.emit, () => harness.state.turn, context.inspect), emit: context.emit, cancelled: context.cancelled, live: isLive(scenario) });
    const turns: Record<string, unknown>[] = [];
    try {
      context.emit({ source: "studio", type: "studio.run.prepared", severity: "info", data: { sessionId: harness.sessionId, loop: scenario.loop, provider: { id: harness.provider.id, revision: harness.provider.revision }, signing: harness.signing, clock: harness.clock.kind, tools: scenario.tools.map(t => `${t.server}.${t.name}`) } });
      let waiting: Record<string, unknown> | null = null;
      for (const [index, turn] of scenario.turns.entries()) {
        if (context.cancelled()) break;
        const number = index + 1;
        harness.state.turn = number;
        const session = await harness.store.execute(harness.actor, { action: "getSession", sessionId: harness.sessionId });
        const requestId = turn.requestId ?? `turn-${number}`;
        const deadline = harness.clock.now() + scenario.limits.deadlineSeconds;
        const controls = { deadline, cancelled: context.cancelled, maxSteps: scenario.limits.maxSteps };
        context.emit({ source: "studio", type: "studio.turn.start", severity: "info", turn: number, data: { turn: number, requestId, sessionVersion: session.version, message: turn.message, deadline } });
        const record: Record<string, unknown> = { turn: number, requestId };
        try {
          let result: Record<string, unknown>;
          const { loop } = harness;
          if (loop instanceof ContextLlmLoop) {
            const options = { ...controls, requestId, maxRounds: scenario.limits.maxRounds ?? 4 };
            if (waiting) {
              const checkpointId = String(((waiting.result as Record<string, unknown>)?.result as Record<string, unknown>)?.checkpointId ?? "");
              const current = await harness.store.execute(harness.actor, { action: "getSession", sessionId: harness.sessionId });
              context.emit({ source: "studio", type: "studio.checkpoint.resume", severity: "warn", turn: number, data: { checkpointId, note: "Operator-approved resume performed by the studio host." } });
              result = await loop.resumeAndRun(OPERATOR_TOKEN, harness.sessionId, { requestId: `${requestId}-resume`, checkpointId, state: current.state }, { message: turn.message }, options);
              waiting = null;
            } else result = await loop.run(OPERATOR_TOKEN, harness.sessionId, { message: turn.message }, options);
            if (result.status === "waiting") waiting = result.receipt as Record<string, unknown>;
          } else if (loop instanceof DurableLlmLoop || loop instanceof RefreshingLlmLoop) {
            result = await loop.run(OPERATOR_TOKEN, harness.sessionId, { message: turn.message }, { ...controls, requestId, expectedVersion: session.version as number });
          } else {
            result = await loop.run(OPERATOR_TOKEN, harness.sessionId, { message: turn.message }, controls);
          }
          record.code = "OK";
          if (typeof result.text === "string") record.text = result.text;
          if (result.provenance) record.provenance = result.provenance;
          if (result.receipt) record.receipt = result.receipt;
          if (result.status) record.status = result.status;
          context.emit({ source: "studio", type: "studio.turn.end", severity: "success", turn: number, data: { ...record } });
        } catch (e) {
          record.code = errorCode(e);
          if (e instanceof LockdownError) record.response = e.response;
          context.emit({ source: "studio", type: "studio.turn.end", severity: record.code === "CANCELLED" ? "warn" : "error", turn: number, data: { ...record } });
        }
        const after = await harness.store.execute(harness.actor, { action: "getSession", sessionId: harness.sessionId });
        record.sessionVersion = after.version; record.sessionStatus = after.status;
        context.emit({ source: "studio", type: "studio.session", severity: "info", turn: number, data: { version: after.version, status: after.status, nodeId: after.nodeId, nodeVersion: after.nodeVersion, stateBytes: Buffer.byteLength(canonicalJson(after.state)), ...(after.llmCompletion ? { completion: after.llmCompletion } : {}), ...(context.inspect ? { state: after.state } : {}) } });
        turns.push(record);
      }
      const final = await harness.store.execute(harness.actor, { action: "getSession", sessionId: harness.sessionId });
      const cancelled = context.cancelled();
      return {
        status: cancelled ? "cancelled" : "completed",
        summary: { turns, session: { id: harness.sessionId, version: final.version, status: final.status, ...(final.llmCompletion ? { completion: final.llmCompletion } : {}) }, providerCalls: harness.state.providerCalls, toolCalls: harness.state.toolCalls, signing: harness.signing, clock: harness.clock.kind },
        ...(cancelled ? { error: { code: "CANCELLED" } } : {})
      };
    } finally {
      harness.close();
    }
  }
}
