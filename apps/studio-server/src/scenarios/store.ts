// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import { defaultCollection, isIdentifier, type Scenario, type ScenarioCollection } from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";

const require = createRequire(import.meta.url);
export const COLLECTION_SCHEMA: Record<string, unknown> = require("@psp-cdl/studio-core/schemas/scenario-collection.schema.json");
const MAX_COLLECTION_BYTES = 4 * 1024 * 1024;
const MAX_COLLECTIONS = 256;

function compile(): ValidateFunction<ScenarioCollection> {
  const ajv = new Ajv({ strict: true, allErrors: true, formats: { "date-time": (value: string) => !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) } });
  return ajv.compile<ScenarioCollection>(COLLECTION_SCHEMA);
}

/** Collections are JSON files under `<data>/collections`. Validation happens before anything reaches an engine. */
export class CollectionStore {
  private readonly dir: string;
  private readonly validator = compile();
  constructor(dataDir: string) {
    this.dir = join(dataDir, "collections");
    mkdirSync(this.dir, { recursive: true });
    if (!this.list().length) this.put(defaultCollection());
  }
  /** Structural validation plus the uniqueness rules the schema cannot express. */
  validate(value: unknown): ScenarioCollection {
    if (Buffer.byteLength(JSON.stringify(value ?? null)) > MAX_COLLECTION_BYTES) throw new StudioError("PAYLOAD_TOO_LARGE", 413);
    if (!this.validator(value)) {
      const detail = (this.validator.errors ?? []).slice(0, 8).map(e => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
      throw new StudioError("INVALID_COLLECTION", 400, detail.join("; ") || "The collection does not match the schema.");
    }
    const ids = new Set<string>();
    for (const scenario of value.scenarios) {
      if (ids.has(scenario.id)) throw new StudioError("INVALID_COLLECTION", 400, `Duplicate scenario id ${scenario.id}.`);
      ids.add(scenario.id);
      checkScenario(scenario);
    }
    return value;
  }
  private file(id: string): string {
    if (!isIdentifier(id)) throw new StudioError("INVALID_IDENTIFIER", 400);
    return join(this.dir, `${id}.json`);
  }
  list(): ScenarioCollection[] {
    const out: ScenarioCollection[] = [];
    for (const name of readdirSync(this.dir).sort()) {
      if (!name.endsWith(".json")) continue;
      try { out.push(this.validate(JSON.parse(readFileSync(join(this.dir, name), "utf8")))); }
      catch { /* An unreadable file is skipped; the API reports only valid collections. */ }
    }
    return out;
  }
  get(id: string): ScenarioCollection {
    const file = this.file(id);
    if (!existsSync(file)) throw new StudioError("NOT_FOUND", 404, "No such collection.");
    try { return this.validate(JSON.parse(readFileSync(file, "utf8"))); }
    catch (e) { throw e instanceof StudioError && e.code !== "NOT_FOUND" ? new StudioError("COLLECTION_CORRUPT", 500, e.message) : e; }
  }
  put(value: unknown): ScenarioCollection {
    const collection = this.validate(value);
    const file = this.file(collection.id);
    if (!existsSync(file) && readdirSync(this.dir).length >= MAX_COLLECTIONS) throw new StudioError("TOO_MANY_COLLECTIONS", 400);
    const stored: ScenarioCollection = { ...collection, updatedAt: new Date().toISOString() };
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(stored, null, 2) + "\n", "utf8");
    renameSync(temporary, file);
    return stored;
  }
  delete(id: string): void {
    const file = this.file(id);
    if (!existsSync(file)) throw new StudioError("NOT_FOUND", 404, "No such collection.");
    unlinkSync(file);
  }
  scenario(collectionId: string, scenarioId: string): Scenario {
    const found = this.get(collectionId).scenarios.find(s => s.id === scenarioId);
    if (!found) throw new StudioError("NOT_FOUND", 404, "No such scenario in that collection.");
    return found;
  }
}

/** Cross-field rules per scenario kind. */
export function checkScenario(scenario: Scenario): void {
  if (scenario.kind !== "live-loop") return;
  const toolNames = new Set<string>();
  for (const tool of scenario.tools) {
    const name = `${tool.server}.${tool.name}`;
    if (toolNames.has(name)) throw new StudioError("INVALID_COLLECTION", 400, `Duplicate tool ${name} in ${scenario.id}.`);
    toolNames.add(name);
  }
  if (scenario.provider.kind === "mock") {
    for (const [turn, replies] of scenario.provider.script.entries()) {
      for (const reply of replies) {
        if (reply.type === "tool" && !toolNames.has(reply.name)) throw new StudioError("INVALID_COLLECTION", 400, `Turn ${turn + 1} of ${scenario.id} calls unknown tool ${reply.name}.`);
      }
    }
  }
  if (scenario.loop === "refreshing" && !scenario.refresh) throw new StudioError("INVALID_COLLECTION", 400, `${scenario.id} uses the refreshing loop without a refresh block.`);
  if (scenario.refresh) {
    const interval = scenario.refresh.policy.includes("interval");
    if (interval !== (scenario.refresh.interval !== undefined)) throw new StudioError("INVALID_COLLECTION", 400, `${scenario.id}: interval refresh needs an interval and expiration-only refresh must not set one.`);
  }
  if (scenario.plan.completeOnTurn && scenario.plan.completeOnTurn > scenario.turns.length) throw new StudioError("INVALID_COLLECTION", 400, `${scenario.id}: completeOnTurn exceeds the turn count.`);
}
