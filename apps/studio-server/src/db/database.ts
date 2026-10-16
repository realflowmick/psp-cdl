// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from "node:sqlite";
import { StudioError } from "../http/router.js";

export interface Migration { version: number; name: string; sql: string }

/**
 * One SQLite file with numbered, forward-only migrations recorded in `schema_migration`. A file
 * migrated by a newer studio is refused rather than guessed at. No table references a tenant.
 */
export class StudioDatabase {
  readonly db: DatabaseSync;
  constructor(readonly path: string, private readonly migrations: readonly Migration[]) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
      this.migrate();
    } catch (e) { this.db.close(); throw e; }
  }
  get version(): number { return Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version); }
  private migrate(): void {
    const latest = Math.max(0, ...this.migrations.map(m => m.version));
    this.transaction(() => {
      this.db.exec("CREATE TABLE IF NOT EXISTS schema_migration(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
      const current = this.version;
      if (current > latest) throw new StudioError("DATABASE_TOO_NEW", 500, `${this.path} was migrated to version ${current} by a newer studio; this one knows ${latest}.`);
      for (const m of [...this.migrations].sort((a, b) => a.version - b.version)) {
        if (m.version <= current) continue;
        this.db.exec(m.sql);
        this.db.prepare("INSERT INTO schema_migration(version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, new Date().toISOString());
        this.db.exec(`PRAGMA user_version=${m.version}`);
      }
    });
  }
  applied(): { version: number; name: string; appliedAt: string }[] {
    return (this.db.prepare("SELECT version, name, applied_at FROM schema_migration ORDER BY version").all() as { version: number; name: string; applied_at: string }[])
      .map(r => ({ version: Number(r.version), name: r.name, appliedAt: r.applied_at }));
  }
  /** Runs `work` in one immediate transaction; a throw rolls everything back. */
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const out = work(); this.db.exec("COMMIT"); return out; }
    catch (e) { try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
  }
  close(): void { try { this.db.close(); } catch { /* already closed */ } }
}

/** The studio's application database. */
export const APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 1, name: "pipeline",
    sql: `CREATE TABLE pipeline(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT,
      psp_ref TEXT,
      config_json TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX pipeline_psp_ref ON pipeline(psp_ref);`
  }
];

/** MCPProxy's own state: catalog baselines per proxy and the log of explicit re-baselines. Never part of a configuration. */
export const MCPPROXY_MIGRATIONS: readonly Migration[] = [
  {
    version: 1, name: "baseline",
    sql: `CREATE TABLE mcp_baseline(
      pipeline_id TEXT NOT NULL,
      proxy_id TEXT NOT NULL,
      backend TEXT NOT NULL,
      digest TEXT NOT NULL,
      server_name TEXT NOT NULL,
      server_version TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      last_check_at TEXT,
      last_status TEXT,
      PRIMARY KEY(pipeline_id, proxy_id)
    ) WITHOUT ROWID;
    CREATE TABLE mcp_baseline_log(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id TEXT NOT NULL,
      proxy_id TEXT NOT NULL,
      backend TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('captured', 'rebaselined', 'cleared')),
      previous_digest TEXT,
      digest TEXT,
      at TEXT NOT NULL,
      note TEXT
    );`
  }
];
