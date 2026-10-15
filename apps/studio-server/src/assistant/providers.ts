// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal streaming clients for the Anthropic Messages and OpenAI Chat Completions APIs, used only by
 * the authoring assistant. Streaming keeps long generations inside Node's header timeout and lets the
 * browser show progress. The key is sent in a request header and never logged or stored.
 */
import type { AssistantProvider } from "@psp-cdl/studio-core";

export type ProviderPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "pdf"; name: string; data: string };
export interface ProviderMessage { role: "user" | "assistant"; parts: ProviderPart[] }
export interface ProviderCall {
  provider: AssistantProvider;
  model: string;
  key: string;
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  signal: AbortSignal;
  fetch: typeof fetch;
  /** Called with the number of characters received so far. */
  onText?: (chars: number) => void;
}
export interface ProviderReply { text: string; inputTokens: number; outputTokens: number; truncated: boolean }

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ProviderError"; }
}

export const ENDPOINTS = { anthropic: "https://api.anthropic.com/v1/messages", openai: "https://api.openai.com/v1/chat/completions" } as const;

export async function callProvider(call: ProviderCall): Promise<ProviderReply> {
  const request = call.provider === "anthropic" ? anthropicRequest(call) : openaiRequest(call);
  let response: Response;
  try {
    response = await call.fetch(ENDPOINTS[call.provider], { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: call.signal });
  } catch (e) {
    if (call.signal.aborted) throw e;
    throw new ProviderError("PROVIDER_UNREACHABLE", `${label(call.provider)} could not be reached: ${(e as Error).message}`);
  }
  if (!response.ok || !response.body) throw await providerFailure(call.provider, response);
  return call.provider === "anthropic" ? readAnthropic(response.body, call.onText) : readOpenAI(response.body, call.onText);
}

const label = (p: AssistantProvider) => p === "anthropic" ? "Anthropic" : "OpenAI";
async function providerFailure(provider: AssistantProvider, response: Response): Promise<ProviderError> {
  let detail = "";
  try { const body = await response.json() as { error?: { message?: unknown; type?: unknown } }; if (typeof body.error?.message === "string") detail = body.error.message.slice(0, 500); } catch { /* not JSON */ }
  const code = response.status === 401 || response.status === 403 ? "KEY_REJECTED" : response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_ERROR";
  return new ProviderError(code, `${label(provider)} returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
}

function anthropicRequest(call: ProviderCall) {
  return {
    headers: { "content-type": "application/json", "x-api-key": call.key, "anthropic-version": "2023-06-01" },
    body: {
      model: call.model, max_tokens: call.maxTokens, stream: true, system: call.system,
      messages: call.messages.map(m => ({
        role: m.role,
        content: m.parts.map(p => p.type === "text" ? { type: "text", text: p.text }
          : p.type === "image" ? { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }
          : { type: "document", title: p.name, source: { type: "base64", media_type: "application/pdf", data: p.data } })
      }))
    }
  };
}
function openaiRequest(call: ProviderCall) {
  return {
    headers: { "content-type": "application/json", authorization: `Bearer ${call.key}` },
    body: {
      model: call.model, max_completion_tokens: call.maxTokens, stream: true, stream_options: { include_usage: true },
      messages: [
        { role: "system", content: call.system },
        ...call.messages.map(m => m.role === "assistant"
          ? { role: "assistant", content: m.parts.map(p => p.type === "text" ? p.text : "").join("") }
          : {
            role: "user",
            content: m.parts.map(p => p.type === "text" ? { type: "text", text: p.text }
              : p.type === "image" ? { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } }
              : { type: "file", file: { filename: p.name, file_data: `data:application/pdf;base64,${p.data}` } })
          })
      ]
    }
  };
}

/** Server-sent events: yields each event's name and joined data lines. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const parse = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    return { event, data: data.join("\n") };
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { buffer += decoder.decode(); break; }
    buffer += decoder.decode(value, { stream: true });
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (raw.trim()) yield parse(raw);
    }
  }
  if (buffer.trim()) yield parse(buffer);
}
const json = (data: string): Record<string, any> | null => { try { return JSON.parse(data) as Record<string, any>; } catch { return null; } }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function readAnthropic(body: ReadableStream<Uint8Array>, onText?: (chars: number) => void): Promise<ProviderReply> {
  let text = "", inputTokens = 0, outputTokens = 0, stop: string | null = null;
  for await (const e of events(body)) {
    const d = json(e.data);
    if (!d) continue;
    if (d.type === "error") throw new ProviderError("PROVIDER_ERROR", `Anthropic reported an error: ${String(d.error?.message ?? "unknown").slice(0, 500)}`);
    if (d.type === "message_start") { inputTokens = Number(d.message?.usage?.input_tokens ?? 0); outputTokens = Number(d.message?.usage?.output_tokens ?? 0); }
    else if (d.type === "content_block_delta" && d.delta?.type === "text_delta" && typeof d.delta.text === "string") { text += d.delta.text; onText?.(text.length); }
    else if (d.type === "message_delta") { if (typeof d.usage?.output_tokens === "number") outputTokens = d.usage.output_tokens; if (typeof d.delta?.stop_reason === "string") stop = d.delta.stop_reason; }
  }
  if (stop === null) throw new ProviderError("PROVIDER_INCOMPLETE", "The Anthropic stream ended without a final message.");
  return { text, inputTokens, outputTokens, truncated: stop === "max_tokens" };
}
async function readOpenAI(body: ReadableStream<Uint8Array>, onText?: (chars: number) => void): Promise<ProviderReply> {
  let text = "", inputTokens = 0, outputTokens = 0, finish: string | null = null;
  for await (const e of events(body)) {
    if (e.data === "[DONE]") break;
    const d = json(e.data);
    if (!d) continue;
    if (d.error) throw new ProviderError("PROVIDER_ERROR", `OpenAI reported an error: ${String(d.error.message ?? "unknown").slice(0, 500)}`);
    const choice = Array.isArray(d.choices) ? d.choices[0] : undefined;
    if (typeof choice?.delta?.content === "string") { text += choice.delta.content; onText?.(text.length); }
    if (typeof choice?.finish_reason === "string") finish = choice.finish_reason;
    if (d.usage) { inputTokens = Number(d.usage.prompt_tokens ?? 0); outputTokens = Number(d.usage.completion_tokens ?? 0); }
  }
  if (finish === null) throw new ProviderError("PROVIDER_INCOMPLETE", "The OpenAI stream ended without a finish reason.");
  return { text, inputTokens, outputTokens, truncated: finish === "length" };
}
