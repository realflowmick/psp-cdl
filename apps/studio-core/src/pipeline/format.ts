// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical JSON for configurations and `.pspp` files. Serialization order is fixed (`psp`, then
 * components by role: ring, terminals, loop, aux; keys in kind-table order; unknown keys after, as
 * written), two-space indent and a final newline, so row → export → import → row is byte-stable and
 * a graph edit produces a minimal diff. No positions are stored.
 */
import { z } from "zod";
import { componentKeyOrder, COMPONENT_KINDS, filterSpecSchema, COMPONENT_ID, kindInfo, pspRefSchema } from "./kinds.js";
import { PSPP_FORMAT, ROLES, type Component, type FilterSpec, type PipelineBody, type PipelineConfig, type PspRef, type PsppFile, type Role } from "./types.js";

export class PipelineFormatError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues: string[] = []) { super(message); this.name = "PipelineFormatError"; }
}

export const MAX_COMPONENTS = 128;
export const MAX_PIPELINE_BYTES = 1_048_576;
export const nameSchema = z.string().min(1).max(120).regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/, "Names become file names: no \\ / : * ? \" < > | or control characters.")
  .refine(s => s.trim() === s, "No leading or trailing spaces.");
const componentBase = z.looseObject({
  id: z.string().regex(COMPONENT_ID, "Use a letter, then letters, digits, dot, dash or underscore (at most 64)."),
  kind: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  role: z.enum(ROLES as [Role, ...Role[]]),
  side: z.enum(["request", "response"]).optional()
});
export const pipelineBodySchema = z.object({
  psp: pspRefSchema.nullable(),
  components: z.array(componentBase).max(MAX_COMPONENTS)
});
export const pipelineConfigSchema = pipelineBodySchema.extend({ name: nameSchema, description: z.string().max(2000).optional() });

const ROLE_ORDER: Record<string, number> = { ring: 0, terminal: 1, loop: 2, aux: 3 };
const issueText = (issues: z.core.$ZodIssue[]): string[] => issues.slice(0, 12).map(i => `${i.path.length ? "/" + i.path.join("/") : "/"}: ${i.message}`);

function ordered(value: Record<string, unknown>, first: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of first) if (Object.hasOwn(value, key) && value[key] !== undefined) out[key] = value[key];
  for (const [key, v] of Object.entries(value)) if (!Object.hasOwn(out, key) && v !== undefined) out[key] = v;
  return out;
}
const canonicalFilter = (spec: FilterSpec): FilterSpec => typeof spec === "string" ? spec : ordered(spec, ["kind"]) as FilterSpec;
function canonicalComponent(c: Component): Component {
  const out = ordered(c, componentKeyOrder(c.kind)) as Component;
  if (c.filters && typeof c.filters === "object") {
    const f = c.filters as Record<string, unknown>;
    out.filters = ordered({
      ...f,
      ...(Array.isArray(f.request) ? { request: f.request.map(s => canonicalFilter(s as FilterSpec)) } : {}),
      ...(Array.isArray(f.response) ? { response: f.response.map(s => canonicalFilter(s as FilterSpec)) } : {})
    }, ["request", "response"]) as NonNullable<Component["filters"]>;
  }
  if (c.serverInfo && typeof c.serverInfo === "object") out.serverInfo = ordered(c.serverInfo as Record<string, unknown>, ["name", "version"]);
  return out;
}
/** Components grouped by role in canonical order; the sort is stable inside a group. */
export function canonicalComponents(components: readonly Component[]): Component[] {
  return components.map((c, i) => ({ c, i, r: ROLE_ORDER[c.role] ?? 4 })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => canonicalComponent(x.c));
}
const canonicalPsp = (psp: PspRef | null): PspRef | null => psp ? ordered(psp, ["document", "signOnRetrieval"]) as PspRef : null;

export function canonicalBody(body: PipelineBody): PipelineBody {
  return { psp: canonicalPsp(body.psp), components: canonicalComponents(body.components) };
}
const stringify = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
/** The `config_json` column. */
export const formatBody = (body: PipelineBody): string => stringify(canonicalBody(body));
/** A configuration with its name and description, as the editor's document mode shows it. */
export function formatConfig(config: PipelineConfig): string {
  const body = canonicalBody(config);
  return stringify({ name: config.name, ...(config.description !== undefined ? { description: config.description } : {}), ...body });
}
/** A `.pspp` file: exactly the configuration plus `$format`, name and description. */
export function formatPspp(config: PipelineConfig): string {
  const body = canonicalBody(config);
  const file: PsppFile = { $format: PSPP_FORMAT, name: config.name, ...(config.description !== undefined ? { description: config.description } : {}), ...body };
  return stringify(file);
}
export const psppFileName = (name: string): string => `${name}.pspp`;

function parseJsonText(text: string): unknown {
  if (typeof text !== "string") throw new PipelineFormatError("INVALID_PIPELINE", "Expected JSON text.");
  if (new TextEncoder().encode(text).length > MAX_PIPELINE_BYTES) throw new PipelineFormatError("PIPELINE_TOO_LARGE", "Pipeline files are limited to 1 MiB.");
  try { return JSON.parse(text.replace(/^﻿/, "")); }
  catch (e) { throw new PipelineFormatError("INVALID_JSON", `Not valid JSON: ${(e as Error).message}`); }
}

