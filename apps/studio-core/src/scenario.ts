// SPDX-License-Identifier: Apache-2.0
/** Scenario definitions a collection holds. Engines interpret them; the browser edits them. */
import type { EngineKind } from "./envelope.js";

export interface PolicyResource { classes: string[]; covenants: string[]; capabilities: string[] }
export interface PolicyOverride { phase: "inference" | "tool" | "release" | "dispatch" | "recovery"; turn?: number; step?: number; resource: PolicyResource }
export type ScriptedReply = { type: "tool"; name: string; arguments: Record<string, unknown> } | { type: "final"; text: string };
export type ToolResponse = { kind: "echo" } | { kind: "static"; data: Record<string, unknown> } | { kind: "fail" };
export interface SyntheticTool {
  server: string; name: string; revision?: string;
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  capabilities?: string[];
  response: ToolResponse;
}
export type LiveProvider =
  | { kind: "mock"; script: ScriptedReply[][] }
  | { kind: "openai"; model?: string; maxOutputTokens?: number; timeoutMs?: number }
  | { kind: "anthropic"; model: string; maxOutputTokens?: number; timeoutMs?: number };
export type LoopKind = "buffered" | "durable" | "refreshing" | "context";
export type StatePolicy = "accumulate" | "replace" | "model-state";

export interface LiveLoopScenario {
  kind: "live-loop";
  id: string;
  label: string;
  description?: string;
  application: { file: string } | { source: string };
  interpreter: "psp-core-3.2-draft-0.1" | "none";
  loop: LoopKind;
  provider: LiveProvider;
  tools: SyntheticTool[];
  node: { nodeId: string; nodeVersion: string; agents: string[] };
  initialState: Record<string, unknown>;
  turns: { message: string; requestId?: string }[];
  policy: { default: PolicyResource; overrides?: PolicyOverride[] };
  releaseCapabilities?: string[];
  providerCapabilities?: string[];
  plan: { statePolicy: StatePolicy; completeOnTurn?: number | null };
  refresh?: { policy: "expiration" | "interval" | "interval|expiration"; interval?: number; grace?: number; ttl: number };
  limits: { maxSteps: number; maxRounds?: number; deadlineSeconds: number };
  clock: "wall" | "virtual";
}

/** Existing Python evaluation engines take their native configuration verbatim. */
export interface CampaignScenario {
  kind: "campaign"; id: string; label: string; description?: string;
  config: Record<string, unknown>;
  /** Optional subset of corpus pair ids; attack/benign partners stay together. */
  pairIds?: string[];
  live?: boolean;
}
export interface JointScenario {
  kind: "joint"; id: string; label: string; description?: string;
  caseIds?: string[]; language: "typescript" | "python"; mode: "rehearsal" | "live";
}
export interface StudyScenario {
  kind: "study"; id: string; label: string; description?: string;
  mode: "offline" | "live"; hosts: ("typescript" | "python")[]; peers: ("typescript" | "python")[];
  conditions: string[]; caseIds?: string[]; repeats: number;
}
export interface HeldoutScenario {
  kind: "heldout"; id: string; label: string; description?: string;
  mode: "rehearsal" | "live"; plan: string; corpus: string;
}
export type Scenario = LiveLoopScenario | CampaignScenario | JointScenario | StudyScenario | HeldoutScenario;

export interface ScenarioCollection {
  id: string;
  label: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  scenarios: Scenario[];
}

export const ENGINE_KINDS: readonly EngineKind[] = ["live-loop", "campaign", "joint", "study", "heldout"];
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function isIdentifier(value: unknown): value is string { return typeof value === "string" && IDENTIFIER.test(value); }
