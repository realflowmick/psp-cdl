// SPDX-License-Identifier: Apache-2.0
/**
 * Anthropic Messages adapter for the reference LLMProxy loops. It speaks the loop's provider contract
 * (`{messages, tools}` in, `{type: "final", text}` or `{type: "tool", name, arguments}` out) and mirrors
 * the reference OpenAI adapter's discipline: a fixed endpoint, no redirects or decompression, bounded
 * request and response sizes, one tool call per step, deadlines and a call budget. It is studio code,
 * not a reference implementation, and claims no conformance profile.
 *
 * The loop maps every provider exception to PROVIDER_FAILED, so `onFailure` hands the host the reason
 * (status and the provider's error message, never the key or the request) for the run record.
 */
import { canonicalJson, parseJson, record } from "@psp-cdl/core";
import { aggregateCapabilities } from "@psp-cdl/cdl";
import { bounded } from "@psp-cdl/api-server/persistence";
import type { CapabilitySource } from "@psp-cdl/mcpproxy";
import type { ProviderRegistration } from "@psp-cdl/llmproxy";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
const MAX_BYTES = 1_048_576, MAX_ERROR_BYTES = 16_384;

export interface AnthropicLimits { maxRequestBytes: number; maxResponseBytes: number; maxOutputTokens: number; maxCalls: number; budgetTokens: number; timeoutMs: number }
export interface AnthropicUsage { attempt: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; model: string }
export interface AnthropicFailure { code: string; status?: number; detail?: string }
export interface AnthropicConfig {
  apiKey: string;
  model: string;
  sources: CapabilitySource[];
  complete: true;
  now: () => number;
  limits: AnthropicLimits;
  /** Allow user and assistant text after the first user message (the context loop's transcript). */
  transcript?: boolean;
  /** Host-only observers; never budget authority and never model-visible. */
  onUsage?: (usage: AnthropicUsage) => void;
  onFailure?: (failure: AnthropicFailure) => void;
  /** Test hook. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export class AnthropicError extends Error {
  constructor(public readonly code: string, public readonly status?: number, public readonly detail?: string) { super(code); this.name = "AnthropicError"; }
}
const fail = (code: string, status?: number, detail?: string): never => { throw new AnthropicError(code, status, detail); };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const exact = (v: unknown, keys: string[]): v is Record<string, any> => record(v) && Object.keys(v).sort().join(",") === [...keys].sort().join(","); // eslint-disable-line @typescript-eslint/no-explicit-any
function copy(v: unknown, code: string): any { try { return bounded(v); } catch { return fail(code); } } // eslint-disable-line @typescript-eslint/no-explicit-any

type Block = Record<string, unknown>;
interface Message { role: "user" | "assistant"; content: Block[] }

/** Loop request → Messages API body. Tool names go out as `psp_tool_<i>`; the loop's names stay host-side. */
export function encodeAnthropicRequest(input: unknown, model: string, limits: AnthropicLimits, transcript = false): { body: Uint8Array<ArrayBuffer>; names: string[] } {
  const value = copy(input, "INVALID_REQUEST");
  if (!exact(value, ["messages", "tools"]) || !Array.isArray(value.messages) || !Array.isArray(value.tools) || value.messages.length < 2 || value.tools.length > 128) fail("INVALID_REQUEST");
  const tools = [...value.tools].sort((a, b) => String(a?.name) < String(b?.name) ? -1 : String(a?.name) > String(b?.name) ? 1 : 0);
  const names: string[] = [];
  const wireTools = tools.map((t, i) => {
    if (!exact(t, ["name", "inputSchema", "outputSchema"]) || typeof t.name !== "string" || !/^[A-Za-z0-9_.-]{1,256}$/.test(t.name) || names.includes(t.name) ||
        !record(t.inputSchema) || t.inputSchema.type !== "object" || !record(t.outputSchema)) fail("INVALID_REQUEST");
    names.push(t.name);
    return { name: `psp_tool_${i}`, description: t.name, input_schema: t.inputSchema };
  });
  let system = "";
  const messages: Message[] = [];
  // Consecutive messages of one role become one message with several blocks.
  const push = (role: Message["role"], block: Block) => {
    const last = messages.at(-1);
    if (last && last.role === role) last.content.push(block); else messages.push({ role, content: [block] });
  };
  let pending: { name: string; id: string } | undefined, call = 0;
  for (const [i, m] of value.messages.entries()) {
    if (!record(m)) fail("INVALID_REQUEST");
    if (i < 2) {
      if (!exact(m, ["role", "content"]) || m.role !== (i === 0 ? "system" : "user") || typeof m.content !== "string") fail("INVALID_REQUEST");
      if (i === 0) system = m.content as string; else push("user", { type: "text", text: m.content });
    } else if (transcript && !pending && exact(m, ["role", "content"]) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
      push(m.role, { type: "text", text: m.content });
    } else if (!pending && exact(m, ["role", "call"]) && m.role === "assistant") {
      if (!exact(m.call, ["name", "arguments"]) || !names.includes(m.call.name) || !record(m.call.arguments)) fail("INVALID_REQUEST");
      const id = `psp_call_${call++}`;
      pending = { name: m.call.name, id };
      push("assistant", { type: "tool_use", id, name: `psp_tool_${names.indexOf(m.call.name)}`, input: m.call.arguments });
    } else if (pending && exact(m, ["role", "name", "data"]) && m.role === "tool" && m.name === pending.name && record(m.data)) {
      push("user", { type: "tool_result", tool_use_id: pending.id, content: canonicalJson(m.data) });
      pending = undefined;
    } else fail("INVALID_REQUEST");
  }
  if (pending || !system || messages[0]?.role !== "user") fail("INVALID_REQUEST");
  const request = {
    model, system, messages, max_tokens: limits.maxOutputTokens, stream: false, thinking: { type: "disabled" },
    ...(wireTools.length ? { tools: wireTools, tool_choice: { type: "auto", disable_parallel_tool_use: true } } : {})
  };
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Buffer.from(canonicalJson(request), "utf8"); } catch { return fail("REQUEST_TOO_LARGE"); }
  if (bytes.length > limits.maxRequestBytes) fail("REQUEST_TOO_LARGE");
  return { body: bytes, names };
}

