// SPDX-License-Identifier: Apache-2.0
import { request as httpsRequest } from "node:https";
import { canonicalJson, parseJson, record } from "@psp-cdl/core";
import { aggregateCapabilities } from "@psp-cdl/cdl";
import { bounded } from "@psp-cdl/api-server/persistence";
import type { CapabilitySource } from "@psp-cdl/mcpproxy";
import type { ProviderRegistration } from "./loop.js";

export const OPENAI_CHAT_PROFILE = "PSP-OPENAI-CHAT-0.1";
export const OPENAI_CHAT_MODEL = "gpt-4.1-mini-2025-04-14";
export const OPENAI_CHAT_REVISION = "chat-v1-gpt-4.1-mini-2025-04-14-psp-0.1";
export const OPENAI_CHAT_INPUT_RESERVATION = 1_047_576;
const MAX_BYTES = 1_048_576;
const ERROR_CODES = new Set(["INVALID_CONFIGURATION", "INVALID_REQUEST", "INVALID_RESPONSE", "REQUEST_TOO_LARGE", "RESPONSE_TOO_LARGE",
  "BUDGET_EXHAUSTED", "PROVIDER_BUSY", "CANCELLED", "DEADLINE_EXCEEDED", "PROVIDER_HTTP_ERROR", "PROVIDER_FAILED", "HOST_ERROR"]);
export interface OpenAIChatLimits {
  maxRequestBytes: number; maxResponseBytes: number; maxOutputTokens: number;
  maxCalls: number; budgetTokens: number; timeoutMs: number;
}
export interface OpenAIChatReply { status: number; contentType: string; body: Uint8Array }
/** Trusted synthetic callback only. This callback receives no API credentials. */
export type OfflineChatTransport = (body: Uint8Array, signal: AbortSignal) => OpenAIChatReply | Promise<OpenAIChatReply>;
interface CommonConfig { sources: CapabilitySource[]; complete: true; now: () => number; limits: OpenAIChatLimits }
export type OpenAIChatConfig = CommonConfig & (
  { mode: "live"; allowLive: true; apiKey: string } |
  { mode: "offline"; transport: OfflineChatTransport }
);
export class ProviderError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "ProviderError"; }
}
const fail = (code: string): never => { throw new ProviderError(code); };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const exact = (v: unknown, keys: string[]): v is Record<string, any> => record(v) && Object.keys(v).sort().join(",") === keys.sort().join(",");
const allowed = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).every(k => keys.includes(k));
function copy(v: unknown, code: string): any { try { return bounded(v); } catch { return fail(code); } }

function encodeRequest(input: unknown, limits: OpenAIChatLimits): { body: Uint8Array; names: string[] } {
  const value = copy(input, "INVALID_REQUEST");
  if (!exact(value, ["messages", "tools"]) || !Array.isArray(value.messages) || !Array.isArray(value.tools) ||
      value.messages.length < 2 || value.tools.length > 128) fail("INVALID_REQUEST");
  const tools = [...value.tools].sort((a, b) => String(a?.name) < String(b?.name) ? -1 : String(a?.name) > String(b?.name) ? 1 : 0);
  const names: string[] = [];
  const wireTools = tools.map((t, i) => {
    if (!exact(t, ["name", "inputSchema", "outputSchema"]) || typeof t.name !== "string" ||
        !/^[A-Za-z0-9_.-]{1,256}$/.test(t.name) || names.includes(t.name) || !record(t.inputSchema) || !record(t.outputSchema)) fail("INVALID_REQUEST");
    names.push(t.name);
    return { type: "function", function: { name: `psp_tool_${i}`, description: t.name, parameters: t.inputSchema } };
  });
  const messages: Record<string, unknown>[] = [];
  let pending: { name: string; id: string } | undefined, call = 0;
  for (const [i, m] of value.messages.entries()) {
    if (!record(m)) fail("INVALID_REQUEST");
    if (i < 2) {
      if (!exact(m, ["role", "content"]) || m.role !== (i === 0 ? "system" : "user") || typeof m.content !== "string") fail("INVALID_REQUEST");
      messages.push(m);
    } else if (!pending && exact(m, ["role", "call"]) && m.role === "assistant") {
      if (!exact(m.call, ["name", "arguments"]) || !names.includes(m.call.name) || !record(m.call.arguments)) fail("INVALID_REQUEST");
      const id = `psp_call_${call++}`;
      pending = { name: m.call.name, id };
      messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: {
        name: `psp_tool_${names.indexOf(m.call.name)}`, arguments: canonicalJson(m.call.arguments)
      } }] });
    } else if (pending && exact(m, ["role", "name", "data"]) && m.role === "tool" && m.name === pending.name && record(m.data)) {
      messages.push({ role: "tool", tool_call_id: pending.id, content: canonicalJson(m.data) });
      pending = undefined;
    } else fail("INVALID_REQUEST");
  }
  if (pending) fail("INVALID_REQUEST");
  const request = { model: OPENAI_CHAT_MODEL, messages, stream: false, n: 1, store: false,
    max_completion_tokens: limits.maxOutputTokens,
    ...(tools.length ? { tools: wireTools, parallel_tool_calls: false, tool_choice: "auto" } : {}) };
  let bytes: Uint8Array;
  try { bytes = Buffer.from(canonicalJson(request), "utf8"); } catch { return fail("REQUEST_TOO_LARGE"); }
  if (bytes.length > limits.maxRequestBytes) fail("REQUEST_TOO_LARGE");
  return { body: bytes, names };
}

