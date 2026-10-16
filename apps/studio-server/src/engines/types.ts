// SPDX-License-Identifier: Apache-2.0
import type { EngineEvent, EngineKind, PreparedRun, RunSummary, Scenario } from "@psp-cdl/studio-core";
import type { Vault } from "../secrets/vault.js";
import type { Workspace } from "../workspace/files.js";

/** Host-side facilities an engine may use. Nothing here is model-visible. */
export interface EngineServices {
  vault: Vault;
  workspace: Workspace;
  /** Repository root; the Python engines run from here. */
  repoRoot: string;
  /** Path to the `uv` launcher used for the Python engines. */
  uv: string;
  /** Test hook: replaces fetch for Anthropic model calls. */
  fetch?: typeof fetch;
}

export interface PrepareContext extends EngineServices {
  /** Whether the server allows model-visible payloads on events at all. */
  inspectAllowed: boolean;
}

export interface EngineContext extends EngineServices {
  runId: string;
  /** Per-run directory for state files, journals and engine artifacts. */
  artifactDir: string;
  /** Attach model-visible payloads to observer events. */
  inspect: boolean;
  emit(event: EngineEvent): void;
  cancelled(): boolean;
  signal: AbortSignal;
  /** Digest the operator repeated to admit a live run, when the engine requires one. */
  admissionDigest?: string;
}

export interface Engine<S extends Scenario = Scenario> {
  readonly kind: EngineKind;
  prepare(scenario: S, context: PrepareContext): Promise<PreparedRun>;
  run(scenario: S, context: EngineContext): Promise<RunSummary>;
}

export class EngineError extends Error {
  constructor(public readonly code: string, message?: string) { super(message ?? code); this.name = "EngineError"; }
}
