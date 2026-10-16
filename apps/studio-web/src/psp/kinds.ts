// SPDX-License-Identifier: Apache-2.0
import { buildSection, formatSection, newSection, type Section } from "./model";

/** Property tabs. Each node type shows the ones that apply to it (PSP 8, 10, 11, 12, 21). */
export type TabId = "general" | "application" | "instructions" | "output" | "config" | "affinity" | "routing" | "completion" | "machine" | "threat" | "children" | "source";
export const TAB_LABELS: Record<TabId, string> = {
  general: "General", application: "Application", instructions: "Instructions", output: "Output", config: "Config", affinity: "Affinity",
  routing: "Routing", completion: "Completion", machine: "Machine", threat: "Threat policy", children: "Children", source: "Source"
};

export interface NodeKind {
  type: string;
  label: string;
  description: string;
  /** Colour token used by the palette swatch and the node card stripe. */
  tone: string;
  /** Holds child nodes the editor can open as a nested diagram. */
  container: boolean;
  /** Config block for the Config tab, when the type has one. */
  config?: { block: string; label: string };
  tabs: TabId[];
  blocks: { type: string; attributes?: Record<string, string>; body: string }[];
}

const SCHEMA = '{"type":"object","properties":{}}';
export const VERSION = "v1.0.0";
export const NODE_KINDS: NodeKind[] = [
  {
    type: "prompt", label: "Prompt", tone: "prompt", container: false,
    description: "Executes instructions and collects its output across turns (PSP 10.1.1).",
    tabs: ["general", "instructions", "output", "affinity", "routing", "source"],
    blocks: [{ type: "system", body: "Describe what this node accomplishes and when it is complete." }, { type: "output-schema", attributes: { "content-type": "json" }, body: SCHEMA }]
  },
  {
    type: "decision", label: "Decision", tone: "decision", container: false,
    description: "Reasons about its transition conditions and selects the first that applies (PSP 10.1.3).",
    tabs: ["general", "instructions", "routing", "output", "affinity", "source"],
    blocks: [{ type: "system", body: "Evaluate the conditions on the outgoing transitions and select the first that applies." }]
  },
  {
    type: "composite", label: "Composite", tone: "composite", container: true,
    description: "Groups child nodes with shared state; children run by their own transitions (PSP 10.1.2).",
    tabs: ["general", "instructions", "children", "output", "affinity", "routing", "source"],
    blocks: [{ type: "system", body: "Run the child nodes according to their transitions." }]
  },
  {
    type: "connector", label: "Connector", tone: "connector", container: false, config: { block: "connector-config", label: "Connector" },
    description: "Requests a permitted external operation and uses its actual result (PSP 10.1.4).",
    tabs: ["general", "instructions", "config", "output", "affinity", "routing", "source"],
    blocks: [{ type: "system", body: "Request the permitted external operation and use its actual result." }, { type: "connector-config", attributes: { "content-type": "json" }, body: '{"type":"mcp","operation":""}' }, { type: "output-schema", attributes: { "content-type": "json" }, body: SCHEMA }]
  },
  {
    type: "checkpoint", label: "Checkpoint", tone: "checkpoint", container: false, config: { block: "checkpoint-config", label: "Checkpoint" },
    description: "Pauses for human input until an authenticated resume arrives (PSP 10.1.5).",
    tabs: ["general", "instructions", "config", "output", "routing", "source"],
    blocks: [{ type: "system", body: "Pause and wait for approval." }, { type: "checkpoint-config", attributes: { "content-type": "json" }, body: '{"timeout":"72h"}' }, { type: "output-schema", attributes: { "content-type": "json" }, body: '{"type":"object","properties":{"approved":{"type":"boolean"}}}' }]
  },
  {
    type: "loop", label: "Loop", tone: "loop", container: true, config: { block: "loop-config", label: "Loop" },
    description: "Iterates a collection, running its child nodes for each item (PSP 10.2).",
    tabs: ["general", "instructions", "config", "children", "output", "affinity", "routing", "source"],
    blocks: [{ type: "system", body: "Process each item in the collection." }, { type: "loop-config", attributes: { "content-type": "json" }, body: '{"collection":"items","item_var":"item","max_iterations":10}' }]
  },
  {
    type: "reset", label: "Reset", tone: "reset", container: false, config: { block: "reset-config", label: "Reset" },
    description: "Ends the current intent and resumes at a target node, keeping selected outputs (PSP 10.3).",
    tabs: ["general", "instructions", "config", "routing", "source"],
    blocks: [{ type: "system", body: "Ask whether the user needs help with anything else." }, { type: "reset-config", attributes: { "content-type": "json" }, body: '{"target_node":"","preserve_nodes":[],"generate_new_session":true}' }]
  },
  {
    type: "application", label: "Application", tone: "application", container: true,
    description: "A nested application with its own session, run to completion as one node (PSP 8.6).",
    tabs: ["application", "instructions", "children", "completion", "machine", "threat", "affinity", "routing", "output", "source"],
    blocks: [{ type: "system", body: "Describe the application's purpose." }]
  }
];
const UNKNOWN: NodeKind = { type: "", label: "Node", tone: "other", container: false, description: "A node type this editor has no form for.", tabs: ["general", "instructions", "output", "affinity", "routing", "children", "source"], blocks: [] };
export const kindOf = (nodeType: string): NodeKind => NODE_KINDS.find(k => k.type === nodeType) ?? { ...UNKNOWN, type: nodeType };

/** A new node with its default blocks, ready to insert at `depth`. */
export function createNode(kind: NodeKind, id: string, depth: number): Section {
  const attributes: Record<string, string> = kind.type === "application"
    ? { type: "node", "node-type": "application", id, name: id, version: VERSION }
    : { type: "node", "node-type": kind.type, id, version: VERSION };
  const blocks = kind.blocks.map(b => newSection({ type: b.type, ...(b.type === "system" ? { version: VERSION } : {}), ...b.attributes }, b.body));
  return buildSection(attributes, blocks, depth);
}
/** Text of a new application file: one root application with a first prompt node. */
export function applicationTemplate(name: string): string {
  const prompt = createNode(kindOf("prompt"), "start", 1);
  const root = buildSection(
    { type: "node", "node-type": "application", name, "session-id": "dev-session", version: VERSION, mode: "dev" },
    [newSection({ type: "system", version: VERSION }, "Describe the application's purpose and the boundaries it keeps."), prompt], 0);
  return formatRoot(root);
}
const formatRoot = (s: Section) => formatSection(s) + "\n";

export const TRUST_LEVELS = [
  { value: "0", label: "0 · Platform" }, { value: "1", label: "1 · Governance" }, { value: "2", label: "2 · Session" },
  { value: "3", label: "3 · Context" }, { value: "4", label: "4 · User" }, { value: "5", label: "5 · External" }
];
export const TRUST_PRESETS = [
  { value: "governance-only", label: "governance-only (level 2, priority 70, signed)" },
  { value: "verified", label: "verified (level 3, priority 50)" },
  { value: "include-user", label: "include-user (level 4, priority 30)" },
  { value: "permissive", label: "permissive (level 5, priority 0)" }
];
export const REFRESH_POLICIES = ["expiration", "interval", "checkpoint", "adaptive"] as const;
export const APP_MODES = ["dev", "debug", "demo", "prod"] as const;
export const POST_COMPLETION = ["unmanaged", "lockdown", "scoped", "redirect"] as const;
export const LOCALITIES = ["cloud", "on-premise", "edge", "local"] as const;
export const COMMON_CAPABILITIES = ["vision", "function-calling", "code-execution", "long-context"];
