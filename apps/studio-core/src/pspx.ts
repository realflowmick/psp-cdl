// SPDX-License-Identifier: Apache-2.0
/**
 * PSPX: one text file holding the interpreter system prompt first and the PSP application after it,
 * so a host that only accepts pasted instructions (for example a desktop chat project) receives both.
 *
 *   <!-- PSPX/0.1 {manifest JSON} -->
 *   <!-- pspx:system -->
 *   ...system prompt...
 *   <!-- pspx:application -->
 *   ...PSP application...
 *
 * Hashes are SHA-256 over the UTF-8 bytes of each part after newline normalization. They detect
 * edits; they are not signatures and carry no authority.
 */
export const PSPX_PROFILE = "PSPX-0.1";
export const PSPX_VERSION = "0.1";
export interface PspxInterpreter { id: string; label: string; files: readonly string[] }
/** Same instruction files, in the same order, that the live loop prepends to an application. */
export const PSPX_INTERPRETERS: readonly PspxInterpreter[] = [
  {
    id: "psp-core-3.2-draft-0.1", label: "PSP Core 3.2 and CDL 1.5 interpreter candidates (draft 0.1)",
    files: ["specs/systemprompts/PSP-Core-v3_2_0-Interpreter-draft-0_1.md", "specs/systemprompts/CDL-v1_5-Interpreter-draft-0_1.md"]
  }
];
export interface PspxManifest {
  profile: typeof PSPX_PROFILE;
  /** Interpreter id from PSPX_INTERPRETERS, or "custom" for a system prompt kept from an imported file. */
  interpreter: string;
  /** File name of the application when it was exported. */
  application: string;
  exportedAt: string;
  systemSha256: string;
  applicationSha256: string;
}
export interface PspxParts { manifest: PspxManifest; system: string; application: string }
export class PspxError extends Error {
  constructor(public readonly code: string, message?: string) { super(message ?? code); this.name = "PspxError"; }
}

const SYSTEM_MARK = "<!-- pspx:system -->", APPLICATION_MARK = "<!-- pspx:application -->";
const HEADER = /^<!-- PSPX\/(\d+\.\d+) (\{.*\}) -->$/;
export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, "\n");
export const isPspxPath = (path: string): boolean => path.toLowerCase().endsWith(".pspx");
export const isPspxText = (text: string): boolean => text.startsWith("<!-- PSPX/");

export function formatPspx(manifest: PspxManifest, system: string, application: string): string {
  const sys = normalizeNewlines(system), app = normalizeNewlines(application);
  if (sys.split("\n").includes(APPLICATION_MARK)) throw new PspxError("INVALID_SYSTEM", "The system prompt contains the PSPX application marker.");
  // `>` is escaped so no manifest value can close the comment early.
  const json = JSON.stringify(manifest).replace(/>/g, "\\u003e");
  return `<!-- PSPX/${PSPX_VERSION} ${json} -->\n${SYSTEM_MARK}\n${sys}\n${APPLICATION_MARK}\n${app}`;
}

export function parsePspx(input: string): PspxParts {
  const text = normalizeNewlines(input);
  const firstBreak = text.indexOf("\n");
  const header = HEADER.exec(firstBreak < 0 ? text : text.slice(0, firstBreak));
  if (!header) throw new PspxError("NOT_PSPX", "The file does not start with a PSPX header.");
  if (header[1] !== PSPX_VERSION) throw new PspxError("UNSUPPORTED_VERSION", `PSPX ${header[1]} is not supported; this studio reads ${PSPX_VERSION}.`);
  let manifest: unknown;
  try { manifest = JSON.parse(header[2]!); } catch { throw new PspxError("INVALID_MANIFEST", "The PSPX manifest is not valid JSON."); }
  const m = manifest as Partial<PspxManifest> | null;
  if (!m || typeof m !== "object" || m.profile !== PSPX_PROFILE || ["interpreter", "application", "exportedAt", "systemSha256", "applicationSha256"].some(k => typeof (m as Record<string, unknown>)[k] !== "string")) {
    throw new PspxError("INVALID_MANIFEST", "The PSPX manifest is missing required fields.");
  }
  const rest = text.slice(firstBreak + 1);
  if (!rest.startsWith(SYSTEM_MARK + "\n")) throw new PspxError("MISSING_SYSTEM", "The system section marker must follow the header.");
  const body = rest.slice(SYSTEM_MARK.length + 1);
  const split = body.startsWith(APPLICATION_MARK + "\n") ? -1 : body.indexOf("\n" + APPLICATION_MARK + "\n");
  if (split === -1 && !body.startsWith(APPLICATION_MARK + "\n")) throw new PspxError("MISSING_APPLICATION", "The application section marker is missing.");
  const system = split === -1 ? "" : body.slice(0, split);
  const application = body.slice(split === -1 ? APPLICATION_MARK.length + 1 : split + APPLICATION_MARK.length + 2);
  return { manifest: m as PspxManifest, system, application };
}
