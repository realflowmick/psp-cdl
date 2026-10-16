// SPDX-License-Identifier: Apache-2.0
/**
 * Component and filter kinds. Each kind's zod schema drives the properties dialog, the validator and
 * the generated `pipeline.schema.json`, so the three cannot drift apart. The schema's key order is
 * the canonical key order in a saved configuration.
 */
import { z } from "zod";
import type { Role, Side } from "./types.js";

export const COMPONENT_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const id = z.string().regex(COMPONENT_ID, "Use a letter, then letters, digits, dot, dash or underscore (at most 64).");
const text = (max = 2048) => z.string().min(1).max(max);
const tokens = z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).max(64);

const filterOptions = z.looseObject({ kind: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) });
export const filterSpecSchema = z.union([z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), filterOptions]);

export const pspRefSchema = z.looseObject({
  document: text(512).meta({ title: "Document", description: "env:PSP_DOC (the variable holds a workspace path), a workspace path to a .psp or .pspx, or prompt:<name> for workspace prompts/<name>.md." }),
  signOnRetrieval: z.enum(["ed25519", "hmac-sha256"]).optional().meta({ title: "Sign on retrieval", description: "LLMProxy signs the document when it resolves it at bootstrap, with the vault key or a per-session key." })
});

export const scriptedReplySchema = z.union([
  z.object({ type: z.literal("tool"), name: z.string().min(1).max(200), arguments: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("final"), text: z.string().max(100_000) })
]);

export type PaletteGroup = "ring" | "bootstrap" | "filter" | "loop" | "aux" | "terminal";
export interface KindInfo {
  kind: string;
  role: Role;
  label: string;
  description: string;
  group: PaletteGroup;
  /** Kind-specific properties; `id`, `kind`, `role` and `side` are common to every component. */
  schema: z.ZodObject;
  /** At most one per pipeline. */
  singleton?: boolean;
  /** Properties a new component starts with. */
  defaults: () => Record<string, unknown>;
}

