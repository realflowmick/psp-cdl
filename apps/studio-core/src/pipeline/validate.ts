// SPDX-License-Identifier: Apache-2.0
/**
 * The shared validator. The browser runs it on every change with the last environment the server
 * supplied; `POST /api/pipelines/validate` runs it with a fresh one. Both produce the same list.
 */
import { checkConfig, PipelineFormatError } from "./format.js";
import { COMPONENT_KINDS, filterInfo, filterKind, filterOptionsOf, inferProvider, kindInfo } from "./kinds.js";
import { cdlVocabulary, conflicts, registrationsFor, toolDeclarations, ACTING_CAPABILITIES } from "./registrations.js";
import {
  attachment, danglingReferences, filtersOf, hasFilter, llmProxies, primaryProxy, replyMode, sinkCapabilities, TAP_CAPABILITIES, terminals
} from "./topology.js";
import { parseCron } from "./cron.js";
import type { Component, PipelineConfig, Problem, PspSummary, Side, ValidationEnv } from "./types.js";

const sideLabel = (side: Side) => side === "request" ? "request" : "response";
const index = (config: PipelineConfig, id: string) => config.components.findIndex(c => c.id === id);

/** Which CONTEXT section carries a covenant, for messages such as "account_record carries no-log". */
function carrier(psp: PspSummary | null, term: string): string {
  const section = psp?.sections.find(s => s.covenants.includes(term) || s.classes.includes(term));
  return section?.ref ? section.ref : "data in context";
}
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/;
export function backendUrlProblem(value: unknown): string | null {
  let url: URL;
  try { url = new URL(String(value)); } catch { return "is not a URL"; }
  if (url.username || url.password || url.search || url.hash) return "must not carry credentials, a query or a fragment";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOOPBACK.test(url.hostname)) return null;
  return "must be https, or http on a loopback address";
}

