// SPDX-License-Identifier: Apache-2.0
/**
 * Which backend tools reach the model payload for the current PSP node. The covenant check calls the
 * reference CDL `evaluatePolicy`; nothing here reimplements the conflict table.
 */
import { evaluatePolicy, policyTable } from "@psp-cdl/cdl";
import { hasFilter, primaryProxy, serverName, attachment } from "./topology.js";
import type { BackendCatalog, Component, PipelineBody, PspSummary, RegistrationPreview } from "./types.js";

let vocabulary: { covenants: Set<string>; classes: Set<string>; capabilities: Set<string> } | null = null;
/** CDL 1.5 terms, from the reference policy table. */
export function cdlVocabulary(): { covenants: Set<string>; classes: Set<string>; capabilities: Set<string> } {
  if (!vocabulary) {
    const table = policyTable() as unknown as { rules: { kind: string; term: string }[]; capabilities: string[] };
    vocabulary = {
      covenants: new Set(table.rules.filter(r => r.kind === "covenant").map(r => r.term)),
      classes: new Set(table.rules.filter(r => r.kind === "class").map(r => r.term)),
      capabilities: new Set(table.capabilities)
    };
  }
  return vocabulary;
}

const WITHHOLD = new Set(["CAPABILITY_CONFLICT", "PROCESSING_PROHIBITED"]);
/**
 * True when `term` (a covenant, or a data class with its own rules) forbids an invocation with these
 * capabilities. Requirement-style covenants (audit-required, hipaa) are not conflicts and do not withhold.
 */
export function conflicts(term: string, kind: "covenant" | "class", capabilities: readonly string[]): boolean {
  const v = cdlVocabulary();
  if (!(kind === "covenant" ? v.covenants : v.classes).has(term)) return false;
  const caps = capabilities.filter(c => v.capabilities.has(c));
  const decision = evaluatePolicy({ classes: kind === "class" ? [term] : [], covenants: kind === "covenant" ? [term] : [], capabilities: caps, checks: {}, parameters: {}, context: {} });
  return decision.reasonCodes.some(code => WITHHOLD.has(code));
}

/** The first covenant (or class) in context that conflicts, for attribution. */
export function conflictingTerm(context: { covenants: readonly string[]; classes: readonly string[] }, capabilities: readonly string[]): string | null {
  for (const c of context.covenants) if (conflicts(c, "covenant", capabilities)) return c;
  for (const c of context.classes) if (conflicts(c, "class", capabilities)) return c;
  return null;
}

export interface ToolDeclaration { name: string; label: string; uri: string; proxyId: string; readOnly: boolean; capabilities: string[] }
/**
 * Host declarations merged with the captured catalog. Read-only admission comes from the configuration, else from
 * the readOnlyHint recorded when the baseline was captured (an explicit, logged host action); capabilities are the union.
 */
export function toolDeclarations(proxy: Component, catalog: BackendCatalog): ToolDeclaration[] {
  const server = serverName(proxy);
  const declared = (proxy.tools && typeof proxy.tools === "object" ? proxy.tools : {}) as Record<string, { readOnly?: boolean; capabilities?: string[] }>;
  return catalog.tools.map(t => {
    const host = declared[t.name] ?? {};
    return {
      name: t.name, label: `${server}.${t.name}`, uri: `mcp://${server}/${t.name}`, proxyId: proxy.id,
      readOnly: host.readOnly ?? t.readOnly,
      capabilities: [...new Set([...(host.capabilities ?? []), ...t.capabilities])].sort()
    };
  });
}

/**
 * Allowed and withheld registrations for the node a session starts on. Node affinity applies when
 * agents-registration is in the request filters and a PSP is attached; covenant pruning when its
 * slot is present; the read-only rule always (the reference gate dispatches nothing else).
 */
export function registrationsFor(body: PipelineBody, psp: PspSummary | null, catalogs: Record<string, BackendCatalog | null | undefined>): RegistrationPreview {
  const proxy = primaryProxy(body);
  const node = psp?.entryNode ?? null;
  const byNode = !!psp && !!node && hasFilter(proxy, "request", "agents-registration");
  const pruning = hasFilter(proxy, "request", "covenant-pruning");
  const context = { covenants: psp?.covenants ?? [], classes: psp?.classes ?? [] };
  const out: RegistrationPreview = { node: node?.id ?? null, allowed: [], withheldByNode: [], withheldByCovenant: [], withheldByMode: [], unknownBackends: [] };
  for (const loop of body.components.filter(c => c.kind === "mcpproxy" && attachment(body, c) === "loop")) {
    const catalog = catalogs[loop.id];
    if (!catalog) { out.unknownBackends.push(loop.id); continue; }
    for (const tool of toolDeclarations(loop, catalog)) {
      if (byNode && !node!.agents.includes(tool.uri)) { out.withheldByNode.push(tool.label); continue; }
      const term = pruning ? conflictingTerm(context, tool.capabilities) : null;
      if (term) { out.withheldByCovenant.push({ tool: tool.label, covenant: term }); continue; }
      if (!tool.readOnly) { out.withheldByMode.push(tool.label); continue; }
      out.allowed.push(tool.label);
    }
  }
  return out;
}

/** Capabilities that perform an outcome rather than read data. */
export const ACTING_CAPABILITIES = new Set(["can-send-email", "can-send-sms", "can-post-to-web", "can-transmit-externally", "can-call-external-api", "can-write-database", "can-write-filesystem", "can-write-storage", "can-modify", "can-execute", "can-distribute", "can-share", "can-print"]);