const llmproxy = z.object({
  vectorStore: id.optional().meta({ title: "Vector store", description: "Id of the vector-store component the response filters read." }),
  lockdown: z.enum(["none", "post-completion"]).optional().meta({ title: "Lockdown", description: "post-completion runs the durable loop, which refuses further turns once the plan completes (PSP §8.5 lockdown)." }),
  filters: z.object({
    request: z.array(filterSpecSchema).max(32).meta({ title: "Request filters" }),
    response: z.array(filterSpecSchema).max(32).meta({ title: "Response filters" })
  }).optional().meta({ title: "Filters", description: "Ordered slots; array order is execution order." })
});
const model = z.object({
  model: text(200).meta({ title: "Model", description: "Provider model id." }),
  provider: z.enum(["anthropic", "openai", "mock"]).optional().meta({ title: "Provider", description: "Inferred from the model id when absent. mock replays the script, for offline wiring checks." }),
  script: z.array(z.array(scriptedReplySchema).max(32)).max(256).optional().meta({ title: "Script", description: "mock only: replies per turn, each a tool call or a final text." })
});
const initiator = z.object({
  trigger: z.enum(["chat", "file", "email", "webhook", "schedule"]).meta({ title: "Trigger", description: "What starts a turn." }),
  reply: z.enum(["channel", "none"]).optional().meta({ title: "Reply", description: "channel delivers the filtered reply through the trigger's own sink; none means an MCP tool produces the outcome and the ring is open." }),
  watch: text(512).optional().meta({ title: "Watch", description: "file: workspace glob of files that start a turn, for example inbox/*.txt." }),
  output: text(512).optional().meta({ title: "Output", description: "file with reply channel: workspace folder the reply is written to." }),
  onDone: z.enum(["move", "delete", "keep"]).optional().meta({ title: "On done", description: "file: what happens to a queued file after its turn." }),
  mailbox: text(320).optional().meta({ title: "Mailbox", description: "email: the address the trigger reads." }),
  route: z.string().regex(/^\/[A-Za-z0-9/_.-]{0,255}$/).optional().meta({ title: "Route", description: "webhook: request path, starting with /." }),
  auth: text(256).optional().meta({ title: "Auth", description: "webhook: how callers authenticate, for example env:HOOK_TOKEN." }),
  cron: text(128).optional().meta({ title: "Cron", description: "schedule: five-field cron expression, UTC." }),
  prompt: text(20_000).optional().meta({ title: "Prompt", description: "schedule: the message each run sends." })
});
const mcpproxy = z.object({
  caller: id.meta({ title: "Caller", description: "The model that calls this proxy (model_1 in the reference)." }),
  backend: text(2048).meta({ title: "Backend", description: "MCP server URL: https, or http on a loopback address." }),
  drift: z.enum(["refuse", "warn"]).optional().meta({ title: "On drift", description: "What happens when the backend's tool catalog differs from the captured baseline." }),
  server: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().meta({ title: "Server name", description: "The server segment of mcp://<server>/<tool> in node agents. Defaults to the backend URL's last path segment." }),
  serverInfo: z.object({ name: text(200), version: text(200) }).optional().meta({ title: "Server info", description: "Name and version the backend must report at initialize; MCPProxy pins them." }),
  auth: z.string().regex(/^env:[A-Za-z_][A-Za-z0-9_]{0,127}$/).optional().meta({ title: "Auth", description: "env:NAME holding the bearer token. Credentials never enter the configuration." }),
  tools: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.object({
    readOnly: z.boolean().optional(),
    capabilities: tokens.optional()
  })).optional().meta({ title: "Tool declarations", description: "Host declarations per tool: read-only admission and CDL capabilities. These describe tools; they do not filter them." })
});
const vectorStore = z.object({
  engine: z.enum(["sqlite-vec", "portable"]).meta({ title: "Engine", description: "sqlite-vec keeps a vec0 index; portable compares BLOB vectors in process." }),
  path: text(512).meta({ title: "Path", description: "SQLite file, relative to the pipeline's data folder." }),
  embedding: text(200).optional().meta({ title: "Embedding", description: "psp-exfil-hash-384-v1 runs anywhere; all-MiniLM-L6-v2 needs the pinned local ONNX model." }),
  dims: z.number().int().min(1).max(4096).optional().meta({ title: "Dimensions" })
});
const tapTarget = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}\.response$/, "Use <llmproxy id>.response.");
const logger = z.object({
  taps: tapTarget.optional().meta({ title: "Taps", description: "<llmproxy id>.response" }),
  sink: text(512).optional().meta({ title: "Sink", description: "Folder for JSON Lines records, relative to the pipeline's data folder." }),
  redact: z.enum(["covenant", "none"]).optional().meta({ title: "Redact", description: "covenant redacts records while a no-log covenant is in context." })
});
const otel = z.object({
  taps: tapTarget.optional().meta({ title: "Taps", description: "<llmproxy id>.response" }),
  endpoint: text(2048).optional().meta({ title: "Endpoint", description: "OTLP endpoint." })
});

export const COMPONENT_KINDS: readonly KindInfo[] = [
  { kind: "llmproxy", role: "ring", label: "LLMProxy", group: "ring", schema: llmproxy, singleton: true,
    description: "Both halves of the ring: verifies and registers on the request side, filters the final text on the response side.",
    defaults: () => ({ filters: { request: ["psp-verify", "agents-registration", "covenant-pruning"], response: ["covenant-gate"] } }) },
  { kind: "model", role: "terminal", label: "Model", group: "terminal", schema: model, singleton: true,
    description: "Receives only the registrations LLMProxy allowed and decides tool use with the covenant text in context.",
    defaults: () => ({ model: "claude-sonnet-4-6" }) },
  { kind: "initiator", role: "terminal", label: "Initiator", group: "terminal", schema: initiator, singleton: true,
    description: "Starts a turn from its trigger and, with a sink, receives the filtered reply.",
    defaults: () => ({ trigger: "chat" }) },
  { kind: "mcpproxy", role: "loop", label: "MCPProxy", group: "loop", schema: mcpproxy,
    description: "Fronts one backend MCP server, pins its catalog and refuses on drift. No allowlisting or filtering.",
    defaults: () => ({ caller: "model_1", backend: "https://mcp.example/tools", drift: "refuse" }) },
  { kind: "vector-store", role: "aux", label: "Vector Store", group: "aux", schema: vectorStore,
    description: "Protected-section fingerprints (PSP-EXFIL-0.1) read by Exfil Guard. Never stores plaintext.",
    defaults: () => ({ engine: "portable", path: "./data/protected.db", embedding: "psp-exfil-hash-384-v1", dims: 384 }) },
  { kind: "logger", role: "aux", label: "Logger", group: "aux", schema: logger,
    description: "Observe-only tap on the response half. Writes JSON Lines run records.",
    defaults: () => ({ sink: "./runs/", redact: "covenant" }) },
  { kind: "otel", role: "aux", label: "OTel", group: "aux", schema: otel,
    description: "Observe-only OpenTelemetry tap. The studio has no exporter; runs report it as unsupported.",
    defaults: () => ({ endpoint: "http://127.0.0.1:4318" }) }
];
export const kindInfo = (kind: string): KindInfo | undefined => COMPONENT_KINDS.find(k => k.kind === kind);

