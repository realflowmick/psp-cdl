// SPDX-License-Identifier: Apache-2.0
/** PSP authoring assistant: request and history records shared by the studio server and the browser. */
export type AssistantProvider = "anthropic" | "openai";
export interface AssistantProviderInfo {
  id: AssistantProvider;
  label: string;
  /** Vault secret holding the provider key. The key never leaves the server. */
  secret: "anthropic.apiKey" | "openai.apiKey";
  defaultModel: string;
  /** Suggestions only; any model id the provider accepts can be entered. */
  models: readonly string[];
}
export const ASSISTANT_PROVIDERS: readonly AssistantProviderInfo[] = [
  { id: "anthropic", label: "Anthropic", secret: "anthropic.apiKey", defaultModel: "claude-opus-5-5", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-8"] },
  { id: "openai", label: "OpenAI", secret: "openai.apiKey", defaultModel: "gpt-5", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini-2025-04-14"] }
];

export type AssistantMode = "create" | "modify";
export type AssistantStatus = "running" | "proposed" | "accepted" | "rejected" | "failed" | "cancelled";
export const ASSISTANT_OPEN: readonly AssistantStatus[] = ["running", "proposed"];
export type AttachmentKind = "image" | "pdf" | "text";

export const ASSISTANT_LIMITS = Object.freeze({
  maxPromptChars: 20_000,
  maxAttachments: 8,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxTotalAttachmentBytes: 20 * 1024 * 1024,
  /** Text is inlined into the prompt, so it has a tighter cap than images and PDFs. */
  maxTextAttachmentBytes: 1024 * 1024,
  maxActive: 2,
  maxOutputTokens: 32_000
});
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXTENSIONS = [".psp", ".pspx", ".md", ".txt", ".json", ".csv", ".yaml", ".yml", ".xml", ".html", ".htm"];
/** Images and PDFs go to the provider as files; anything readable as text is inlined. Null means unsupported. */
export function attachmentKind(name: string, mediaType: string): AttachmentKind | null {
  const type = mediaType.toLowerCase(), lower = name.toLowerCase();
  if (IMAGE_TYPES.includes(type)) return "image";
  if (type === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml" || TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) return "text";
  return null;
}

export interface AssistantAttachmentInput { name: string; mediaType: string; /** Base64 file content. */ data: string }
export interface AssistantAttachmentMeta { name: string; mediaType: string; kind: AttachmentKind; bytes: number; sha256: string }
export interface AssistantStartRequest {
  mode: AssistantMode;
  /** Workspace path of the application to create or change (.psp or .pspx). */
  path: string;
  provider: AssistantProvider;
  model: string;
  prompt: string;
  attachments?: AssistantAttachmentInput[];
  /** Refine an earlier proposal: the model starts from that proposal instead of the file. */
  baseId?: string;
}

/**
 * One prompt and what came of it. Stored apart from the application, under the workspace's
 * `.studio/assistant/`. Attachment contents are sent to the provider but not stored.
 */
export interface AssistantRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: AssistantStatus;
  mode: AssistantMode;
  path: string;
  format: "psp" | "pspx";
  baseId: string | null;
  provider: AssistantProvider;
  model: string;
  prompt: string;
  attachments: AssistantAttachmentMeta[];
  /** SHA-256 of the file on disk when the request started; null when creating. Accepting checks it. */
  beforeSha256: string | null;
  /** Application text before the change (the PSP part of a .pspx). */
  before: string | null;
  /** Application text the model proposed. */
  proposal: string | null;
  /** The model's short description of what it did. */
  summary: string | null;
  /** jsondiffpatch delta from the parsed `before` document to the parsed proposal; null when unchanged. */
  delta: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
  durationMs: number | null;
  attempts: number;
  error: { code: string; message: string } | null;
  decidedAt: string | null;
}
export type AssistantSummary = Omit<AssistantRecord, "before" | "proposal" | "delta">;
export const summarizeAssistant = (r: AssistantRecord): AssistantSummary => {
  const { before: _b, proposal: _p, delta: _d, ...rest } = r;
  return rest;
};