/** Messages API reply → loop candidate. Text before a tool call is dropped; thinking blocks are ignored. */
export function decodeAnthropicReply(body: Uint8Array, names: string[], limits: AnthropicLimits): { result: Record<string, unknown>; usage: Omit<AnthropicUsage, "attempt"> } {
  if (body.length > limits.maxResponseBytes) fail("RESPONSE_TOO_LARGE");
  let r: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { r = parseJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body)); } catch { return fail("INVALID_RESPONSE"); }
  if (!record(r) || r.type !== "message" || r.role !== "assistant" || typeof r.model !== "string" || !Array.isArray(r.content)) fail("INVALID_RESPONSE");
  const u = r.usage;
  const optional = (v: unknown) => v === undefined || v === null ? 0 : integer(v) ? v : fail("INVALID_RESPONSE");
  if (!record(u) || !integer(u.input_tokens) || !integer(u.output_tokens) || u.output_tokens > limits.maxOutputTokens) fail("INVALID_RESPONSE");
  const usage = { inputTokens: u.input_tokens as number, outputTokens: u.output_tokens as number, cacheReadTokens: optional(u.cache_read_input_tokens), cacheWriteTokens: optional(u.cache_creation_input_tokens), model: r.model as string };
  const blocks = r.content as unknown[];
  if (!blocks.every(b => record(b) && typeof b.type === "string")) fail("INVALID_RESPONSE");
  const text = (blocks as Block[]).filter(b => b.type === "text");
  const calls = (blocks as Block[]).filter(b => b.type === "tool_use");
  if ((blocks as Block[]).some(b => !["text", "tool_use", "thinking", "redacted_thinking"].includes(b.type as string))) fail("INVALID_RESPONSE");
  if (!text.every(b => typeof b.text === "string")) fail("INVALID_RESPONSE");
  if (r.stop_reason === "max_tokens") fail("OUTPUT_TRUNCATED", undefined, `The reply reached max_tokens (${limits.maxOutputTokens}).`);
  if (r.stop_reason === "refusal") fail("PROVIDER_REFUSED", undefined, "The model declined to answer.");
  if ((r.stop_reason === "end_turn" || r.stop_reason === "stop_sequence") && calls.length === 0) {
    return { result: copy({ type: "final", text: text.map(b => b.text).join("") }, "INVALID_RESPONSE"), usage };
  }
  if (r.stop_reason !== "tool_use" || calls.length !== 1) fail("INVALID_RESPONSE");
  const t = calls[0]!;
  if (typeof t.id !== "string" || typeof t.name !== "string" || !record(t.input)) fail("INVALID_RESPONSE");
  const index = names.findIndex((_, i) => `psp_tool_${i}` === t.name);
  if (index < 0) fail("INVALID_RESPONSE");
  return { result: copy({ type: "tool", name: names[index], arguments: t.input }, "INVALID_RESPONSE"), usage };
}

