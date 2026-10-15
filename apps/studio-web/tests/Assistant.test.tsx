// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatPspx, parsePspx, type PspxManifest } from "@psp-cdl/studio-core";
import { App } from "../src/App";
import { resetRunStreams } from "../src/lib/runEvents";
import { mockReactFlow } from "./flow-mocks";
import { fakeSocket, mockServer, PSPX_SYSTEM, SUPPORT_APP, type MockState } from "./harness";

vi.mock("../src/lib/socket", async () => { const harness = await import("./harness"); return { studioSocket: () => harness.fakeSocket }; });

beforeAll(mockReactFlow);
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); fakeSocket.reset(); resetRunStreams(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const THANKS = SUPPORT_APP.replace("  ${psp type=transitions content-type=json}",
  '  ${psp type=node node-type=prompt id="thanks" version="v1.0.0"}\n    ${psp type=system version="v1.0.0"}Thank the customer.${/psp}\n  ${/psp}\n  ${psp type=transitions content-type=json}')
  .replace('route to survey"}\n  ]', 'route to survey"},\n    {"source_node":"survey","target_node":"thanks"}\n  ]');
const MANIFEST: PspxManifest = { profile: "PSPX-0.1", interpreter: "psp-core-3.2-draft-0.1", application: "support.psp", exportedAt: "2026-10-01T00:00:00.000Z", systemSha256: "s", applicationSha256: "a" };

function start(path: string, setup: (s: MockState) => void = () => undefined) {
  window.history.replaceState(null, "", path);
  const server = mockServer();
  server.files["support.psp"] = SUPPORT_APP;
  server.proposal = THANKS;
  setup(server);
  const user = userEvent.setup();
  render(<App />);
  return { server, user };
}
const grid = (name: string) => screen.findByRole("grid", { name });
const bodyRows = (el: HTMLElement) => within(el).getAllByRole("row").slice(1);
const proposed = (s: MockState, extra: Partial<MockState["assistant"][number]> = {}) => {
  s.assistant.push({
    id: "20261012T110000Z-aaa111", createdAt: "2026-10-12T11:00:00.000Z", updatedAt: "2026-10-12T11:00:05.000Z", status: "proposed", mode: "modify", path: "support.psp", format: "psp",
    baseId: null, provider: "anthropic", model: "claude-opus-5-5", prompt: "Add a thank-you step.", attachments: [], beforeSha256: "b".repeat(64), before: SUPPORT_APP, proposal: THANKS,
    summary: "Added a thank-you node.", delta: { 0: { children: { _t: "a" } } }, usage: { inputTokens: 900, outputTokens: 700 }, durationMs: 3000, attempts: 1, error: null, decidedAt: null, progress: null, polls: 2, ...extra
  });
};

describe("PSP assistant", () => {
  it("sends a prompt with attachments, shows the proposed change three ways, and accepts it", async () => {
    const { server, user } = start("/psp");
    const files = await grid("PSP applications");
    await waitFor(() => expect(bodyRows(files)).toHaveLength(2));
    await user.click(within(files).getByRole("row", { name: /support\.psp/ }));
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "PSP assistant" });
    expect(within(dialog).getByRole("radio", { name: "Change an existing application" })).toBeChecked();
    expect(within(dialog).getByLabelText("File")).toHaveValue("support.psp");
    await waitFor(() => expect(within(dialog).getByLabelText("Provider")).toHaveDisplayValue("Anthropic · key stored"));
    expect(within(dialog).getByLabelText("Model")).toHaveValue("claude-opus-5-5");
    const generate = within(dialog).getByRole("button", { name: "Generate" });
    expect(generate).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Prompt"), "Thank the customer after the survey.");
    await user.upload(within(dialog).getByLabelText("Attach files"), [
      new File(["# Notes\nSay thanks."], "notes.md", { type: "text/markdown" }),
      new File([new Uint8Array([137, 80, 78, 71])], "flow.png", { type: "image/png" })
    ]);
    expect(within(within(dialog).getByRole("list", { name: "Attachments" })).getAllByRole("listitem")).toHaveLength(2);
    await user.click(generate);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/psp\/assistant\/20261012T120000Z-/));
    const sent = server.calls.find(c => c.method === "POST" && c.url === "/api/assistant/requests")!.body;
    expect(sent).toMatchObject({ mode: "modify", path: "support.psp", provider: "anthropic", model: "claude-opus-5-5", prompt: "Thank the customer after the survey." });
    expect(sent.attachments.map((a: { name: string; mediaType: string; data: string }) => [a.name, a.mediaType, atob(a.data)])).toEqual([["notes.md", "text/markdown", "# Notes\nSay thanks."], ["flow.png", "image/png", "\x89PNG"]]);
    expect(await screen.findByText("The model is writing: 1,200 characters so far…")).toBeInTheDocument();
    expect(await screen.findByText("Added a thank-you node.", {}, { timeout: 4000 })).toBeInTheDocument();
    const changes = screen.getByRole("tabpanel", { name: "Changes" });
    expect(within(changes).getByText("Nodes added (1)")).toBeInTheDocument();
    // Once as the added node, once as the target of the added transition.
    expect(within(changes).getAllByText("thanks")).toHaveLength(2);
    expect(within(changes).getByText("Transitions added (1)")).toBeInTheDocument();
    expect(within(changes).queryByText(/Nodes removed/)).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Source diff" }));
    const added = within(screen.getByRole("table", { name: "Source diff" })).getAllByRole("row").filter(r => r.classList.contains("add"));
    expect(added.map(r => r.textContent)).toContain(`14+  \${psp type=node node-type=prompt id="thanks" version="v1.0.0"}`);
    await user.click(screen.getByRole("tab", { name: "JSON diff" }));
    expect(document.querySelector(".jsondiff-view .jsondiffpatch-delta")).not.toBeNull();
    expect(document.querySelector(".jsondiff-view")!.textContent).toContain("thanks");
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("accepted", { selector: ".badge" })).toBeInTheDocument();
    expect(server.files["support.psp"]).toBe(THANKS);
  });

  it("keeps every request in a history grid and asks before overwriting a file that changed", async () => {
    const { server, user } = start("/psp/assistant", s => {
      proposed(s);
      proposed(s, { id: "20261012T100000Z-bbb222", createdAt: "2026-10-12T10:00:00.000Z", prompt: "An intake form.", status: "failed", proposal: null, delta: null, summary: null, error: { code: "KEY_REJECTED", message: "Anthropic returned HTTP 401." } });
      s.acceptConflict = true;
    });
    const history = await grid("Assistant requests");
    await waitFor(() => expect(bodyRows(history)).toHaveLength(2));
    await user.selectOptions(screen.getByLabelText("Status filter"), "failed");
    expect(bodyRows(history)).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Status filter"), "all");
    await user.dblClick(within(history).getByRole("row", { name: /Add a thank-you step/ }));
    expect(window.location.pathname).toBe("/psp/assistant/20261012T110000Z-aaa111");
    expect(await screen.findByRole("heading", { name: "Change request" })).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt")).toHaveTextContent("Add a thank-you step.");
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("support.psp changed after this request.")).toBeInTheDocument();
    expect(server.files["support.psp"]).toBe(SUPPORT_APP);
    await user.click(screen.getByRole("button", { name: "Accept anyway" }));
    expect(await screen.findByText("accepted", { selector: ".badge" })).toBeInTheDocument();
    expect(server.calls.filter(c => c.url.endsWith("/accept")).map(c => c.body)).toEqual([{ force: false }, { force: true }]);
  });

  it("refines a proposal from its page, and points to the Secrets page when a key is missing", async () => {
    const { server, user } = start("/psp/assistant/20261012T110000Z-aaa111", s => { proposed(s); s.keys.anthropic = false; });
    await user.click(await screen.findByRole("button", { name: "Refine" }));
    const dialog = await screen.findByRole("dialog", { name: "Refine the proposal" });
    await waitFor(() => expect(within(dialog).getByLabelText("Provider")).toHaveDisplayValue("Anthropic · no key"));
    expect(within(dialog).getByRole("link", { name: "Store anthropic.apiKey" })).toHaveAttribute("href", "/secrets/anthropic.apiKey");
    await user.type(within(dialog).getByLabelText("Prompt"), "Make the thanks warmer.");
    expect(within(dialog).getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Store anthropic.apiKey on the Secrets page to use Anthropic.");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(confirm).toHaveBeenCalledWith("Discard this prompt?");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(server.calls.some(c => c.method === "POST" && c.url === "/api/assistant/requests")).toBe(false);
  });

  it("refines with the base request id once a key is stored, and rejects a proposal", async () => {
    const { server, user } = start("/psp/assistant/20261012T110000Z-aaa111", s => proposed(s));
    await user.click(await screen.findByRole("button", { name: "Refine" }));
    const dialog = await screen.findByRole("dialog", { name: "Refine the proposal" });
    await waitFor(() => expect(within(dialog).getByLabelText("Provider")).toHaveDisplayValue("Anthropic · key stored"));
    await user.type(within(dialog).getByLabelText("Prompt"), "Make the thanks warmer.");
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/psp\/assistant\/20261012T120001Z-/));
    expect(server.calls.find(c => c.method === "POST" && c.url === "/api/assistant/requests")!.body).toMatchObject({ mode: "modify", path: "support.psp", baseId: "20261012T110000Z-aaa111" });
    expect(await screen.findByRole("heading", { name: "Refinement" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reject" }, { timeout: 4000 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("rejected", { selector: ".badge" })).toBeInTheDocument();
    expect(server.files["support.psp"]).toBe(SUPPORT_APP);
  });
});