function decodeReply(reply: OpenAIChatReply, names: string[], limits: OpenAIChatLimits): Record<string, unknown> {
  if (!exact(reply, ["status", "contentType", "body"]) || !integer(reply.status)) fail("INVALID_RESPONSE");
  if (reply.status !== 200) fail("PROVIDER_HTTP_ERROR");
  if (typeof reply.contentType !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(reply.contentType)) fail("INVALID_RESPONSE");
  if (!(reply.body instanceof Uint8Array)) fail("INVALID_RESPONSE");
  if (reply.body.length > limits.maxResponseBytes) fail("RESPONSE_TOO_LARGE");
  let r: any;
  try { r = parseJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(reply.body)); } catch { return fail("INVALID_RESPONSE"); }
  if (!record(r) || !allowed(r, ["id", "object", "created", "model", "choices", "usage", "system_fingerprint", "service_tier"]) ||
      typeof r.id !== "string" || !r.id.length || !integer(r.created) || r.object !== "chat.completion" || r.model !== OPENAI_CHAT_MODEL ||
      !Array.isArray(r.choices) || r.choices.length !== 1) fail("INVALID_RESPONSE");
  const usage: any = r.usage;
  if (!record(usage) || !allowed(usage, ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_tokens_details", "completion_tokens_details"]) ||
      !integer(usage.prompt_tokens) || !integer(usage.completion_tokens) || !integer(usage.total_tokens) ||
      usage.prompt_tokens > OPENAI_CHAT_INPUT_RESERVATION || usage.completion_tokens > limits.maxOutputTokens ||
      usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) fail("INVALID_RESPONSE");
  const c: any = r.choices[0];
  if (!record(c) || !allowed(c, ["index", "message", "finish_reason", "logprobs"]) || c.index !== 0 || c.logprobs != null) fail("INVALID_RESPONSE");
  const m: any = c.message;
  if (!record(m) || !allowed(m, ["role", "content", "refusal", "annotations", "tool_calls"]) || m.role !== "assistant" || m.refusal != null ||
      m.annotations !== undefined && (!Array.isArray(m.annotations) || m.annotations.length !== 0)) fail("INVALID_RESPONSE");
  if (c.finish_reason === "stop" && typeof m.content === "string" && (m.tool_calls === undefined || Array.isArray(m.tool_calls) && m.tool_calls.length === 0)) {
    return copy({ type: "final", text: m.content }, "INVALID_RESPONSE");
  }
  if (c.finish_reason !== "tool_calls" || !(m.content === null || m.content === "") || !Array.isArray(m.tool_calls) || m.tool_calls.length !== 1) fail("INVALID_RESPONSE");
  const t = m.tool_calls[0];
  if (!exact(t, ["id", "type", "function"]) || typeof t.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(t.id) ||
      t.type !== "function" || !exact(t.function, ["name", "arguments"]) || typeof t.function.arguments !== "string") fail("INVALID_RESPONSE");
  const index = names.findIndex((_, i) => `psp_tool_${i}` === t.function.name);
  if (index < 0) fail("INVALID_RESPONSE");
  let args: unknown;
  try { args = parseJson(t.function.arguments); } catch { return fail("INVALID_RESPONSE"); }
  if (!record(args)) fail("INVALID_RESPONSE");
  return copy({ type: "tool", name: names[index], arguments: args }, "INVALID_RESPONSE");
}

/** Fixed TLS endpoint, no redirects, retries, proxy lookup, decompression or SDK. */
function liveTransport(key: string, maxBytes: number, body: Uint8Array, signal: AbortSignal): Promise<OpenAIChatReply> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest("https://api.openai.com/v1/chat/completions", {
      method: "POST", agent: false, signal, maxHeaderSize: 16_384, rejectUnauthorized: true,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json",
        "Accept-Encoding": "identity", "Content-Length": body.length }
    }, res => {
      const rejectResponse = (code: string) => { reject(new ProviderError(code)); res.destroy(); req.destroy(); };
      if (res.statusCode !== 200) { rejectResponse("PROVIDER_HTTP_ERROR"); return; }
      if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") { rejectResponse("INVALID_RESPONSE"); return; }
      const length = res.headers["content-length"];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { rejectResponse("RESPONSE_TOO_LARGE"); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) rejectResponse("RESPONSE_TOO_LARGE"); else chunks.push(chunk);
      });
      res.on("error", () => reject(new ProviderError("PROVIDER_FAILED")));
      res.on("end", () => {
        if (!res.complete) { rejectResponse("INVALID_RESPONSE"); return; }
        resolve({ status: 200, contentType: res.headers["content-type"] ?? "", body: Buffer.concat(chunks) });
      });
    });
    req.on("error", () => reject(new ProviderError("PROVIDER_FAILED")));
    req.end(body);
  });
}

