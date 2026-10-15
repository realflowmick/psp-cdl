// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { PspError, parseMarkup } from "@psp-cdl/core";
import {
  ASSISTANT_LIMITS, ASSISTANT_PROVIDERS, attachmentKind, isPspxPath, summarizeAssistant,
  type AssistantAttachmentMeta, type AssistantMode, type AssistantProvider, type AssistantRecord, type AssistantSummary, type AttachmentKind
} from "@psp-cdl/studio-core";
import { StudioError } from "../http/router.js";
import { readApplication, writeApplication, type ApplicationFile } from "../psp/files.js";
import type { Vault } from "../secrets/vault.js";
import type { Workspace } from "../workspace/files.js";
import { pspDelta } from "./diff.js";
import { ASSISTANT_SYSTEM_PROMPT, extractPsp, repairInstructions, userInstructions } from "./prompt.js";
import { callProvider, ProviderError, type ProviderMessage, type ProviderPart } from "./providers.js";
import { AssistantStore } from "./store.js";

export interface AssistantOptions { workspace: Workspace; vault: Vault; repoRoot: string; fetch?: typeof fetch }
interface Attachment { meta: AssistantAttachmentMeta; data: string; text?: string }
interface Validated { mode: AssistantMode; path: string; provider: AssistantProvider; model: string; prompt: string; attachments: Attachment[]; baseId: string | null }
export type AssistantView = AssistantRecord & { progress: number | null };
export type AssistantSummaryView = AssistantSummary & { progress: number | null };

const fail = (code: string, message: string, status = 400): never => { throw new StudioError(code, status, message); };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Turns a prompt (and optional attachments) into a proposed PSP application. The provider key is read
 * from the vault on the server and never returned. Nothing changes on disk until a proposal is accepted.
 */
export class AssistantService {
  readonly store: AssistantStore;
  private readonly active = new Map<string, { controller: AbortController; progress: number }>();
  private readonly fetch: typeof fetch;
  constructor(private readonly options: AssistantOptions) {
    this.store = new AssistantStore(join(options.workspace.root, ".studio", "assistant"));
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  providers() {
    const configured = new Map(this.options.vault.list().map(s => [s.name, s.configured]));
    return ASSISTANT_PROVIDERS.map(p => ({ ...p, configured: configured.get(p.secret) === true }));
  }
  list(path?: string): AssistantSummaryView[] {
    return this.store.list().map(r => this.settle(r)).filter(r => !path || r.path === path)
      .map(r => ({ ...summarizeAssistant(r), progress: this.active.get(r.id)?.progress ?? null }));
  }
  get(id: string): AssistantView {
    const r = this.settle(this.store.get(id));
    return { ...r, progress: this.active.get(id)?.progress ?? null };
  }
  /** A request still marked running with no live worker was cut off by a restart. */
  private settle(r: AssistantRecord): AssistantRecord {
    if (r.status !== "running" || this.active.has(r.id)) return r;
    const next: AssistantRecord = { ...r, status: "failed", error: { code: "INTERRUPTED", message: "The studio server stopped before the model replied." }, updatedAt: new Date().toISOString() };
    this.store.put(next);
    return next;
  }

  start(input: unknown): AssistantView {
    const v = this.validate(input);
    if (this.active.size >= ASSISTANT_LIMITS.maxActive) fail("TOO_MANY_REQUESTS", `At most ${ASSISTANT_LIMITS.maxActive} assistant requests may run at once.`, 429);
    const info = ASSISTANT_PROVIDERS.find(p => p.id === v.provider)!;
    const key = this.options.vault.get(info.secret);
    if (!key) fail("KEY_MISSING", `Store ${info.secret} on the Secrets page to use ${info.label}.`);
    const { workspace } = this.options;
    workspace.resolve(v.path);
    const exists = workspace.exists(v.path);
    let before: ApplicationFile | null = null;
    if (v.mode === "create" && exists) fail("FILE_EXISTS", `${v.path} already exists; ask for a modification instead.`, 409);
    if (v.mode === "modify") {
      if (!exists) fail("NOT_FOUND", `${v.path} does not exist.`, 404);
      before = readApplication(workspace, v.path);
    }
    let start = before?.text ?? null;
    if (v.baseId) {
      const base = this.store.get(v.baseId);
      if (base.path !== v.path || base.proposal === null) fail("INVALID_BASE", "A refinement must build on a proposal for the same file.");
      start = base.proposal;
    }
    const now = new Date();
    const r: AssistantRecord = {
      id: `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomBytes(3).toString("hex")}`,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), status: "running", mode: v.mode, path: v.path,
      format: isPspxPath(v.path) ? "pspx" : "psp", baseId: v.baseId, provider: v.provider, model: v.model, prompt: v.prompt,
      attachments: v.attachments.map(a => a.meta), beforeSha256: before?.fileSha256 ?? null, before: before?.text ?? null,
      proposal: null, summary: null, delta: null, usage: null, durationMs: null, attempts: 0, error: null, decidedAt: null
    };
    this.store.put(r);
    const worker = { controller: new AbortController(), progress: 0 };
    this.active.set(r.id, worker);
    void this.run(r, v.attachments, start, key!, worker).finally(() => this.active.delete(r.id));
    return { ...r, progress: 0 };
  }