const STATUS_CODES: Record<number, string> = { 400: "PROVIDER_REJECTED_REQUEST", 401: "KEY_REJECTED", 403: "KEY_REJECTED", 404: "MODEL_NOT_FOUND", 413: "REQUEST_TOO_LARGE", 429: "PROVIDER_RATE_LIMITED", 529: "PROVIDER_OVERLOADED" };

/** Reads at most `max` bytes of a response body; more than that is an error. */
async function readBounded(response: Response, max: number): Promise<Uint8Array | null> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) return null;
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Host-owned closure. Construction never performs network I/O; the key is only ever sent in a header.
 * The registration carries exactly the loop's metadata keys (the loop refuses any other); the revision names the model.
 */
export function createAnthropicProvider(config: AnthropicConfig): ProviderRegistration {
  if (!record(config) || typeof config.now !== "function" || typeof config.apiKey !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(config.apiKey)) fail("INVALID_CONFIGURATION");
  if (typeof config.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(config.model)) fail("INVALID_CONFIGURATION", undefined, "The model id must be letters, digits, dots, colons or dashes.");
  const limits: AnthropicLimits = copy(config.limits, "INVALID_CONFIGURATION"), sources: CapabilitySource[] = copy(config.sources, "INVALID_CONFIGURATION");
  if (!exact(limits, ["maxRequestBytes", "maxResponseBytes", "maxOutputTokens", "maxCalls", "budgetTokens", "timeoutMs"]) || Object.values(limits).some(v => !integer(v) || v < 1) ||
      limits.maxRequestBytes > MAX_BYTES || limits.maxResponseBytes > MAX_BYTES || limits.maxOutputTokens > 32_768 || limits.maxCalls > 256 || limits.timeoutMs > 300_000) fail("INVALID_CONFIGURATION");
  try { aggregateCapabilities(sources, config.complete); } catch { fail("INVALID_CONFIGURATION"); }
  if (config.complete !== true) fail("INVALID_CONFIGURATION");
  const { apiKey: key, model, now, onUsage, onFailure } = config, transcript = config.transcript === true;
  const doFetch = config.fetch ?? globalThis.fetch;
  let calls = 0, spent = 0, busy = false;
  return {
    id: transcript ? "anthropic-messages-context" : "anthropic-messages", revision: `messages-${ANTHROPIC_VERSION}-${model}`, sources, complete: true,
    invoke: async (input, options) => {
      if (busy) fail("PROVIDER_BUSY");
      busy = true;
      const controller = new AbortController();
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        if (!exact(options, ["deadline", "cancelled"]) || !integer(options.deadline) || typeof options.cancelled !== "function") fail("INVALID_REQUEST");
        const start = performance.now();
        const check = () => {
          let time: number, cancelled: boolean;
          try { time = now(); cancelled = options.cancelled(); } catch { return fail("HOST_ERROR"); }
          if (!integer(time) || typeof cancelled !== "boolean") fail("HOST_ERROR");
          if (cancelled) fail("CANCELLED");
          if (time >= options.deadline || performance.now() - start >= limits.timeoutMs) fail("DEADLINE_EXCEEDED");
        };
        check();
        const { body, names } = encodeAnthropicRequest(input, model, limits, transcript);
        if (calls >= limits.maxCalls) fail("BUDGET_EXHAUSTED", undefined, `This session has used its ${limits.maxCalls} model calls.`);
        if (spent >= limits.budgetTokens) fail("BUDGET_EXHAUSTED", undefined, `This session has used its ${limits.budgetTokens} token budget.`);
        calls++;
        const interrupted = new Promise<never>((_, reject) => { timer = setInterval(() => { try { check(); } catch (e) { reject(e); controller.abort(); } }, 10); });
        const exchange = (async () => {
          let response: Response;
          try {
            response = await doFetch(ANTHROPIC_MESSAGES_URL, {
              method: "POST", redirect: "error", signal: controller.signal, body,
              headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION }
            });
          } catch { return fail("PROVIDER_UNREACHABLE", undefined, "api.anthropic.com could not be reached."); }
          if (response.status !== 200) {
            const raw = await readBounded(response, MAX_ERROR_BYTES).catch(() => null);
            let detail = "";
            try { const e = raw ? JSON.parse(new TextDecoder().decode(raw)) as { error?: { type?: unknown; message?: unknown } } : null; if (typeof e?.error?.message === "string") detail = `${typeof e.error.type === "string" ? `${e.error.type}: ` : ""}${e.error.message.slice(0, 500)}`; } catch { /* not JSON */ }
            return fail(STATUS_CODES[response.status] ?? "PROVIDER_HTTP_ERROR", response.status, detail || undefined);
          }
          const encoding = response.headers.get("content-encoding");
          if (encoding && encoding !== "identity") fail("INVALID_RESPONSE");
          if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) fail("INVALID_RESPONSE");
          const raw = await readBounded(response, limits.maxResponseBytes);
          return raw ?? fail("RESPONSE_TOO_LARGE");
        })();
        exchange.catch(() => {});
        const reply = await Promise.race([exchange, interrupted]);
        check();
        const { result, usage } = decodeAnthropicReply(reply, names, limits);
        spent += usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
        if (onUsage) { try { onUsage({ attempt: calls, ...usage }); } catch { fail("HOST_ERROR"); } }
        return result;
      } catch (e) {
        // Keep the code, status and the provider's message; never the request, the reply or the key.
        const failure: AnthropicFailure = e instanceof AnthropicError
          ? { code: e.code, ...(e.status !== undefined ? { status: e.status } : {}), ...(e.detail ? { detail: e.detail } : {}) }
          : { code: "PROVIDER_FAILED" };
        try { onFailure?.(failure); } catch { /* an observer never changes the outcome */ }
        throw new AnthropicError(failure.code);
      } finally {
        if (timer !== undefined) clearInterval(timer);
        controller.abort();
        busy = false;
      }
    }
  };
}

/** One line for a run record or an event: what failed and why, without credentials. */
export function describeAnthropicFailure(f: AnthropicFailure): string {
  const head = f.status !== undefined ? `Anthropic returned HTTP ${f.status}` : `Anthropic call failed (${f.code})`;
  const hint = f.code === "KEY_REJECTED" ? " Check anthropic.apiKey on the Secrets page."
    : f.code === "MODEL_NOT_FOUND" ? " Check the model id." : "";
  const line = f.detail ? `${head}: ${f.detail}` : head;
  return `${/[.!?]$/.test(line) ? line : `${line}.`}${hint}`;
}
