// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { signEnvelope } from "@psp-cdl/core/crypto";
import type { Envelope } from "@psp-cdl/core";
import type { Principal } from "@psp-cdl/api-server";
import type { PolicyInput } from "@psp-cdl/cdl";
import { OwnerCoordinator, WorkflowStore, type AccessContext } from "@psp-cdl/api-server/persistence";
import { SqliteBackend } from "@psp-cdl/api-server/sqlite";
import { WorkflowService } from "@psp-cdl/api-server/workflow";
import { McpDispatchGate, bindingDigest, type DispatchHost, type ObserveOptions, type ToolRegistration } from "@psp-cdl/mcpproxy";
import { BufferedLlmLoop, ContextLlmLoop, DurableLlmLoop, RefreshingLlmLoop, promptContext, createOpenAIChatProvider, CONTEXT_SERVICE_PROFILE, OPENAI_CONTEXT_PROFILE, OPENAI_CHAT_INPUT_RESERVATION,
  type ContextHost, type DurableHost, type LoopAuthority, type LoopHost, type ProviderRegistration, type RefreshHost, type TurnPlan } from "@psp-cdl/llmproxy";
import type { EngineEvent, LiveLoopScenario, PolicyResource, SyntheticTool } from "@psp-cdl/studio-core";
import { ed25519PublicKey } from "../../secrets/vault.js";
import { EngineError, type EngineServices } from "../types.js";
import { createAnthropicProvider, describeAnthropicFailure } from "./anthropic.js";

/** Fixed operator credential. It never appears in model-visible text and identifies no real principal. */
export const OPERATOR_TOKEN = "studio-operator";
const SCOPES = ["tools:list", "tools:call", "models:invoke", "sessions:read", "sessions:write", "nodes:read", "checkpoints:write", "checkpoints:resume"];
const PRINCIPAL: Principal = { tenantId: "studio", subjectId: "operator", scopes: SCOPES };
const POLICY_VERSION = "policy-1", AUTHORITY_REVISION = "authority-1", REGISTRY_REVISION = "registry-1";
const DAY = 86_400;
const INTERPRETER_FILES = { psp: "specs/systemprompts/PSP-Core-v3_2_0-Interpreter-draft-0_1.md", cdl: "specs/systemprompts/CDL-v1_5-Interpreter-draft-0_1.md" };

export interface Clock { readonly kind: "wall" | "virtual"; now(): number; advance(seconds: number): void }
export function makeClock(kind: "wall" | "virtual"): Clock {
  if (kind === "wall") return { kind, now: () => Math.floor(Date.now() / 1000), advance: () => {} };
  let t = 1_700_000_000;
  return { kind, now: () => t, advance: s => { t += s; } };
}

export interface SigningMaterial { source: "vault" | "ephemeral"; algorithm: "hmac-sha256" | "ed25519"; keyId: string; material: Uint8Array }
export function signingMaterial(services: EngineServices): SigningMaterial {
  const key = services.vault.signingKey();
  if (key) return { source: "vault", ...key };
  return { source: "ephemeral", algorithm: "hmac-sha256", keyId: "studio-ephemeral", material: new Uint8Array(randomBytes(32)) };
}

export interface ApplicationText { text: string; nodes: { nodeId: string; nodeVersion: string }[]; interpreter: LiveLoopScenario["interpreter"]; pspInstructions: string; cdlInstructions: string; application: string }
export function resolveApplication(scenario: LiveLoopScenario, services: EngineServices): ApplicationText {
  const application = ("file" in scenario.application ? services.workspace.read(scenario.application.file).text : scenario.application.source).replace(/\r\n?/g, "\n");
  if (!application.trim()) throw new EngineError("EMPTY_APPLICATION", "The application text is empty.");
  let pspInstructions = "", cdlInstructions = "";
  if (scenario.interpreter === "psp-core-3.2-draft-0.1") {
    for (const [key, rel] of Object.entries(INTERPRETER_FILES)) {
      const file = join(services.repoRoot, rel);
      if (!existsSync(file)) throw new EngineError("INTERPRETER_MISSING", `${rel} is not present in the repository.`);
      const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
      if (key === "psp") pspInstructions = text; else cdlInstructions = text;
    }
  }
  const nodes: ApplicationText["nodes"] = [];
  for (const match of application.matchAll(/\$\{psp\s+type=node\b[^}]*?\bid="([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"[^}]*?\bversion="([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"/g)) {
    if (!nodes.some(n => n.nodeId === match[1] && n.nodeVersion === match[2])) nodes.push({ nodeId: match[1]!, nodeVersion: match[2]! });
  }
  const text = scenario.interpreter === "none" ? application : [pspInstructions, cdlInstructions, application].join("\n\n");
  return { text, nodes, interpreter: scenario.interpreter, pspInstructions, cdlInstructions, application };
}