  private async run(r: AssistantRecord, attachments: Attachment[], start: string | null, key: string, worker: { controller: AbortController; progress: number }): Promise<void> {
    const began = Date.now();
    // Attachments first, then the request: providers read reference material before the question best.
    const parts: ProviderPart[] = attachments.map(a => a.meta.kind === "text"
      ? { type: "text", text: `<attachment name=${JSON.stringify(a.meta.name)}>\n${a.text}\n</attachment>` }
      : a.meta.kind === "image" ? { type: "image", mediaType: a.meta.mediaType, data: a.data } : { type: "pdf", name: a.meta.name, data: a.data });
    parts.push({ type: "text", text: userInstructions(r.mode, r.path, r.prompt, start) });
    const messages: ProviderMessage[] = [{ role: "user", parts }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let attempts = 0;
    const finish = (patch: Partial<AssistantRecord>) => this.store.put({ ...r, ...patch, usage, attempts, durationMs: Date.now() - began, updatedAt: new Date().toISOString() });
    try {
      for (;;) {
        attempts++;
        const reply = await callProvider({
          provider: r.provider, model: r.model, key, system: ASSISTANT_SYSTEM_PROMPT, messages, maxTokens: ASSISTANT_LIMITS.maxOutputTokens,
          signal: worker.controller.signal, fetch: this.fetch, onText: n => { worker.progress = n; }
        });
        usage.inputTokens += reply.inputTokens; usage.outputTokens += reply.outputTokens;
        if (reply.truncated) throw new ProviderError("RESPONSE_TRUNCATED", "The model reached its output limit before finishing the document.");
        const extracted = extractPsp(reply.text);
        let problem: string | null = extracted ? null : "the reply had no ```psp code block";
        if (extracted) {
          try {
            if (!parseMarkup(extracted.psp).children.some(c => c.kind === "section" && c.attributes.type === "node")) problem = "the document has no ${psp type=node} section";
          } catch (e) { problem = e instanceof PspError ? `the markup did not parse (${e.code}${e.offset !== undefined ? ` at byte ${e.offset}` : ""})` : "the markup did not parse"; }
        }
        if (!problem && extracted) {
          finish({ status: "proposed", proposal: extracted.psp, summary: extracted.summary || null, delta: pspDelta(r.before, extracted.psp) });
          return;
        }
        if (attempts >= 2) throw new ProviderError("INVALID_PROPOSAL", `The model's reply could not be used: ${problem}.`);
        messages.push({ role: "assistant", parts: [{ type: "text", text: reply.text }] }, { role: "user", parts: [{ type: "text", text: repairInstructions(problem!) }] });
      }
    } catch (e) {
      if (worker.controller.signal.aborted) { finish({ status: "cancelled" }); return; }
      const code = e instanceof ProviderError ? e.code : "ASSISTANT_FAILED";
      finish({ status: "failed", error: { code, message: e instanceof Error ? e.message : "The request failed." } });
    }
  }

  cancel(id: string): AssistantView {
    const worker = this.active.get(id);
    if (!worker) fail("NOT_RUNNING", "The request is not running.", 409);
    worker!.controller.abort();
    return this.get(id);
  }
  reject(id: string): AssistantView {
    const r = this.get(id);
    if (r.status !== "proposed") fail("NOT_PROPOSED", "Only a proposed change can be rejected.", 409);
    const now = new Date().toISOString();
    this.store.put({ ...stripView(r), status: "rejected", decidedAt: now, updatedAt: now });
    return this.get(id);
  }
  /** Writes the proposal unless the file changed since the request; `force` overrides that check. */
  accept(id: string, force: boolean): AssistantView {
    const r = this.get(id);
    if (r.status !== "proposed" || r.proposal === null) fail("NOT_PROPOSED", "Only a proposed change can be accepted.", 409);
    const { workspace, repoRoot } = this.options;
    const exists = workspace.exists(r.path);
    const current = exists ? readApplication(workspace, r.path) : undefined;
    const changed = r.beforeSha256 === null ? exists : current?.fileSha256 !== r.beforeSha256;
    if (changed && !force) {
      fail("FILE_CHANGED", r.beforeSha256 === null ? `${r.path} was created after this request.` : `${r.path} changed after this request. Review the proposal, then accept anyway to overwrite.`, 409);
    }
    writeApplication(workspace, repoRoot, r.path, r.proposal!, current);
    const now = new Date().toISOString();
    this.store.put({ ...stripView(r), status: "accepted", decidedAt: now, updatedAt: now });
    return this.get(id);
  }

  private validate(input: unknown): Validated {
    if (!record(input)) fail("INVALID_REQUEST", "The body must be a JSON object.");
    const b = input as Record<string, unknown>;
    if (b.mode !== "create" && b.mode !== "modify") fail("INVALID_REQUEST", "mode must be create or modify.");
    if (typeof b.path !== "string" || !/\.pspx?$/i.test(b.path)) fail("INVALID_REQUEST", "path must name a .psp or .pspx file.");
    if (!ASSISTANT_PROVIDERS.some(p => p.id === b.provider)) fail("INVALID_REQUEST", "provider must be anthropic or openai.");
    if (typeof b.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(b.model)) fail("INVALID_REQUEST", "model must be a model id.");
    if (typeof b.prompt !== "string" || !b.prompt.trim() || b.prompt.length > ASSISTANT_LIMITS.maxPromptChars) fail("INVALID_REQUEST", `prompt must be 1 to ${ASSISTANT_LIMITS.maxPromptChars} characters.`);
    if (b.baseId !== undefined && b.baseId !== null && typeof b.baseId !== "string") fail("INVALID_REQUEST", "baseId must be a request id.");
    const raw = b.attachments ?? [];
    if (!Array.isArray(raw) || raw.length > ASSISTANT_LIMITS.maxAttachments) fail("INVALID_REQUEST", `At most ${ASSISTANT_LIMITS.maxAttachments} attachments.`);
    let total = 0;
    const attachments = (raw as unknown[]).map((a, i): Attachment => {
      if (!record(a) || typeof a.name !== "string" || !a.name || a.name.length > 200 || typeof a.mediaType !== "string" || typeof a.data !== "string") fail("INVALID_ATTACHMENT", `Attachment ${i + 1} needs a name, mediaType and base64 data.`);
      const { name, mediaType, data } = a as { name: string; mediaType: string; data: string };
      const kind: AttachmentKind | null = attachmentKind(name, mediaType);
      if (!kind) fail("UNSUPPORTED_ATTACHMENT", `${name}: attach images (PNG, JPEG, GIF, WebP), PDFs or text documents.`);
      if (data.length % 4 !== 0 || !BASE64.test(data)) fail("INVALID_ATTACHMENT", `${name} is not base64 encoded.`);
      const bytes = Buffer.from(data, "base64");
      const limit = kind === "text" ? ASSISTANT_LIMITS.maxTextAttachmentBytes : ASSISTANT_LIMITS.maxAttachmentBytes;
      if (!bytes.length || bytes.length > limit) fail("ATTACHMENT_TOO_LARGE", `${name} must be between 1 byte and ${Math.round(limit / 1024 / 1024)} MiB.`);
      total += bytes.length;
      let text: string | undefined;
      if (kind === "text") {
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""); } catch { fail("INVALID_ATTACHMENT", `${name} is not UTF-8 text.`); }
      }
      const meta: AssistantAttachmentMeta = { name, mediaType: kind === "pdf" ? "application/pdf" : mediaType || "text/plain", kind: kind!, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      return { meta, data, ...(text !== undefined ? { text } : {}) };
    });
    if (total > ASSISTANT_LIMITS.maxTotalAttachmentBytes) fail("ATTACHMENT_TOO_LARGE", `Attachments may total at most ${ASSISTANT_LIMITS.maxTotalAttachmentBytes / 1024 / 1024} MiB.`);
    return { mode: b.mode as AssistantMode, path: b.path as string, provider: b.provider as AssistantProvider, model: b.model as string, prompt: (b.prompt as string).trim(), attachments, baseId: typeof b.baseId === "string" ? b.baseId : null };
  }
}
const stripView = ({ progress: _p, ...r }: AssistantView): AssistantRecord => r;
