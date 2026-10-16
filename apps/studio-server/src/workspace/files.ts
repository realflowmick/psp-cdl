// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { StudioError } from "../http/router.js";

export const WORKSPACE_EXTENSIONS = [".psp", ".pspx", ".md", ".txt", ".json"] as const;
export const MAX_FILE_BYTES = 1_048_576;
const MAX_FILES = 2000;
const SKIP = new Set(["node_modules", ".git", "dist", ".artifacts", ".tools", ".venv", "__pycache__"]);

export interface WorkspaceFile { path: string; bytes: number; modifiedAt: string }

/** Reads and writes application files under one folder. Paths are workspace-relative with forward slashes. */
export class Workspace {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }
  /** Rejects traversal, absolute paths, reserved names and unsupported extensions before touching the disk. */
  resolve(path: unknown): string {
    if (typeof path !== "string" || !path.length || path.length > 512 || path.includes("\0") || path.includes("\\")) throw new StudioError("INVALID_PATH", 400, "Paths are workspace-relative with forward slashes.");
    const parts = path.split("/");
    if (parts.some(p => p === "" || p === "." || p === ".." || /^[A-Za-z]:$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p))) throw new StudioError("INVALID_PATH", 400, "Path segments must be plain names.");
    if (!WORKSPACE_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext))) throw new StudioError("UNSUPPORTED_FILE", 400, `Only ${WORKSPACE_EXTENSIONS.join(", ")} files are editable.`);
    const absolute = resolve(this.root, ...parts);
    const rel = relative(this.root, absolute);
    if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`) || resolve(this.root, rel) !== absolute) throw new StudioError("INVALID_PATH", 400, "Path escapes the workspace.");
    return absolute;
  }
  list(): WorkspaceFile[] {
    const files: WorkspaceFile[] = [];
    const walk = (dir: string): void => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
        if (files.length >= MAX_FILES) return;
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) walk(full); continue; }
        if (!entry.isFile() || !WORKSPACE_EXTENSIONS.some(ext => entry.name.toLowerCase().endsWith(ext))) continue;
        const stat = statSync(full);
        files.push({ path: relative(this.root, full).split(sep).join("/"), bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    };
    walk(this.root);
    return files;
  }
  read(path: string): { path: string; text: string; bytes: number; modifiedAt: string } {
    const absolute = this.resolve(path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new StudioError("NOT_FOUND", 404, "No such workspace file.");
    const stat = statSync(absolute);
    if (stat.size > MAX_FILE_BYTES) throw new StudioError("FILE_TOO_LARGE", 413, "Workspace files are limited to 1 MiB.");
    const text = readFileSync(absolute, "utf8");
    return { path, text, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  }
  /** Atomic replace: the previous content survives a crash mid-write. */
  write(path: string, text: unknown): WorkspaceFile {
    const absolute = this.resolve(path);
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_FILE_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new StudioError("INVALID_CONTENT", 400, "Content must be text up to 1 MiB without control characters.");
    mkdirSync(dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${process.pid}.tmp`;
    writeFileSync(temporary, text, "utf8");
    renameSync(temporary, absolute);
    const stat = statSync(absolute);
    return { path, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  }
  exists(path: string): boolean {
    try { return existsSync(this.resolve(path)); } catch { return false; }
  }
}