function resource(value: PolicyResource): PolicyInput {
  return { classes: [...value.classes], covenants: [...value.covenants], capabilities: [...value.capabilities], checks: {}, parameters: {}, context: {} };
}

export interface HarnessState { turn: number; providerCalls: number; toolCalls: number; checkpoints: Map<string, string> }

export interface Harness {
  sessionId: string;
  store: WorkflowStore;
  gate: McpDispatchGate;
  provider: ProviderRegistration;
  loop: BufferedLlmLoop | DurableLlmLoop | RefreshingLlmLoop | ContextLlmLoop;
  service: WorkflowService | null;
  clock: Clock;
  state: HarnessState;
  signing: Omit<SigningMaterial, "material">;
  expiresAt: number;
  actor: { tenantId: string; subjectId: string };
  close(): void;
}

export interface HarnessOptions {
  dir: string;
  runId: string;
  observe: ObserveOptions | undefined;
  emit: (event: EngineEvent) => void;
  cancelled: () => boolean;
  /** The engine's live providers need the real clock; the harness enforces it. */
  live: boolean;
  /** Pipelines: registrations from MCP backends instead of the scenario's synthetic tools. */
  registrations?: ToolRegistration[];
  /** Pipelines: a provider built by the caller instead of the scenario's. */
  provider?: ProviderRegistration;
  /** Pipelines: the final-output decision, for example the exfiltration check. Allows by default. */
  authorizeFinal?: LoopHost["authorizeFinal"];
  /** Pipelines: signing material chosen by the caller (sign on retrieval). */
  signing?: SigningMaterial;
}

function toolRegistrations(scenario: LiveLoopScenario, clock: Clock, state: HarnessState): ToolRegistration[] {
  return scenario.tools.map((t: SyntheticTool) => ({
    server: t.server, name: t.name, revision: t.revision ?? "tool-1", readOnly: true, complete: true,
    sources: [{ id: "server", capabilities: [...(t.capabilities ?? [])] }],
    inputSchema: structuredClone(t.inputSchema), outputSchema: structuredClone(t.outputSchema),
    invoke: async (args: Record<string, unknown>) => {
      state.toolCalls++; clock.advance(1);
      if (t.response.kind === "fail") throw new Error("SYNTHETIC_TOOL_FAILURE");
      return t.response.kind === "echo" ? args : structuredClone(t.response.data);
    }
  }));
}

