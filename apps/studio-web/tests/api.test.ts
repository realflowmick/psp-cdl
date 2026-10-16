// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/lib/api";

const reply = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends JSON, encodes paths and unwraps list envelopes", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return url.endsWith("/api/runs") && init.method === "GET" ? reply(200, { runs: [{ runId: "r1" }] }) : reply(204, null); }));
    expect(await api.runs()).toEqual([{ runId: "r1" }]);
    await api.writeFile("dir/my file.psp", "x");
    await api.deleteSecret("openai.apiKey");
    expect(calls[1]?.url).toBe("/api/workspace/files/dir/my%20file.psp");
    expect(calls[1]?.init.method).toBe("PUT");
    expect(calls[1]?.init.body).toBe(JSON.stringify({ text: "x" }));
    expect(calls[2]?.init.method).toBe("DELETE");
  });
  it("maps server error envelopes and network failures to ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: { code: "INVALID_COLLECTION", message: "/scenarios/0 must have required property kind" } })));
    await expect(api.collections()).rejects.toMatchObject({ code: "INVALID_COLLECTION", status: 400, message: "/scenarios/0 must have required property kind" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const error = await api.status().catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NETWORK");
  });
});