/**
 * Structural and per-kind schema checks. Unknown component kinds pass with their keys kept, so an
 * extension never breaks the editor; semantic rules (one Model, no free nodes) belong to `validatePipeline`.
 */
export function checkConfig(value: unknown, withName = true): PipelineConfig {
  const schema = withName ? pipelineConfigSchema : pipelineBodySchema;
  const result = schema.safeParse(value);
  if (!result.success) throw new PipelineFormatError("SCHEMA_VIOLATION", "The configuration does not match pipeline.schema.json.", issueText(result.error.issues));
  const input = value as PipelineConfig;
  const issues: string[] = [];
  input.components.forEach((c, index) => {
    const info = kindInfo(c.kind);
    if (!info) return;
    if (c.role !== info.role) issues.push(`/components/${index}/role: ${info.label} has role ${info.role}.`);
    const own = Object.fromEntries(Object.keys(info.schema.shape).filter(k => Object.hasOwn(c, k)).map(k => [k, c[k]]));
    const r = info.schema.safeParse(own);
    if (!r.success) for (const i of r.error.issues) issues.push(`/components/${index}/${i.path.join("/")}: ${i.message}`);
    if (c.kind === "llmproxy" && c.filters) for (const side of ["request", "response"] as const) {
      (c.filters[side] ?? []).forEach((spec, j) => { if (!filterSpecSchema.safeParse(spec).success) issues.push(`/components/${index}/filters/${side}/${j}: not a filter entry.`); });
    }
  });
  if (issues.length) throw new PipelineFormatError("SCHEMA_VIOLATION", "The configuration does not match pipeline.schema.json.", issues.slice(0, 12));
  return input;
}

/** Parses a configuration as shown in document mode (name, description, psp, components). */
export function parseConfig(text: string): PipelineConfig {
  const value = parseJsonText(text);
  if (value && typeof value === "object" && !Array.isArray(value) && "$format" in value) {
    const { $format, ...rest } = value as Record<string, unknown>;
    if ($format !== PSPP_FORMAT) throw new PipelineFormatError("UNSUPPORTED_FORMAT", `Expected $format ${PSPP_FORMAT}.`);
    return checkConfig(rest);
  }
  return checkConfig(value);
}
/** Parses a `.pspp` file: validates against the schema and strips `$format`. */
export function parsePspp(text: string): PipelineConfig {
  const value = parseJsonText(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PipelineFormatError("INVALID_PIPELINE", "A .pspp file holds one JSON object.");
  const { $format, ...rest } = value as Record<string, unknown>;
  if ($format !== PSPP_FORMAT) throw new PipelineFormatError("UNSUPPORTED_FORMAT", `Expected "$format": "${PSPP_FORMAT}".`);
  return checkConfig(rest);
}
export function parseBody(text: string): PipelineBody {
  const value = parseJsonText(text);
  return checkConfig(value, false);
}
export const bodyOf = (config: PipelineConfig): PipelineBody => ({ psp: config.psp, components: config.components });

/** The read-only pointer copied into the `psp_ref` column for the grid. */
export const pspRefOf = (config: PipelineBody): string | null => config.psp ? config.psp.document : null;

/**
 * `pipeline.schema.json`: the structure plus, per known kind, its own properties (draft-07 if/then),
 * for Monaco's validation, completion and hover and for clients that validate before import.
 */
export function pipelineJsonSchema(): Record<string, unknown> {
  const json = (schema: z.ZodType) => {
    const out = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete out.$schema;
    return out;
  };
  const component = json(componentBase);
  const filter = json(filterSpecSchema);
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://psp-cdl.dev/schemas/studio/pipeline-0.1.schema.json",
    title: "PSP Studio pipeline configuration (pspp/1)",
    description: "Development tooling contract: the services a PSP runs on and how they are wired. Never signed and never model-visible; it asserts no security property.",
    type: "object",
    required: ["name", "psp", "components"],
    additionalProperties: false,
    properties: {
      $format: { const: PSPP_FORMAT, description: "Present in .pspp files only." },
      name: { ...json(nameSchema), description: "Unique; the export file is <name>.pspp." },
      description: { type: "string", maxLength: 2000 },
      psp: { anyOf: [{ type: "null", description: "Run without a PSP: no node allowlist, no covenants, psp-verify has nothing to check." }, json(pspRefSchema)] },
      components: {
        type: "array", maxItems: MAX_COMPONENTS,
        items: {
          allOf: [
            component,
            ...COMPONENT_KINDS.map(k => {
              const own = json(k.schema) as { properties?: Record<string, unknown>; required?: string[] };
              return {
                if: { properties: { kind: { const: k.kind } }, required: ["kind"] },
                then: {
                  description: `${k.label}: ${k.description}`,
                  properties: { role: { const: k.role }, ...(own.properties ?? {}) },
                  ...(own.required?.length ? { required: own.required } : {})
                }
              };
            })
          ]
        }
      }
    },
    definitions: { filter }
  };
}