export interface FilterInfo {
  kind: string;
  side: Side;
  label: string;
  description: string;
  /** What the reference implementation does for this slot. */
  reference: string;
  /** False when the reference has nothing to run; runs report the slot as unsupported. */
  supported: boolean;
  schema: z.ZodObject;
  /** Needs the LLMProxy's vector store. */
  needsVectors?: boolean;
}
export const FILTER_KINDS: readonly FilterInfo[] = [
  { kind: "psp-verify", side: "request", label: "PSP verify", supported: true, schema: z.object({}),
    description: "Signature, expiry and binding of the signed prompt.",
    reference: "The reference loop verifies the signed prompt (verifyEnvelope) at load, around every inference step and after every tool result. It cannot be switched off." },
  { kind: "agents-registration", side: "request", label: "Agents → registrations", supported: true, schema: z.object({}),
    description: "Registers the tools the current PSP node's agents name.",
    reference: "McpDispatchGate lists only tools named by the node's agents attribute (mcp://server/tool). Without this slot the host names every backend tool." },
  { kind: "covenant-pruning", side: "request", label: "Covenant pruning", supported: true, schema: z.object({}),
    description: "Withholds tools whose capabilities conflict with covenants on data in context.",
    reference: "The host withholds a registration when CDL evaluatePolicy reports CAPABILITY_CONFLICT or PROCESSING_PROHIBITED for the tool's capabilities and a covenant in context." },
  { kind: "exfil-guard", side: "response", label: "Exfil Guard", supported: true, needsVectors: true,
    schema: z.object({
      threshold: z.number().min(0).max(2).optional().meta({ title: "Block at cosine distance ≤", description: "Strong-match distance for the semantic tier. Calibrate on benign replies before changing it." }),
      block: z.enum(["leak", "suspicious"]).optional().meta({ title: "Block on", description: "The lowest disposition that withholds the reply." })
    }),
    description: "Withholds a final text that reproduces protected sections.",
    reference: "authorizeFinal calls ExfiltrationStore.assess (PSP-EXFIL-0.1). Without a vector store it runs the lexical tier only." },
  { kind: "covenant-gate", side: "response", label: "Covenant Gate", supported: true, schema: z.object({}),
    description: "Withholds a reply whose sink conflicts with covenants in context.",
    reference: "The loop's release phase evaluates covenants in context against the sink's capabilities (OUTPUT_DENIED)." },
  { kind: "data-use-check", side: "response", label: "Data-use check", supported: false,
    schema: z.object({ scope: z.enum(["context", "session"]).optional().meta({ title: "Scope" }) }),
    description: "Checks the reply's use of tool data against covenants.",
    reference: "The reference LLMProxy has no data-use check. Runs report this slot as unsupported." }
];
export const filterInfo = (kind: string): FilterInfo | undefined => FILTER_KINDS.find(f => f.kind === kind);
export const filterKind = (spec: unknown): string => typeof spec === "string" ? spec : spec && typeof spec === "object" && typeof (spec as { kind?: unknown }).kind === "string" ? (spec as { kind: string }).kind : "";
export const filterOptionsOf = (spec: unknown): Record<string, unknown> => spec && typeof spec === "object" ? Object.fromEntries(Object.entries(spec as Record<string, unknown>).filter(([k]) => k !== "kind")) : {};

/** Common component keys, then the kind's own keys: the canonical order in a saved configuration. */
export const COMMON_KEYS = ["id", "kind", "role", "side"] as const;
export const componentKeyOrder = (kind: string): string[] => [...COMMON_KEYS, ...Object.keys(kindInfo(kind)?.schema.shape ?? {})];

/** Model ids the provider is inferred from when `provider` is absent. */
export function inferProvider(modelId: string, provider?: unknown): "anthropic" | "openai" | "mock" | null {
  if (provider === "anthropic" || provider === "openai" || provider === "mock") return provider;
  if (/^claude-/.test(modelId)) return "anthropic";
  if (/^(gpt-|o\d|chatgpt-)/.test(modelId)) return "openai";
  return null;
}
