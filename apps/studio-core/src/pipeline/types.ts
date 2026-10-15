// SPDX-License-Identifier: Apache-2.0
/**
 * Pipeline configurations: which services a PSP runs on and how they are wired. A configuration is
 * service wiring, not prompt material: it is never signed and never enters a context window.
 */
export const PSPP_FORMAT = "pspp/1";
export const PIPELINE_PROFILE = "PSP-STUDIO-PIPELINE-0.1";

export type Role = "ring" | "loop" | "aux" | "terminal";
export type Side = "request" | "response";
export const ROLES: readonly Role[] = ["ring", "loop", "aux", "terminal"];
export const SIDES: readonly Side[] = ["request", "response"];

/** A filter entry is a kind string or `{kind, ...options}`. Array order is execution order. */
export type FilterSpec = string | ({ kind: string } & Record<string, unknown>);

export interface PspRef {
  /** `env:PSP_DOC` (the variable holds a workspace path), a workspace path, or `prompt:<name>` for a plain prompt. */
  document: string;
  signOnRetrieval?: "ed25519" | "hmac-sha256";
  [key: string]: unknown;
}

export interface Component {
  id: string;
  kind: string;
  role: Role;
  /** Ring components other than LLMProxy sit on one side of the ring. */
  side?: Side;
  vectorStore?: string;
  lockdown?: string;
  filters?: { request: FilterSpec[]; response: FilterSpec[] };
  /** Everything else is kind-specific and validated by the kind's schema. */
  [key: string]: unknown;
}

/** The `config_json` column holds `psp` and `components`; name and description live in their own columns. */
export interface PipelineBody { psp: PspRef | null; components: Component[] }
export interface PipelineConfig extends PipelineBody { name: string; description?: string }
export interface PsppFile extends PipelineConfig { $format: typeof PSPP_FORMAT }

export interface PipelineRow {
  id: string; name: string; description: string | null; pspRef: string | null;
  config: PipelineConfig; version: number; createdAt: string; updatedAt: string;
}
export type PipelineSummary = Omit<PipelineRow, "config" | "createdAt">;

export type ProblemSeverity = "error" | "warn" | "info";
/** A serializable edit: set or remove the value at a path inside the configuration. */
export type PipelineEdit = { op: "set"; path: (string | number)[]; value: unknown } | { op: "remove"; path: (string | number)[] };
export interface QuickFix { label: string; edits: PipelineEdit[] }
export interface ProblemTarget { componentId?: string; filter?: { componentId: string; side: Side; index: number }; psp?: true; path?: (string | number)[] }
export interface Problem { id: string; severity: ProblemSeverity; code: string; message: string; target?: ProblemTarget; fix?: QuickFix }

/** Read-only view of a referenced PSP, fetched for display. This tool never writes the document. */
export type SignatureState = "valid" | "invalid" | "unverified" | "missing" | "expired";
export interface PspSection {
  type: "system" | "context";
  /** The containing node id for SYSTEM sections; the `name` (or `id`) attribute for CONTEXT sections. */
  ref?: string;
  signature: SignatureState;
  algorithm?: string;
  expires?: string;
  /** CDL declarations on a JSON CONTEXT payload (`x-cdl-classes`, `x-cdl-covenants`). */
  classes: string[];
  covenants: string[];
  bytes: number;
}
export interface PspNodeInfo { id: string; version: string; agents: string[] }
export interface PspSummary {
  pointer: string;
  /** Workspace path the pointer resolved to. */
  path: string;
  source: "env" | "path" | "prompt";
  format: "psp" | "pspx" | "prompt";
  parses: boolean;
  error?: string;
  signed: boolean;
  sections: PspSection[];
  nodes: PspNodeInfo[];
  /** The node a new session starts on: the first node with an id and version, in document order. */
  entryNode: PspNodeInfo | null;
  covenants: string[];
  classes: string[];
}
export type PspResolution = { status: "resolved"; summary: PspSummary } | { status: "unresolved"; pointer: string; reason: string };

/** A backend tool as MCPProxy discovered it, with the host's declared capabilities. */
export interface CatalogTool { name: string; description?: string; readOnly: boolean; capabilities: string[] }
export interface BackendCatalog { proxyId: string; backend: string; digest: string; capturedAt: string; serverInfo?: { name: string; version: string }; tools: CatalogTool[] }

export interface RegistrationPreview {
  node: string | null;
  allowed: string[];
  withheldByNode: string[];
  withheldByCovenant: { tool: string; covenant: string }[];
  /** The reference dispatch gate releases read-only tools only. */
  withheldByMode: string[];
  /** Tools the reference gate refused to register, with its code (for example UNSUPPORTED_SCHEMA). */
  unsupported?: { tool: string; code: string }[];
  /** Backends with no captured catalog yet; their tools are unknown until the first run. */
  unknownBackends: string[];
}

/** Environment facts the server supplies so the shared validator can check pointers, catalogs and keys. */
export interface ValidationEnv {
  psp?: PspResolution;
  /** Names of other pipelines, for the unique-name rule. */
  otherNames?: string[];
  catalogs?: Record<string, BackendCatalog | null>;
  signing?: { configured: boolean; algorithm: string | null };
  /** Embedding models the server can load. */
  embedders?: string[];
  /** Environment variable names that are set on the server (names only, never values). */
  envSet?: string[];
}

export type DeliveryOutcome = "delivered" | "withheld" | "none";
export type FilterVerdict = "pass" | "warn" | "block" | "unsupported" | "skipped";
export interface TraceEntry { at: string; where: "initiator" | "llmproxy.request" | "model" | "mcpproxy" | "llmproxy.response" | "aux"; detail: string }
export interface PspContext { sessionId: string; turn: number; loops: number; node: string | null; nodeVersion: string | null; decisions: number; status: string; stateBytes: number }
export interface PipelineRunRecord {
  sessionId: string; turn: number; at: string;
  input: { trigger: string; summary: string };
  trace: TraceEntry[];
  registrations: { allowed: string[]; withheldByNode: string[]; withheldByCovenant: { tool: string; covenant: string }[]; withheldByMode: string[]; unsupported?: { tool: string; code: string }[] };
  toolLoop: { turns: number; calls: { proxyId: string; tool: string; drift: "ok" | "refused" | "warned"; outcome: string }[] };
  responseFilters: { kind: string; order: number; verdict: FilterVerdict; score?: number; evidence?: string }[];
  reply: string;
  delivery: DeliveryOutcome;
  deliveredTo?: string;
  /** Set when the turn ended in an error code from the reference loop or a host check. */
  error?: { code: string; message?: string };
  taps: { id: string; kind: string; status: "written" | "redacted" | "unsupported" | "skipped"; detail?: string }[];
  context: PspContext;
}
export interface PipelineSession { sessionId: string; pipelineId: string; version: number; startedAt: string; context: PspContext; warnings: string[]; registrations: RegistrationPreview }