describe("import and export", () => {
  it("imports a .pspx, shows what it carries, and saves the application as .psp", async () => {
    const { server, user } = start("/psp");
    await grid("PSP applications");
    await user.click(screen.getByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("dialog", { name: "Import a PSP application" });
    await user.upload(within(dialog).getByLabelText("File to import"), new File([formatPspx(MANIFEST, PSPX_SYSTEM, SUPPORT_APP)], "support-export.pspx"));
    expect(await within(dialog).findByText("PSPX")).toBeInTheDocument();
    expect(within(dialog).getByText("psp-core-3.2-draft-0.1")).toBeInTheDocument();
    expect(within(dialog).getByText(/matches its recorded hash/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Save as")).toHaveValue("pspx");
    expect(within(dialog).getByLabelText("Workspace path")).toHaveValue("support-export.pspx");
    await user.selectOptions(within(dialog).getByLabelText("Save as"), "psp");
    expect(within(dialog).getByLabelText("Workspace path")).toHaveValue("support-export.psp");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(window.location.pathname).toBe("/psp/files/support-export.psp"));
    expect(server.files["support-export.psp"]).toBe(SUPPORT_APP);
  });

  it("exports a .psp as .pspx: saved to the workspace, copied and downloaded", async () => {
    const createObjectURL = vi.fn(() => "blob:pspx");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { server, user } = start("/psp");
    const files = await grid("PSP applications");
    await waitFor(() => expect(bodyRows(files)).toHaveLength(2));
    await user.click(within(files).getByRole("row", { name: /support\.psp/ }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export support.psp" });
    expect(within(dialog).getByLabelText("Format")).toHaveValue("pspx");
    expect(await within(dialog).findByText(/^support\.pspx · /)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save to workspace" }));
    expect(await within(dialog).findByText("Saved support.pspx.")).toBeInTheDocument();
    const parts = parsePspx(server.files["support.pspx"]!);
    expect(parts.system).toBe(PSPX_SYSTEM);
    expect(parts.application).toBe(SUPPORT_APP);
    expect(server.files["support.pspx"]!.indexOf(PSPX_SYSTEM)).toBeLessThan(server.files["support.pspx"]!.indexOf("node-type=application"));
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(server.files["support.pspx"]);
    await user.click(within(dialog).getByRole("button", { name: "Download" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await user.selectOptions(within(dialog).getByLabelText("Format"), "psp");
    expect(await within(dialog).findByText(/^support\.psp · /)).toBeInTheDocument();
  });

  it("edits the application inside a .pspx and keeps its system prompt on save", async () => {
    const { server, user } = start("/psp/files/support.pspx", s => { s.files["support.pspx"] = formatPspx({ ...MANIFEST, interpreter: "custom" }, "CUSTOM SYSTEM PROMPT", SUPPORT_APP); });
    expect(await screen.findByLabelText("Prompt node review", { selector: ".psp-node" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("pspx", { selector: ".badge" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Outline" })).getByRole("button", { name: "survey" }));
    const inspector = within(screen.getByRole("complementary", { name: "Properties" }));
    await user.click(inspector.getByRole("tab", { name: "Instructions" }));
    await user.type(inspector.getByLabelText("System instructions"), " Keep it short.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("unsaved")).toBeNull());
    expect(server.calls.find(c => c.url === "/api/pspx/pack")!.body).toMatchObject({ name: "support.pspx", system: "CUSTOM SYSTEM PROMPT", interpreter: "custom" });
    const saved = parsePspx(server.files["support.pspx"]!);
    expect(saved.system).toBe("CUSTOM SYSTEM PROMPT");
    expect(saved.application).toContain("Ask for feedback. Keep it short.${/psp}");
  });
});