/** Host-owned closure. Construction and import never perform network I/O. */
export function createOpenAIChatProvider(config: OpenAIChatConfig): ProviderRegistration {
  if (!record(config) || !["live", "offline"].includes(config.mode) || typeof config.now !== "function") fail("INVALID_CONFIGURATION");
  const live = config.mode === "live";
  if (!exact(config, ["mode", "sources", "complete", "now", "limits", ...(live ? ["allowLive", "apiKey"] : ["transport"])])) fail("INVALID_CONFIGURATION");
  if (live && (config.allowLive !== true || typeof config.apiKey !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(config.apiKey)) ||
      !live && typeof config.transport !== "function") fail("INVALID_CONFIGURATION");
  const limits: OpenAIChatLimits = copy(config.limits, "INVALID_CONFIGURATION"), sources = copy(config.sources, "INVALID_CONFIGURATION");
  if (!exact(limits, ["maxRequestBytes", "maxResponseBytes", "maxOutputTokens", "maxCalls", "budgetTokens", "timeoutMs"]) ||
      Object.values(limits).some(v => !integer(v) || v < 1) || limits.maxRequestBytes > MAX_BYTES || limits.maxResponseBytes > MAX_BYTES ||
      limits.maxOutputTokens > 32_768 || limits.maxCalls > 32 || limits.timeoutMs > 120_000) fail("INVALID_CONFIGURATION");
  try { aggregateCapabilities(sources, config.complete); } catch { fail("INVALID_CONFIGURATION"); }
  if (config.complete !== true) fail("INVALID_CONFIGURATION");
  const now = config.now, key = live ? config.apiKey : "", transport = live ? undefined : config.transport;
  let calls = 0, reserved = 0, busy = false;
  return { id: live ? "openai-chat" : "openai-chat-offline", revision: OPENAI_CHAT_REVISION, sources, complete: true,
    invoke: async (input, options) => {
      if (busy) fail("PROVIDER_BUSY");
      busy = true;
      let timer: ReturnType<typeof setInterval> | undefined;
      let operation: Promise<OpenAIChatReply> | undefined;
      const controller = new AbortController();
      try {
        if (!exact(options, ["deadline", "cancelled"]) || !integer(options.deadline) || typeof options.cancelled !== "function") fail("INVALID_REQUEST");
        const controls = { deadline: options.deadline, cancelled: options.cancelled }, start = performance.now();
        const check = () => {
          let time: number, cancelled: boolean;
          try { time = now(); cancelled = controls.cancelled(); } catch { return fail("HOST_ERROR"); }
          if (!integer(time) || typeof cancelled !== "boolean") fail("HOST_ERROR");
          if (cancelled) fail("CANCELLED");
          if (time >= controls.deadline || performance.now() - start >= limits.timeoutMs) fail("DEADLINE_EXCEEDED");
        };
        check();
        const { body, names } = encodeRequest(input, limits);
        check();
        const reservation = OPENAI_CHAT_INPUT_RESERVATION + limits.maxOutputTokens;
        if (calls >= limits.maxCalls || reservation > limits.budgetTokens - reserved) fail("BUDGET_EXHAUSTED");
        calls++; reserved += reservation;
        const interrupted = new Promise<never>((_, reject) => {
          timer = setInterval(() => { try { check(); } catch (e) { reject(e); controller.abort(); } }, 10);
        });
        operation = Promise.resolve().then(() => {
          check();
          return live ? liveTransport(key, limits.maxResponseBytes, body, controller.signal) : transport!(body, controller.signal);
        });
        const reply = await Promise.race([operation, interrupted]);
        check();
        const result = decodeReply(reply, names, limits);
        check();
        return result;
      } catch (e) {
        // Never retain a backend exception, request, response, credential or cause.
        throw new ProviderError(e instanceof ProviderError && ERROR_CODES.has(e.code) ? e.code : "PROVIDER_FAILED");
      } finally {
        if (timer !== undefined) clearInterval(timer);
        controller.abort();
        // A cancelled but uncooperative transport still owns the pending slot.
        if (operation) void operation.then(() => { busy = false; }, () => { busy = false; });
        else busy = false;
      }
    }
  };
}