function makeProvider(scenario: LiveLoopScenario, services: EngineServices, clock: Clock, state: HarnessState, emit: HarnessOptions["emit"]): ProviderRegistration {
  const sources = [{ id: "provider", capabilities: [...(scenario.providerCapabilities ?? [])] }];
  const p = scenario.provider;
  if (p.kind === "mock") {
    let turn = -1, index = 0;
    return {
      id: "mock", revision: "script-1", sources, complete: true,
      invoke: async () => {
        state.providerCalls++; clock.advance(1);
        if (turn !== state.turn) { turn = state.turn; index = 0; }
        const replies = p.script[state.turn - 1] ?? [];
        const reply = replies[index++];
        if (!reply) throw new Error("SCRIPT_EXHAUSTED");
        return structuredClone(reply);
      }
    };
  }
  if (p.kind === "anthropic") {
    const apiKey = services.vault.get("anthropic.apiKey");
    if (!apiKey) throw new EngineError("CREDENTIAL_MISSING", "Store anthropic.apiKey on the Secrets page before running an Anthropic model.");
    const inner = createAnthropicProvider({
      apiKey, model: p.model, sources, complete: true, now: () => clock.now(),
      limits: { maxRequestBytes: 1_048_576, maxResponseBytes: 1_048_576, maxOutputTokens: p.maxOutputTokens ?? 4096, maxCalls: 32, budgetTokens: 2_000_000, timeoutMs: p.timeoutMs ?? 120_000 },
      onUsage: usage => emit({ source: "provider", type: "provider.usage", severity: "info", turn: state.turn, data: { ...usage } }),
      onFailure: failure => emit({ source: "provider", type: "provider.error", severity: "error", turn: state.turn, data: { ...failure, message: describeAnthropicFailure(failure) } }),
      ...(scenario.loop === "context" ? { transcript: true } : {}),
      ...(services.fetch ? { fetch: services.fetch } : {})
    });
    return { ...inner, invoke: (request, options) => { state.providerCalls++; return inner.invoke(request, options); } };
  }
  const apiKey = services.vault.get("openai.apiKey");
  if (!apiKey) throw new EngineError("CREDENTIAL_MISSING", "Store an OpenAI API key in the studio vault before running a live scenario.");
  const maxOutputTokens = p.maxOutputTokens ?? 2048, maxCalls = 32;
  const inner = createOpenAIChatProvider({
    mode: "live", allowLive: true, apiKey, sources, complete: true, now: () => clock.now(),
    // The reference adapter reserves its whole input window plus the output cap per call and never releases
    // it, so the budget must cover maxCalls reservations or the second call in a session is refused.
    limits: { maxRequestBytes: 1_048_576, maxResponseBytes: 1_048_576, maxOutputTokens, maxCalls, budgetTokens: maxCalls * (OPENAI_CHAT_INPUT_RESERVATION + maxOutputTokens), timeoutMs: p.timeoutMs ?? 60_000 },
    onUsage: usage => emit({ source: "provider", type: "provider.usage", severity: "info", turn: state.turn, data: { ...usage } }),
    ...(scenario.loop === "context" ? { transcriptProfile: OPENAI_CONTEXT_PROFILE } : {})
  });
  return { ...inner, invoke: (request, options) => { state.providerCalls++; return inner.invoke(request, options); } };
}

