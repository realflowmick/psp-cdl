// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { formatPspx, isPspxPath, normalizeNewlines, parsePspx, PspxError, PSPX_INTERPRETERS, PSPX_PROFILE, type PspxManifest } from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";
import type { Workspace, WorkspaceFile } from "../workspace/files.js";

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The interpreter system prompt, read the same way the live loop reads it. */
export function interpreterText(repoRoot: string, id: string): string {
  const interpreter = PSPX_INTERPRETERS.find(i => i.id === id);
  if (!interpreter) throw new StudioError("UNKNOWN_INTERPRETER", 400, `No interpreter ${id}.`);
  return interpreter.files.map(rel => {
    const file = join(repoRoot, rel);
    if (!existsSync(file)) throw new StudioError("INTERPRETER_MISSING", 500, `${rel} is not present in the repository.`);
    return normalizeNewlines(readFileSync(file, "utf8"));
  }).join("\n\n");
}
export function interpreters(repoRoot: string) {
  return PSPX_INTERPRETERS.map(i => ({ id: i.id, label: i.label, files: i.files, available: i.files.every(f => existsSync(join(repoRoot, f))) }));
}

export interface PackInput { application: string; name: string; interpreter?: string; system?: string }
/** Builds PSPX text. A given system prompt is kept as is (for example from an imported file). */
export function pack(repoRoot: string, input: PackInput): { text: string; manifest: PspxManifest } {
  const application = normalizeNewlines(input.application);
  const system = input.system !== undefined ? normalizeNewlines(input.system) : interpreterText(repoRoot, input.interpreter ?? PSPX_INTERPRETERS[0]!.id);
  const interpreter = input.system !== undefined ? input.interpreter ?? "custom" : input.interpreter ?? PSPX_INTERPRETERS[0]!.id;
  const manifest: PspxManifest = {
    profile: PSPX_PROFILE, interpreter, application: basename(input.name).replace(/\.pspx$/i, ".psp"),
    exportedAt: new Date().toISOString(), systemSha256: sha256(system), applicationSha256: sha256(application)
  };
  try { return { text: formatPspx(manifest, system, application), manifest }; }
  catch (e) { if (e instanceof PspxError) throw new StudioError(e.code, 400, e.message); throw e; }
}
export interface Unpacked { manifest: PspxManifest; system: string; application: string; verified: { system: boolean; application: boolean }; warnings: string[] }
export function unpack(text: string): Unpacked {
  let parts;
  try { parts = parsePspx(text); } catch (e) { if (e instanceof PspxError) throw new StudioError(e.code, 400, e.message); throw e; }
  const verified = { system: sha256(parts.system) === parts.manifest.systemSha256, application: sha256(parts.application) === parts.manifest.applicationSha256 };
  const warnings: string[] = [];
  if (!verified.system) warnings.push("The system prompt differs from the one recorded when the file was exported.");
  if (!verified.application) warnings.push("The application differs from the one recorded when the file was exported.");
  if (!PSPX_INTERPRETERS.some(i => i.id === parts.manifest.interpreter)) warnings.push(`The interpreter ${parts.manifest.interpreter} is not one this studio ships.`);
  return { ...parts, verified, warnings };
}

/** A workspace application file: the PSP text, plus the system part when it is a .pspx. */
export interface ApplicationFile { path: string; format: "psp" | "pspx"; text: string; fileSha256: string; system?: string; manifest?: PspxManifest }
export function readApplication(workspace: Workspace, path: string): ApplicationFile {
  const raw = workspace.read(path).text;
  if (!isPspxPath(path)) return { path, format: "psp", text: raw, fileSha256: sha256(raw) };
  const parts = unpack(raw);
  return { path, format: "pspx", text: parts.application, fileSha256: sha256(raw), system: parts.system, manifest: parts.manifest };
}
/** Writes application text; a .pspx keeps the system prompt it had, or gets the default interpreter when new. */
export function writeApplication(workspace: Workspace, repoRoot: string, path: string, application: string, previous?: ApplicationFile): WorkspaceFile {
  if (!isPspxPath(path)) return workspace.write(path, application);
  const packed = pack(repoRoot, previous?.system !== undefined
    ? { application, name: path, system: previous.system, interpreter: previous.manifest?.interpreter ?? "custom" }
    : { application, name: path });
  return workspace.write(path, packed.text);
}
