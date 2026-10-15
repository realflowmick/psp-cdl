// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import {
  bodyOf, checkConfig, formatBody, formatPspp, parseBody, parsePspp, PipelineFormatError, pspRefOf, psppFileName,
  type PipelineConfig, type PipelineRow, type PipelineSummary
} from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";
import type { StudioDatabase } from "../db/database.js";

/** RFC 9562 UUID version 7: a millisecond timestamp, then random bits, so ids sort by creation. */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Stored { id: string; name: string; description: string | null; psp_ref: string | null; config_json: string; version: number; created_at: string; updated_at: string }
const MAX_PIPELINES = 1000;

function invalid(e: unknown): never {
  if (e instanceof PipelineFormatError) throw new StudioError(e.code === "SCHEMA_VIOLATION" ? "INVALID_PIPELINE" : e.code, 400, [e.message, ...e.issues].join(" "));
  throw e;
}

/** Pipeline configurations are rows; `.pspp` files are interchange only. Nothing runs from a file on disk. */
export class PipelineStore {
  constructor(private readonly database: StudioDatabase) {}
  private get db() { return this.database.db; }
  private row(r: Stored): PipelineRow {
    const body = parseBody(r.config_json);
    return {
      id: r.id, name: r.name, description: r.description, pspRef: r.psp_ref, version: Number(r.version), createdAt: r.created_at, updatedAt: r.updated_at,
      config: { name: r.name, ...(r.description !== null ? { description: r.description } : {}), ...body }
    };
  }
  private stored(id: string): Stored {
    if (typeof id !== "string" || !UUID.test(id)) throw new StudioError("NOT_FOUND", 404, "No such pipeline.");
    const r = this.db.prepare("SELECT * FROM pipeline WHERE id = ?").get(id) as Stored | undefined;
    if (!r) throw new StudioError("NOT_FOUND", 404, "No such pipeline.");
    return r;
  }
  list(): PipelineSummary[] {
    return (this.db.prepare("SELECT id, name, description, psp_ref, version, updated_at FROM pipeline ORDER BY name COLLATE NOCASE").all() as unknown as Stored[])
      .map(r => ({ id: r.id, name: r.name, description: r.description, pspRef: r.psp_ref, version: Number(r.version), updatedAt: r.updated_at }));
  }
  get(id: string): PipelineRow { return this.row(this.stored(id)); }
  /** Names in use, optionally without one row's own. */
  names(except?: string): string[] {
    return (this.db.prepare("SELECT id, name FROM pipeline").all() as { id: string; name: string }[]).filter(r => r.id !== except).map(r => r.name);
  }
  private byName(name: string): Stored | undefined { return this.db.prepare("SELECT * FROM pipeline WHERE name = ? COLLATE NOCASE").get(name) as Stored | undefined; }
  private check(value: unknown): PipelineConfig {
    try { return checkConfig(value); } catch (e) { return invalid(e); }
  }
  private nameTaken(name: string, except?: string): void {
    const other = this.byName(name);
    if (other && other.id !== except) throw new StudioError("NAME_TAKEN", 409, `Another pipeline is already named ${other.name}.`);
  }
  create(value: unknown): PipelineRow {
    const config = this.check(value);
    return this.database.transaction(() => {
      this.nameTaken(config.name);
      if (Number((this.db.prepare("SELECT count(*) AS n FROM pipeline").get() as { n: number }).n) >= MAX_PIPELINES) throw new StudioError("TOO_MANY_PIPELINES", 400);
      const id = uuidv7(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO pipeline(id, name, description, psp_ref, config_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .run(id, config.name, config.description ?? null, pspRefOf(config), formatBody(bodyOf(config)), now, now);
      return this.get(id);
    });
  }
  /** Saves with optimistic concurrency: `version` is the one the client read. */
  update(id: string, value: unknown, version: unknown): PipelineRow {
    if (!Number.isSafeInteger(version)) throw new StudioError("INVALID_REQUEST", 400, "version must be the integer version that was read.");
    const config = this.check(value);
    return this.database.transaction(() => {
      const current = this.stored(id);
      if (Number(current.version) !== version) throw new StudioError("VERSION_CONFLICT", 409, `This pipeline was saved elsewhere (version ${current.version}; you read ${String(version)}). Reload to see it.`);
      this.nameTaken(config.name, id);
      this.db.prepare("UPDATE pipeline SET name = ?, description = ?, psp_ref = ?, config_json = ?, version = version + 1, updated_at = ? WHERE id = ?")
        .run(config.name, config.description ?? null, pspRefOf(config), formatBody(bodyOf(config)), new Date().toISOString(), id);
      return this.get(id);
    });
  }
  delete(id: string): void {
    this.stored(id);
    this.db.prepare("DELETE FROM pipeline WHERE id = ?").run(id);
  }
  /** A free name: `<name> (copy)`, `<name> (copy 2)`, … or `<name> (2)`, … */
  freeName(base: string, style: "copy" | "number"): string {
    const taken = new Set(this.names().map(n => n.toLowerCase()));
    for (let n = 1; n < 10_000; n++) {
      const candidate = style === "copy" ? `${base} (copy${n > 1 ? ` ${n}` : ""})` : `${base} (${n + 1})`;
      if (!taken.has(candidate.toLowerCase())) return candidate.slice(0, 120);
    }
    throw new StudioError("NAME_TAKEN", 409);
  }
  duplicate(id: string): PipelineRow {
    const row = this.get(id);
    return this.create({ ...row.config, name: this.freeName(row.name, "copy") });
  }
  export(id: string): { fileName: string; text: string } {
    const row = this.get(id);
    return { fileName: psppFileName(row.name), text: formatPspp(row.config) };
  }
  /**
   * Imports a `.pspp`. A name collision is a 409 unless the caller chose: `rename` (to `name`, or the
   * next free one) or `overwrite` (keeps the existing row's id and bumps its version).
   */
  import(text: string, onConflict?: string, rename?: string): { row: PipelineRow; created: boolean } {
    let config: PipelineConfig;
    try { config = parsePspp(text); } catch (e) { return invalid(e); }
    const existing = this.byName(config.name);
    if (!existing) return { row: this.create(config), created: true };
    if (onConflict === "overwrite") return { row: this.update(existing.id, config, Number(existing.version)), created: false };
    if (onConflict === "rename") return { row: this.create({ ...config, name: rename ?? this.freeName(config.name, "number") }), created: true };
    throw new StudioError("NAME_CONFLICT", 409, `A pipeline named ${existing.name} exists. Import again with onConflict=rename or onConflict=overwrite.`);
  }
}