export function validatePipeline(config: PipelineConfig, env: ValidationEnv = {}): Problem[] {
  const problems: Problem[] = [];
  const add = (p: Problem) => { if (!problems.some(x => x.id === p.id)) problems.push(p); };
  const psp = env.psp?.status === "resolved" ? env.psp.summary : null;

  // Schema, per kind and per filter option.
  try { checkConfig(config); }
  catch (e) {
    if (!(e instanceof PipelineFormatError)) throw e;
    for (const issue of e.issues.length ? e.issues : [e.message]) {
      const m = /^\/components\/(\d+)/.exec(issue);
      const target = m ? config.components[Number(m[1])] : undefined;
      add({ id: `schema:${issue}`, severity: "error", code: "SCHEMA", message: issue, ...(target ? { target: { componentId: target.id } } : { target: { path: [] } }) });
    }
  }
  if (env.otherNames?.includes(config.name)) add({ id: "name", severity: "error", code: "NAME_COLLISION", message: `Another pipeline is already named ${config.name}.`, target: { path: ["name"] } });

  // Identity and structure.
  const seen = new Map<string, number>();
  for (const c of config.components) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
  for (const [id, count] of seen) if (count > 1) add({ id: `dup:${id}`, severity: "error", code: "DUPLICATE_ID", message: `${count} components share the id ${id}.`, target: { componentId: id } });
  const { model, initiator } = terminals(config);
  const proxies = llmProxies(config);
  if (!model) add({ id: "model", severity: "error", code: "MISSING_MODEL", message: "The ring needs exactly one Model.", target: { path: ["components"] } });
  if (!initiator) add({ id: "initiator", severity: "error", code: "MISSING_INITIATOR", message: "The ring needs exactly one Initiator.", target: { path: ["components"] } });
  if (!proxies.length) add({ id: "llmproxy", severity: "error", code: "MISSING_LLMPROXY", message: "The ring needs exactly one LLMProxy, with both halves.", target: { path: ["components"] } });
  for (const c of config.components) {
    const where = attachment(config, c);
    const info = kindInfo(c.kind);
    if (!info) add({ id: `kind:${c.id}`, severity: "warn", code: "UNKNOWN_KIND", message: `${c.id} has kind ${c.kind}, which this studio does not know. It is kept and edited as key/value pairs; runs ignore it.`, target: { componentId: c.id } });
    if (where === "extra") add({ id: `extra:${c.id}`, severity: "error", code: "EXTRA_COMPONENT", message: `${c.id} is a second ${info?.label ?? c.kind}; a pipeline has exactly one.`, target: { componentId: c.id }, fix: { label: `Delete ${c.id}`, edits: [{ op: "remove", path: ["components", index(config, c.id)] }] } });
    if (where !== "free") continue;
    const proxy = primaryProxy(config);
    const fix = c.role === "loop" && model ? { label: `Attach to ${model.id}`, edits: [{ op: "set" as const, path: ["components", index(config, c.id), "caller"], value: model.id }] }
      : (c.kind === "logger" || c.kind === "otel") && proxy ? { label: `Tap ${proxy.id}.response`, edits: [{ op: "set" as const, path: ["components", index(config, c.id), "taps"], value: `${proxy.id}.response` }] }
      : c.kind === "vector-store" && proxy && !proxy.vectorStore ? { label: `Use as ${proxy.id}'s vector store`, edits: [{ op: "set" as const, path: ["components", index(config, proxy.id), "vectorStore"], value: c.id }] }
      : undefined;
    add({ id: `free:${c.id}`, severity: "error", code: "FREE_NODE", message: `${c.id} is not attached to anything. ${c.role === "ring" ? "Drop it onto a ring edge." : c.role === "loop" ? "A loop component needs a caller." : "Drop it near the LLMProxy response half."}`, target: { componentId: c.id }, ...(fix ? { fix } : {}) });
  }
  for (const d of danglingReferences(config)) {
    add({ id: `dangling:${d.componentId}:${d.key}`, severity: "error", code: "DANGLING_REFERENCE", message: `${d.componentId}.${d.key} names ${d.value}, which does not exist.`, target: { componentId: d.componentId, path: ["components", index(config, d.componentId), d.key] }, fix: { label: `Remove ${d.key}`, edits: [{ op: "remove", path: ["components", index(config, d.componentId), d.key] }] } });
  }

  // The PSP reference.
  const proxy = primaryProxy(config);
  if (!config.psp) {
    add({ id: "psp:none", severity: "warn", code: "NO_PSP", message: "Runs without a PSP — no node allowlist, no covenants, psp-verify skipped.", target: { psp: true } });
  } else if (env.psp?.status === "unresolved") {
    add({ id: "psp:unresolved", severity: "error", code: "PSP_UNRESOLVED", message: `${env.psp.pointer} does not resolve: ${env.psp.reason}`, target: { psp: true, path: ["psp", "document"] } });
  } else if (psp) {
    if (!psp.parses) add({ id: "psp:parse", severity: "error", code: "PSP_PARSE", message: `${psp.path} does not parse: ${psp.error ?? "unknown error"}.`, target: { psp: true } });
    const unsignedSystem = psp.sections.some(s => s.type === "system" && s.signature !== "valid");
    if (unsignedSystem && !config.psp.signOnRetrieval) {
      add({ id: "psp:unsigned", severity: "error", code: "PSP_UNSIGNED", message: `${psp.path} has SYSTEM sections without a valid signature and signOnRetrieval is off.`, target: { psp: true, path: ["psp"] },
        fix: { label: "Sign on retrieval (ed25519)", edits: [{ op: "set", path: ["psp", "signOnRetrieval"], value: env.signing?.algorithm === "hmac-sha256" ? "hmac-sha256" : "ed25519" }] } });
    } else {
      const from = psp.source === "env" ? `${config.psp.document.slice(4)} (${psp.path})` : psp.path;
      const signing = config.psp.signOnRetrieval ? `signed on retrieval (${config.psp.signOnRetrieval})` : "signed in the document";
      add({ id: "psp:resolved", severity: "info", code: "PSP_RESOLVED", message: `PSP document resolved from ${from}, ${signing}, bound to the session.`, target: { psp: true } });
    }
    if (config.psp.signOnRetrieval && env.signing && (!env.signing.configured || env.signing.algorithm !== config.psp.signOnRetrieval)) {
      add({ id: "psp:key", severity: "info", code: "EPHEMERAL_KEY", message: `The vault has no ${config.psp.signOnRetrieval} signing key, so each session signs with its own ephemeral key.`, target: { psp: true } });
    }
    for (const s of psp.sections) if (s.signature === "expired") add({ id: `psp:expired:${s.ref ?? s.type}`, severity: "warn", code: "SECTION_EXPIRED", message: `The ${s.type.toUpperCase()} section ${s.ref ?? ""} expired${s.expires ? ` at ${s.expires}` : ""}.`.replace("  ", " "), target: { psp: true } });
    const vocabulary = cdlVocabulary();
    for (const term of psp.covenants) if (!vocabulary.covenants.has(term)) {
      add({ id: `psp:covenant:${term}`, severity: "warn", code: "UNKNOWN_COVENANT", message: `${carrier(psp, term)} carries ${term}, which is not a CDL 1.5 covenant; pruning and the gate ignore it.${term === "no-email" ? " no-external-transmission covers email." : ""}`, target: { psp: true } });
    }
    if (!hasFilter(proxy, "request", "psp-verify")) add({ id: "psp:verify", severity: "info", code: "VERIFY_ALWAYS", message: "psp-verify is not in the request filters; the reference loop verifies the signed prompt anyway.", target: proxy ? { componentId: proxy.id } : { psp: true } });
  }

  // Filters.
  for (const p of proxies) for (const side of ["request", "response"] as const) {
    const list = filtersOf(p, side);
    const kinds = new Set<string>();
    list.forEach((spec, i) => {
      const kind = filterKind(spec), info = filterInfo(kind);
      const target = { componentId: p.id, filter: { componentId: p.id, side, index: i }, path: ["components", index(config, p.id), "filters", side, i] };
      if (kinds.has(kind)) add({ id: `filter:dup:${p.id}:${side}:${kind}`, severity: "warn", code: "DUPLICATE_FILTER", message: `${kind} appears twice in ${p.id}'s ${sideLabel(side)} filters.`, target });
      kinds.add(kind);
      if (!info) { add({ id: `filter:unknown:${p.id}:${side}:${i}`, severity: "warn", code: "UNKNOWN_FILTER", message: `${kind || "An entry"} is not a filter this studio knows; runs skip it.`, target }); return; }
      if (info.side !== side) {
        const other = filtersOf(p, info.side);
        add({ id: `filter:side:${p.id}:${side}:${i}`, severity: "error", code: "FILTER_SIDE", message: `${info.label} is a ${info.side} filter but sits in the ${side} half.`, target,
          fix: { label: `Move to the ${info.side} half`, edits: [
            { op: "set", path: ["components", index(config, p.id), "filters", side], value: list.filter((_, j) => j !== i) },
            { op: "set", path: ["components", index(config, p.id), "filters", info.side], value: [...other, spec] }
          ] } });
      }
      const options = info.schema.safeParse(filterOptionsOf(spec));
      if (!options.success) for (const issue of options.error.issues) add({ id: `filter:opt:${p.id}:${side}:${i}:${issue.path.join(".")}`, severity: "error", code: "SCHEMA", message: `${info.label} ${issue.path.join(".")}: ${issue.message}`, target });
      if (!info.supported) add({ id: `filter:unsupported:${p.id}:${kind}`, severity: "warn", code: "UNSUPPORTED_FILTER", message: `${info.label} has no reference implementation; runs report it as unsupported.`, target });
      if (info.needsVectors) {
        const store = typeof p.vectorStore === "string" ? config.components.find(c => c.id === p.vectorStore && c.kind === "vector-store") : undefined;
        if (!store) add({ id: `filter:vectors:${p.id}`, severity: "warn", code: "EXFIL_LEXICAL", message: `Exfil Guard has no vectorStore on ${p.id} and falls back to lexical-only.`, target });
        else {
          const embedding = typeof store.embedding === "string" ? store.embedding : "psp-exfil-hash-384-v1";
          if (env.embedders && !env.embedders.includes(embedding)) add({ id: `filter:embedder:${store.id}`, severity: "warn", code: "EMBEDDER_UNAVAILABLE", message: `${embedding} is not available on this server, so Exfil Guard runs the lexical tier only. psp-exfil-hash-384-v1 runs anywhere.`, target: { componentId: store.id } });
          add({ id: `filter:protected:${p.id}`, severity: "info", code: "EXFIL_PROTECTED", message: `Exfil Guard reads ${store.id}. LLMProxy registers the verified SYSTEM text there at session bootstrap (PSP-EXFIL-0.1) and checks the response side only.`, target });
        }
      }
    });
  }

  // Model and initiator.
  if (model) {
    const provider = inferProvider(String(model.model ?? ""), model.provider);
    if (!provider) add({ id: "model:provider", severity: "error", code: "UNKNOWN_PROVIDER", message: `The provider for ${String(model.model)} cannot be inferred; set provider.`, target: { componentId: model.id } });
    else if (provider === "anthropic") add({ id: "model:anthropic", severity: "warn", code: "UNSUPPORTED_PROVIDER", message: "The reference loop has no TypeScript Anthropic adapter, so turns end with UNSUPPORTED_PROVIDER. Use openai, or mock for offline wiring checks.", target: { componentId: model.id } });
  }
  if (initiator) {
    const t = String(initiator.trigger), reply = replyMode(initiator), at = { componentId: initiator.id };
    const need = (key: string, why: string) => { if (typeof initiator[key] !== "string" || !initiator[key]) add({ id: `trigger:${key}`, severity: "error", code: "TRIGGER_CONFIG", message: `A ${t} trigger needs ${key}: ${why}.`, target: { ...at, path: ["components", index(config, initiator.id), key] } }); };
    if (t === "file") { need("watch", "the workspace glob it watches"); if (reply === "channel") need("output", "the folder replies are written to"); }
    if (t === "email") need("mailbox", "the address it reads");
    if (t === "webhook") need("route", "the request path");
    if (t === "schedule") {
      need("cron", "when it fires"); need("prompt", "the message each run sends");
      if (typeof initiator.cron === "string" && !parseCron(initiator.cron)) add({ id: "trigger:cron:invalid", severity: "error", code: "TRIGGER_CONFIG", message: `${initiator.cron} is not a five-field cron expression.`, target: at });
    }
    if (reply === "none" && initiator.output !== undefined) add({ id: "trigger:output:ignored", severity: "warn", code: "OUTPUT_IGNORED", message: "output is ignored with reply: none; nothing is delivered.", target: at });
    if (t === "email" && reply === "channel") add({ id: "trigger:email:channel", severity: "warn", code: "UNSUPPORTED_SINK", message: "The studio cannot send email replies through a channel; turns record the reply as withheld. Use reply: none with a mail tool.", target: at });
    if (psp && reply === "channel") {
      const caps = sinkCapabilities(initiator);
      for (const term of psp.covenants) if (conflicts(term, "covenant", caps)) {
        add({ id: `sink:${term}`, severity: "warn", code: "SINK_COVENANT", message: hasFilter(proxy, "response", "covenant-gate")
          ? `${carrier(psp, term)} carries ${term}: replies on this ${t} channel will be withheld by Covenant Gate.`
          : `${carrier(psp, term)} carries ${term}, which conflicts with this ${t} channel, and no Covenant Gate is in the response filters.`, target: at });
      }
    }
  }

  // The tool loop and its backends.
  const catalogs = env.catalogs ?? {};
  const loops = config.components.filter(c => c.kind === "mcpproxy");
  for (const loop of loops) {
    const at = { componentId: loop.id };
    if (typeof loop.caller === "string" && model && loop.caller !== model.id && config.components.some(c => c.id === loop.caller)) add({ id: `loop:caller:${loop.id}`, severity: "error", code: "LOOP_CALLER", message: `${loop.id}.caller must name the Model (${model.id}).`, target: at });
    const urlProblem = typeof loop.backend === "string" ? backendUrlProblem(loop.backend) : "is missing";
    if (urlProblem) add({ id: `loop:backend:${loop.id}`, severity: "error", code: "BACKEND_URL", message: `${loop.id}'s backend URL ${urlProblem}.`, target: { ...at, path: ["components", index(config, loop.id), "backend"] } });
    if (!loop.serverInfo) add({ id: `loop:serverinfo:${loop.id}`, severity: "warn", code: "SERVER_INFO", message: `${loop.id} has no serverInfo. MCPProxy pins the backend's name and version at initialize, so runs cannot connect until it is set.`, target: at });
    if (typeof loop.auth !== "string") add({ id: `loop:auth:none:${loop.id}`, severity: "warn", code: "AUTH_REQUIRED", message: `${loop.id} has no auth. The reference MCP client always sends a bearer token; set auth to env:NAME.`, target: at });
    if (typeof loop.auth === "string" && env.envSet && !env.envSet.includes(loop.auth.slice(4))) add({ id: `loop:auth:${loop.id}`, severity: "warn", code: "AUTH_UNSET", message: `${loop.auth.slice(4)} is not set on the studio server.`, target: at });
    if (env.catalogs) {
      const catalog = catalogs[loop.id];
      if (!catalog) add({ id: `loop:baseline:${loop.id}`, severity: "info", code: "BASELINE_PENDING", message: `${loop.id} has no drift baseline yet; the first run captures it.`, target: at });
      else if (catalog.backend !== loop.backend) add({ id: `loop:baseline:moved:${loop.id}`, severity: "warn", code: "BASELINE_STALE", message: `${loop.id}'s baseline was captured for ${catalog.backend}. Re-baseline for the new backend.`, target: at });
    }
  }
  if (env.catalogs && loops.length) {
    const preview = registrationsFor(config, psp, catalogs);
    const known = loops.length - preview.unknownBackends.length;
    if (known) {
      const total = preview.allowed.length + preview.withheldByNode.length + preview.withheldByCovenant.length + preview.withheldByMode.length;
      add({ id: "registrations", severity: "info", code: "REGISTRATIONS", message: `${preview.node ? `For node ${preview.node}` : "With no node to consult"}, ${preview.allowed.length} of ${total} backend tools are registered${preview.allowed.length ? `: ${preview.allowed.join(", ")}` : ""}.` });
      for (const w of preview.withheldByCovenant) add({ id: `pruned:${w.tool}`, severity: "info", code: "COVENANT_PRUNED", message: `Covenant pruning withholds ${w.tool}: ${carrier(psp, w.covenant)} carries ${w.covenant}.` });
      if (preview.withheldByMode.length) add({ id: "mode", severity: "warn", code: "NOT_READ_ONLY", message: `${preview.withheldByMode.join(", ")} ${preview.withheldByMode.length === 1 ? "is" : "are"} not declared read-only. The reference dispatch gate releases read-only tools only, so runs report ${preview.withheldByMode.length === 1 ? "it" : "them"} as unsupported.` });
    }
    if (initiator && replyMode(initiator) === "none") {
      const acting = loops.flatMap(l => catalogs[l.id] ? toolDeclarations(l, catalogs[l.id]!) : []).filter(t => t.capabilities.some(c => ACTING_CAPABILITIES.has(c)));
      if (!acting.length && !preview.unknownBackends.length) add({ id: "outcome", severity: "warn", code: "NO_OUTCOME", message: "Nothing produces an outcome: no sink and no tool that acts.", target: { componentId: initiator.id } });
      else if (acting.length && acting.every(t => !t.readOnly)) add({ id: "outcome:mode", severity: "warn", code: "NO_OUTCOME", message: `With reply: none the outcome depends on ${acting.map(t => t.label).join(", ")}, which the reference gate cannot dispatch (read-only tools only).`, target: { componentId: initiator.id } });
    }
  } else if (initiator && replyMode(initiator) === "none" && !loops.length) {
    add({ id: "outcome", severity: "warn", code: "NO_OUTCOME", message: "Nothing produces an outcome: no sink and no tool that acts.", target: { componentId: initiator.id } });
  }

  // Auxiliaries.
  for (const aux of config.components.filter(c => c.kind === "logger" || c.kind === "otel")) {
    if (attachment(config, aux) !== "tap") continue;
    if (aux.kind === "otel") add({ id: `tap:otel:${aux.id}`, severity: "warn", code: "UNSUPPORTED_TAP", message: `${aux.id}: the studio has no OpenTelemetry exporter; runs report the tap as unsupported.`, target: { componentId: aux.id } });
    if (!psp) continue;
    for (const term of psp.covenants) if (conflicts(term, "covenant", TAP_CAPABILITIES[aux.kind] ?? [])) {
      add({ id: `tap:${aux.id}:${term}`, severity: "warn", code: "TAP_REDACTED", message: `${kindInfo(aux.kind)?.label ?? aux.kind} ${aux.id} taps the response while ${carrier(psp, term)} carries ${term}. It will receive redacted records for this session.`, target: { componentId: aux.id } });
    }
  }
  const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
  return problems.sort((a, b) => order[a.severity]! - order[b.severity]!);
}

/** Problem counts for badges. */
export const problemCounts = (problems: readonly Problem[]) => ({
  error: problems.filter(p => p.severity === "error").length,
  warn: problems.filter(p => p.severity === "warn").length,
  info: problems.filter(p => p.severity === "info").length
});
export const KNOWN_KINDS = COMPONENT_KINDS.map(k => k.kind);
export type { Component };