/** Builds every host-side object for one scenario. Construction validates schemas, policies and configuration. */
export async function buildHarness(scenario: LiveLoopScenario, services: EngineServices, options: HarnessOptions): Promise<Harness> {
  if (scenario.loop === "context" && scenario.interpreter === "none") throw new EngineError("UNSUPPORTED_CONFIGURATION", "The context loop requires the interpreter instructions; set interpreter to psp-core-3.2-draft-0.1.");
  const app = resolveApplication(scenario, services);
  const clock = makeClock(options.live ? "wall" : scenario.clock);
  const signing = options.signing ?? signingMaterial(services);
  const state: HarnessState = { turn: 0, providerCalls: 0, toolCalls: 0, checkpoints: new Map() };
  const start = clock.now(), expiresAt = start + DAY;
  const refresh = scenario.refresh;
  const ttl = refresh?.ttl ?? DAY;
  const template = { version: "1.0.0", timestamp: start, expires: start + ttl, text: app.text };
  const refreshAttributes = (): Record<string, string> => refresh ? {
    "refresh-policy": refresh.policy,
    ...(refresh.policy.includes("interval") ? { "refresh-interval": String(refresh.interval) } : {}),
    ...(refresh.grace !== undefined ? { "refresh-grace": String(refresh.grace) } : {})
  } : {};
  const sign = (binding: Record<string, unknown>): Envelope => signEnvelope(template.text, {
    algorithm: signing.algorithm, signatureVersion: "2.0", ...(signing.algorithm === "ed25519" ? { kid: signing.keyId } : { secretId: signing.keyId }),
    timestamp: template.timestamp, expires: template.expires, version: template.version, sectionType: "system", contentType: "text", trustLevel: 2,
    attributes: { ...promptContext(binding), ...refreshAttributes() }
  }, signing.material);
  const verificationMaterial = signing.algorithm === "ed25519" ? ed25519PublicKey(signing.material) : signing.material;

  const backend = new SqliteBackend(join(options.dir, "state.sqlite"), `studio-${options.runId}`.replace(/[^A-Za-z0-9._:-]/g, "-"), () => clock.now());
  const coordinator = new OwnerCoordinator();
  const durable = scenario.loop === "durable" || scenario.loop === "refreshing";
  const store = new WorkflowStore(backend, { resumeSecret: new Uint8Array(randomBytes(32)), authorizePersistence: () => true, coordinator, durableTurns: durable, promptRefresh: scenario.loop === "refreshing" });
  const close = () => { try { backend.close(); } catch { /* already closed */ } };
  try {
    const actor = { tenantId: PRINCIPAL.tenantId, subjectId: PRINCIPAL.subjectId };
    const agents = scenario.node.agents.join(",");
    const nodes = [{ nodeId: scenario.node.nodeId, nodeVersion: scenario.node.nodeVersion }, ...app.nodes.filter(n => n.nodeId !== scenario.node.nodeId || n.nodeVersion !== scenario.node.nodeVersion)];
    for (const node of nodes) await store.execute(actor, { action: "putNode", nodeId: node.nodeId, nodeVersion: node.nodeVersion, definition: { agents } });
    const session = await store.execute(actor, { action: "createSession", requestId: "studio-seed", nodeId: scenario.node.nodeId, nodeVersion: scenario.node.nodeVersion, policyVersion: POLICY_VERSION, expiresAt, state: structuredClone(scenario.initialState) });
    const sessionId = session.sessionId as string;

    const provider = options.provider ?? makeProvider(scenario, services, clock, state, options.emit);
    const policyFor = (phase: string, step: unknown): PolicyInput => {
      const override = [...(scenario.policy.overrides ?? [])].reverse().find(o => o.phase === phase && (o.turn === undefined || o.turn === state.turn) && (o.step === undefined || o.step === step));
      return resource(override ? override.resource : scenario.policy.default);
    };
    const authenticate = (token: string) => token === OPERATOR_TOKEN ? { ...PRINCIPAL, scopes: [...SCOPES] } : null;
    const releaseSources = [{ id: "operator", capabilities: [...(scenario.releaseCapabilities ?? [])] }];
    const dispatchHost: DispatchHost = {
      authenticate, now: () => clock.now(),
      snapshot: () => ({ revision: AUTHORITY_REVISION, policyVersion: POLICY_VERSION, registryRevision: REGISTRY_REVISION, expires: expiresAt, releaseSources: structuredClone(releaseSources), releaseComplete: true }),
      policy: (_p, binding, _data, phase) => ({ bindingDigest: bindingDigest(binding), resources: [policyFor(phase, undefined)] })
    };
    const gate = new McpDispatchGate(store, dispatchHost, REGISTRY_REVISION, options.registrations ?? toolRegistrations(scenario, clock, state), options.observe);
    const loopHost: LoopHost = {
      authenticate, now: () => clock.now(),
      snapshot: (): LoopAuthority => ({ revision: AUTHORITY_REVISION, policyVersion: POLICY_VERSION, providerId: provider.id, providerRevision: provider.revision, registryRevision: REGISTRY_REVISION, expires: expiresAt, releaseSources: structuredClone(releaseSources), releaseComplete: true }),
      prompt: (_p, binding) => sign(binding),
      verification: () => ({ keys: [{ id: signing.keyId, algorithm: signing.algorithm, material: verificationMaterial, status: "active", trustLevels: [1, 2, 5], sectionTypes: ["system"], scope: {}, allowUnscoped: false }] }),
      policy: (_p, binding, _data, phase) => ({ bindingDigest: bindingDigest(binding), resources: [policyFor(phase, binding.step)] }),
      authorizeFinal: options.authorizeFinal ?? (() => true)
    };
    const audit = (kind: string) => (_p: Principal, event: Record<string, unknown>): boolean => {
      options.emit({ source: "studio", type: `studio.${kind}`, severity: "info", turn: state.turn, data: structuredClone(event) });
      return true;
    };
    const planTurn = async (_p: Principal, _binding: Record<string, unknown>, data: Record<string, unknown>): Promise<TurnPlan> => {
      const text = String((data.candidate as Record<string, unknown> | undefined)?.text ?? "");
      const current = await store.execute(actor, { action: "getSession", sessionId });
      const previous = (current.state ?? {}) as Record<string, unknown>;
      let next: Record<string, unknown>;
      if (scenario.plan.statePolicy === "replace") next = { answer: text, turn: state.turn };
      else {
        let modelState: Record<string, unknown> | null = null;
        if (scenario.plan.statePolicy === "model-state") {
          try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state)) modelState = parsed.state; } catch { /* not JSON: accumulate instead */ }
        }
        next = modelState ?? { ...previous, turns: [...(Array.isArray(previous.turns) ? previous.turns : []), { turn: state.turn, text }] };
      }
      return { state: next, retained: { covenants: [...scenario.policy.default.covenants] }, complete: scenario.plan.completeOnTurn === state.turn };
    };
    const durableHost: DurableHost = {
      ...loopHost, planTurn,
      authorizeTransition: (_p: Principal, _context: AccessContext) => true,
      audit: audit("audit"),
      authorizeRecovery: () => true,
      recoveryPolicy: (_p, binding) => ({ bindingDigest: bindingDigest(binding), resources: [policyFor("recovery", undefined)] })
    };
    const refreshHost: RefreshHost = {
      ...durableHost,
      refresh: (_p, binding) => {
        const [major, minor, patch] = template.version.split(".").map(Number) as [number, number, number];
        template.version = `${major}.${minor}.${patch + 1}`;
        clock.advance(1);
        template.timestamp = clock.now(); template.expires = template.timestamp + ttl;
        return sign(binding);
      },
      authorizeRefresh: () => true,
      auditRefresh: audit("refresh.audit")
    };
    let service: WorkflowService | null = null;
    let loop: Harness["loop"];
    if (scenario.loop === "buffered") loop = new BufferedLlmLoop(store, gate, loopHost, provider, options.observe);
    else if (scenario.loop === "durable") loop = new DurableLlmLoop(store, gate, durableHost, provider, { postCompletion: "lockdown" }, options.observe);
    else if (scenario.loop === "refreshing") loop = new RefreshingLlmLoop(store, gate, refreshHost, provider, { postCompletion: "lockdown" }, options.observe);
    else {
      const contextHost: ContextHost = {
        authenticate, now: () => clock.now(), snapshot: loopHost.snapshot, verification: loopHost.verification, policy: loopHost.policy, authorizeFinal: loopHost.authorizeFinal,
        signContext: (_p, binding, text) => { template.text = text; return sign(binding); }
      };
      service = new WorkflowService(store, {
        authenticate, now: () => clock.now(), resolve: () => null, policyVersion: () => POLICY_VERSION,
        authorize: () => true,
        present: (_p, _operation, data) => data,
        deliverCheckpoint: (_p, checkpoint) => { state.checkpoints.set(String(checkpoint.checkpointId), String(checkpoint.resumeToken)); },
        resumeToken: (_p, id) => state.checkpoints.get(id) ?? null
      });
      loop = new ContextLlmLoop(store, gate, contextHost, provider, service, { profile: CONTEXT_SERVICE_PROFILE, pspInstructions: app.pspInstructions, cdlInstructions: app.cdlInstructions, application: app.application, serviceSources: [{ id: "workflow", capabilities: [] }], serviceComplete: true }, options.observe);
    }
    return { sessionId, store, gate, provider, loop, service, clock, state, signing: { source: signing.source, algorithm: signing.algorithm, keyId: signing.keyId }, expiresAt, actor, close };
  } catch (e) {
    close();
    throw e;
  }
}
