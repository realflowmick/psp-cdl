// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantRecord } from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";

const ID = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;
const LIST_LIMIT = 500;

/** One JSON file per request, beside the workspace's applications but never inside them. */
export class AssistantStore {
  constructor(readonly dir: string) {}
  private file(id: string): string {
    if (!ID.test(id)) throw new StudioError("NOT_FOUND", 404, "No such assistant request.");
    return join(this.dir, `${id}.json`);
  }
  get(id: string): AssistantRecord {
    const file = this.file(id);
    if (!existsSync(file)) throw new StudioError("NOT_FOUND", 404, "No such assistant request.");
    return JSON.parse(readFileSync(file, "utf8")) as AssistantRecord;
  }
  put(record: AssistantRecord): void {
    const file = this.file(record.id);
    mkdirSync(this.dir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", "utf8");
    renameSync(temporary, file);
  }
  /** Newest first. Ids start with a UTC timestamp, so name order is time order. */
  list(): AssistantRecord[] {
    if (!existsSync(this.dir)) return [];
    const names = readdirSync(this.dir).filter(n => n.endsWith(".json") && ID.test(n.slice(0, -5))).sort().reverse().slice(0, LIST_LIMIT);
    const records: AssistantRecord[] = [];
    for (const name of names) {
      try { records.push(JSON.parse(readFileSync(join(this.dir, name), "utf8")) as AssistantRecord); } catch { /* skip a damaged record */ }
    }
    return records;
  }
}
