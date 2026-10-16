// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatConfig, formatPspp, newPipeline, parsePspp, type PipelineConfig, type PipelineRow, type PspSummary, type ValidationEnv } from "@psp-cdl/studio-core";
import EXAMPLE from "../../../examples/pipelines/evaluator-ring.pspp?raw";
import { App } from "../src/App";
import { resetRunStreams } from "../src/lib/runEvents";
import { mockReactFlow } from "./flow-mocks";
import { fakeSocket, mockServer } from "./harness";

vi.mock("../src/lib/socket", async () => { const harness = await import("./harness"); return { studioSocket: () => harness.fakeSocket }; });
// Monaco does not run in jsdom; document mode is tested through the same props on a textarea.
vi.mock("../src/pages/pipelines/JsonEditor", () => ({
  default: ({ value, onChange, ariaLabel }: { value: string; onChange(v: string): void; ariaLabel: string }) => <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />
}));

beforeAll(mockReactFlow);
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); fakeSocket.reset(); resetRunStreams(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ID = "0199e0a1-0000-7000-8000-000000000001";
const SUMMARY: PspSummary = {
  pointer: "env:PSP_DOC", path: "intake.psp", source: "env", format: "psp", parses: true, signed: false,
  nodes: [{ id: "intake_review", version: "v1", agents: ["mcp://crm/lookup", "mcp://crm/send_mail"] }],
  entryNode: { id: "intake_review", version: "v1", agents: ["mcp://crm/lookup", "mcp://crm/send_mail"] },
  covenants: ["no-log", "no-external-transmission"], classes: [],
  sections: [
    { type: "system", ref: "intake_review", signature: "missing", classes: [], covenants: [], bytes: 120 },
    { type: "context", ref: "account_record", signature: "valid", algorithm: "hmac-sha256", classes: [], covenants: ["no-log", "no-external-transmission"], bytes: 80 }
  ]
};
const ENV: ValidationEnv = {
  psp: { status: "resolved", summary: SUMMARY }, otherNames: [], signing: { configured: false, algorithm: null }, embedders: ["psp-exfil-hash-384-v1"],
  catalogs: { mcpproxy_1: { proxyId: "mcpproxy_1", backend: "https://mcp.internal/crm", digest: "d1", capturedAt: "2026-10-11T00:00:00.000Z", tools: [
    { name: "lookup", readOnly: true, capabilities: [] }, { name: "notes", readOnly: true, capabilities: [] }, { name: "send_mail", readOnly: false, capabilities: ["can-send-email"] }] } }
};
const rowOf = (config: PipelineConfig, id = ID): PipelineRow => ({ id, name: config.name, description: config.description ?? null, pspRef: config.psp?.document ?? null, config, version: 1, createdAt: "2026-10-13T09:00:00.000Z", updatedAt: "2026-10-13T09:00:00.000Z" });
const example = () => parsePspp(EXAMPLE);
/** The worked example without Covenant Gate, for the drag-in test. */
const withoutGate = () => { const c = example(); c.components[0]!.filters!.response = c.components[0]!.filters!.response.filter(f => f !== "covenant-gate"); return c; };

function start(path: string, rows: PipelineRow[] = [rowOf(example())], env: ValidationEnv = ENV) {
  window.history.replaceState(null, "", path);
  const server = mockServer();
  server.pipelines = rows;
  server.pipelineEnv = env;
  const user = userEvent.setup();
  render(<App />);
  return { server, user };
}
const transfer = () => {
  const data = new Map<string, string>();
  return { setData: (k: string, v: string) => { data.set(k, v); }, getData: (k: string) => data.get(k) ?? "", get types() { return [...data.keys()]; }, effectAllowed: "all", dropEffect: "none", files: [] as File[] };
};
/** Drags a palette item onto an element, as the browser does: dragstart, dragover (the HUD updates), drop. */
function dragTo(item: HTMLElement, target: HTMLElement) {
  const dt = transfer();
  fireEvent.dragStart(item, { dataTransfer: dt });
  fireEvent.dragOver(target, { dataTransfer: dt });
  const hud = document.querySelector(".pl-hud")?.textContent ?? "";
  fireEvent.drop(target, { dataTransfer: dt });
  fireEvent.dragEnd(item, { dataTransfer: dt });
  return hud;
}
const card = (label: string) => screen.findByLabelText(label, { selector: ".pl-card" }, { timeout: 8000 });
const palette = (label: string) => within(screen.getByRole("complementary", { name: "Components" })).getByRole("button", { name: `Add ${label}` });
const details = () => within(screen.getByRole("complementary", { name: "Details" }));
/**
 * Types into a field inside the resizable panels. In jsdom every rectangle is empty, so the panel group
 * reads each pointerdown as a separator grab and keeps focus where it was; focusing directly avoids that.
 */
async function typeInto(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) { el.focus(); await user.keyboard(text); }
const crumbLink = () => within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Pipelines" });
const puts = (server: ReturnType<typeof mockServer>) => server.calls.filter(c => c.method === "PUT" && c.url === `/api/pipelines/${ID}`);

describe("Pipelines grid", () => {
  it("lists saved pipelines; double-click and select + Edit open the detail route; New creates an empty ring", async () => {
    const { server, user } = start("/pipelines");
    const grid = await screen.findByRole("grid", { name: "Pipelines" });
    const row = await within(grid).findByRole("row", { name: /evaluator-ring/ });
    expect(within(grid).getAllByRole("columnheader").map(h => h.textContent!.replace(/[▲▼]/, ""))).toEqual(["", "Name", "Description", "PSP", "Updated"]);
    expect(row).toHaveTextContent("Intake review with CRM tools and exfiltration guards");
    expect(row).toHaveTextContent("env:PSP_DOC");
    await user.dblClick(row);
    expect(window.location.pathname).toBe(`/pipelines/${ID}`);
    await card("Model model_1");
    await user.click(crumbLink());
    const again = await within(await screen.findByRole("grid", { name: "Pipelines" })).findByRole("row", { name: /evaluator-ring/ });
    await user.click(again);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(window.location.pathname).toBe(`/pipelines/${ID}`);
    await card("Model model_1");
    await user.click(crumbLink());
    await user.click(await screen.findByRole("button", { name: "New" }));
    const dialog = within(screen.getByRole("dialog", { name: "New pipeline" }));
    expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("pipeline-1");
    await user.click(dialog.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.pathname).toBe("/pipelines/0199e0a1-0000-7000-8000-000000000002"));
    expect(server.calls.find(c => c.method === "POST" && c.url === "/api/pipelines")!.body).toEqual(newPipeline("pipeline-1"));
    expect(await screen.findByLabelText("Empty PSP slot", { selector: ".pl-card" })).toHaveTextContent("No PSP — drop one or run without");
  });

  it("imports evaluator-ring.pspp, exports it byte for byte, and resolves a name collision by renaming", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return "blob:pspp"; }), revokeObjectURL: vi.fn() }));
    const { server, user } = start("/pipelines", []);
    await user.click(await screen.findByRole("button", { name: "Import .pspp" }));
    let dialog = within(screen.getByRole("dialog", { name: "Import a pipeline" }));
    await user.upload(dialog.getByLabelText("Pipeline file"), new File([EXAMPLE], "evaluator-ring.pspp", { type: "application/json" }));
    expect(await dialog.findByText("Intake review with CRM tools and exfiltration guards")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/pipelines/${ID}`));
    expect(server.calls.find(c => c.url === "/api/pipelines/import")!.body).toEqual(JSON.parse(EXAMPLE));
    await card("Model model_1");
    await user.click(crumbLink());
    const grid = await screen.findByRole("grid", { name: "Pipelines" });
    await user.click(await within(grid).findByRole("row", { name: /evaluator-ring/ }));
    await user.click(screen.getByRole("button", { name: "Export .pspp" }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(await blobs[0]!.text()).toBe(EXAMPLE);
    // The same file again collides; rename it.
    await user.click(screen.getByRole("button", { name: "Import .pspp" }));
    dialog = within(screen.getByRole("dialog", { name: "Import a pipeline" }));
    await user.upload(dialog.getByLabelText("Pipeline file"), new File([EXAMPLE], "evaluator-ring.pspp", { type: "application/json" }));
    await user.click(await dialog.findByRole("button", { name: "Import" }));
    expect(await dialog.findByText("A pipeline named evaluator-ring exists")).toBeInTheDocument();
    expect(dialog.getByRole("textbox", { name: "New name" })).toHaveValue("evaluator-ring (2)");
    await user.click(dialog.getByRole("button", { name: "Import renamed" }));
    await waitFor(() => expect(server.pipelines.map(p => p.name)).toEqual(["evaluator-ring", "evaluator-ring (2)"]));
    expect(server.calls.some(c => c.url === "/api/pipelines/import?onConflict=rename&name=evaluator-ring+%282%29")).toBe(true);
    // Several checked rows export one file each.
    await user.click(crumbLink());
    const list = await screen.findByRole("grid", { name: "Pipelines" });
    await waitFor(() => expect(within(list).getAllByRole("row")).toHaveLength(3));
    await user.click(within(list).getByRole("checkbox", { name: "Select evaluator-ring" }));
    await user.click(within(list).getByRole("checkbox", { name: "Select evaluator-ring (2)" }));
    await user.click(screen.getByRole("button", { name: "Export 2 .pspp" }));
    await waitFor(() => expect(blobs).toHaveLength(3));
  });
});

describe("Pipeline detail", () => {
  it("draws the ring, the loop, the bootstrap and the taps, and shows the validation results", async () => {
    start(`/pipelines/${ID}`);
    for (const label of ["Initiator initiator_1", "LLMProxy request half llmproxy_1", "Model model_1", "LLMProxy response half llmproxy_1", "MCPProxy mcpproxy_1", "MCP Server for mcpproxy_1", "PSP Document", "PSP Context", "Auxiliary protected_vectors", "Auxiliary log_1"]) {
      expect(await card(label)).toBeInTheDocument();
    }
    expect(within(await card("LLMProxy response half llmproxy_1")).getAllByRole("listitem").map(li => li.getAttribute("aria-label"))).toEqual([
      "response filter slot 1: Exfil Guard", "response filter slot 2: Covenant Gate", "response filter slot 3: Data-use check", "Drop a response filter at the end"]);
    const validation = within(screen.getByRole("region", { name: "Validation" }));
    for (const text of [
      "PSP document resolved from PSP_DOC (intake.psp), signed on retrieval (ed25519), bound to the session.",
      "Exfil Guard reads protected_vectors. LLMProxy registers the verified SYSTEM text there at session bootstrap (PSP-EXFIL-0.1) and checks the response side only.",
      "Covenant pruning withholds crm.send_mail: account_record carries no-external-transmission.",
      "Logger log_1 taps the response while account_record carries no-log. It will receive redacted records for this session."
    ]) expect(await validation.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pipeline" })).toHaveTextContent("1 ring · 1 bootstrap · 6 filters · 1 loop + backend · 2 auxiliary");
    expect(document.querySelectorAll(".pl-edge.kind-request").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".pl-edge.kind-aux.dashed")).toHaveLength(2);
  });

  it("drops Covenant Gate between Exfil Guard and Data-use check; Save changes exactly that entry", async () => {
    const { server, user } = start(`/pipelines/${ID}`, [rowOf(withoutGate())]);
    const half = await card("LLMProxy response half llmproxy_1");
    const slot = within(half).getByLabelText("response filter slot 2: Data-use check");
    const hud = dragTo(palette("Covenant Gate"), slot);
    expect(hud).toBe("Insert as response filter · slot 2 of llmproxy_1");
    await waitFor(() => expect(within(half).getAllByRole("listitem").map(li => li.getAttribute("aria-label")).slice(0, 3)).toEqual([
      "response filter slot 1: Exfil Guard", "response filter slot 2: Covenant Gate", "response filter slot 3: Data-use check"]));
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts(server)).toHaveLength(1));
    const saved = puts(server)[0]!.body;
    expect(saved.version).toBe(1);
    expect(formatPspp(saved.config)).toBe(EXAMPLE);
    const before = formatConfig(withoutGate()).split("\n"), after = formatConfig(saved.config).split("\n");
    expect(after.length - before.length).toBe(1);
    expect(after.filter(line => !before.includes(line))).toEqual(["          \"covenant-gate\","]);
  });

  it("a Logger dropped on empty space is a flagged free node; one dropped on the response half taps it and is redacted", async () => {
    start(`/pipelines/${ID}`);
    const canvas = (await card("Model model_1")).closest(".pl-canvas") as HTMLElement;
    const dt = transfer();
    fireEvent.dragStart(palette("Logger"), { dataTransfer: dt });
    fireEvent.dragOver(canvas, { dataTransfer: dt, clientX: 90000, clientY: 90000 });
    expect(document.querySelector(".pl-hud")).toHaveTextContent("Free node · flagged by Validate");
    fireEvent.drop(canvas, { dataTransfer: dt, clientX: 90000, clientY: 90000 });
    expect(await card("Free node log_2")).toBeInTheDocument();
    // The dropped component is selected; its own problems show in the details panel.
    expect(await details().findByText(/log_2 is not attached to anything/)).toBeInTheDocument();
    // A second logger dropped by the response half becomes a tap.
    const half = await card("LLMProxy response half llmproxy_1");
    expect(dragTo(palette("Logger"), half)).toBe("Tap · llmproxy_1.response");
    expect(await card("Auxiliary log_3")).toBeInTheDocument();
    expect(await details().findByText("Logger log_3 taps the response while account_record carries no-log. It will receive redacted records for this session.")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".pl-edge.kind-aux.dashed")).toHaveLength(3));
    // With nothing selected, Validate lists the free node with its quick fix.
    fireEvent.click(details().getByRole("button", { name: "Done" }));
    const validation = within(await screen.findByRole("region", { name: "Validation" }));
    fireEvent.click(validation.getByRole("button", { name: "Tap llmproxy_1.response" }));
    expect(await card("Auxiliary log_2")).toBeInTheDocument();
  });

  it("the PSP Document dialog shows the pointer and the read-only sections; Open in PSP editor; Clear runs without a PSP", async () => {
    const { user } = start(`/pipelines/${ID}`);
    await user.dblClick(await card("PSP Document"));
    let dialog = within(await screen.findByRole("dialog", { name: "PSP Document" }));
    expect(dialog.getByRole("combobox", { name: "Document" })).toHaveValue("env:PSP_DOC");
    expect(dialog.getByRole("combobox", { name: "Sign on retrieval" })).toHaveValue("ed25519");
    expect(await dialog.findByText("intake.psp (psp)")).toBeInTheDocument();
    await user.click(dialog.getByRole("tab", { name: "Sections" }));
    const rows = within(dialog.getByRole("table", { name: "Sections" })).getAllByRole("row").map(r => r.textContent);
    expect(rows[1]).toMatch(/SYSTEM intake_review.*missing.*registered at bootstrap/);
    expect(rows[2]).toMatch(/CONTEXT account_record.*valid · hmac-sha256.*no-log, no-external-transmission.*not registered/);
    await user.click(dialog.getByRole("button", { name: "Clear" }));
    expect(await screen.findByLabelText("Empty PSP slot", { selector: ".pl-card" })).toHaveTextContent("No PSP — drop one or run without");
    expect(await within(screen.getByRole("region", { name: "Validation" })).findByText("Runs without a PSP — no node allowlist, no covenants, psp-verify skipped.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.dblClick(await card("PSP Document"));
    dialog = within(await screen.findByRole("dialog", { name: "PSP Document" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Open in PSP editor" })).toBeEnabled());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(dialog.getByRole("button", { name: "Open in PSP editor" }));
    expect(window.location.pathname).toBe("/psp/files/intake.psp");
  });

  it("switching the trigger to file shows the queue and drop zone; a landed file runs a turn whose reply lands in output", async () => {
    const { server, user } = start(`/pipelines/${ID}`);
    server.queue = { watch: "inbox/*.txt", files: [{ path: "inbox/a.txt", bytes: 12, modifiedAt: "2026-10-14T09:00:00.000Z" }] };
    server.turn = (input, turn) => ({ turn, input: { trigger: "file", summary: `file ${(input.file as { name: string }).name}` }, reply: "Renewal summarized.", delivery: "delivered", deliveredTo: "out/scan.reply.md" });
    await user.dblClick(await card("Initiator initiator_1"));
    const dialog = within(await screen.findByRole("dialog", { name: "Initiator · initiator_1" }));
    await user.selectOptions(dialog.getByRole("combobox", { name: "Trigger" }), "file");
    await user.type(dialog.getByRole("textbox", { name: "Watch" }), "inbox/*.txt");
    await user.click(dialog.getByRole("tab", { name: "Reply" }));
    await user.selectOptions(dialog.getByRole("combobox", { name: "Reply" }), "channel");
    await user.type(dialog.getByRole("textbox", { name: "Output" }), "out");
    await user.click(dialog.getByRole("button", { name: "Apply" }));
    const dock = () => within(screen.getByRole("region", { name: "Initiator" }));
    expect(await dock().findByText("inbox/a.txt")).toBeInTheDocument();
    expect(dock().getByLabelText("Drop a file to simulate it landing")).toBeInTheDocument();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.upload(dock().getByLabelText("File to land"), new File(["Account 4471 renewal form."], "scan.txt", { type: "text/plain" }));
    expect(await dock().findByText("delivered · out/scan.reply.md")).toBeInTheDocument();
    expect(dock().getByLabelText("Reply")).toHaveTextContent("Renewal summarized.");
    const turn = server.calls.find(c => c.url.endsWith("/turn"))!;
    expect(turn.body).toEqual({ file: { name: "scan.txt", mediaType: "text/plain", bytes: 26, text: "Account 4471 renewal form." } });
    // The session ran on the saved row: Save happened first.
    expect(puts(server)[0]!.body.config.components.find((c: { id: string }) => c.id === "initiator_1")).toEqual({ id: "initiator_1", kind: "initiator", role: "terminal", trigger: "file", reply: "channel", watch: "inbox/*.txt", output: "out" });
  });

  it("email with reply none draws the ring open; a pasted email is recorded, not delivered, with pruning shown", async () => {
    const config = example();
    config.components = config.components.map(c => c.id === "initiator_1" ? { id: "initiator_1", kind: "initiator", role: "terminal", trigger: "email", reply: "none", mailbox: "intake@keystone.example" } : c);
    const { server, user } = start(`/pipelines/${ID}`, [rowOf(config)]);
    server.turn = turn => ({ turn: 1, input: { trigger: "email", summary: "email Renewal" }, reply: "Drafted a reply to the broker.", delivery: "none",
      registrations: { allowed: ["crm.lookup"], withheldByNode: ["crm.notes"], withheldByCovenant: [{ tool: "crm.send_mail", covenant: "no-external-transmission" }], withheldByMode: [] } }) as never;
    expect(await screen.findByLabelText("Response path terminator", { selector: ".pl-card" })).toHaveTextContent("recorded, not delivered");
    const initiator = await card("Initiator initiator_1");
    expect(initiator.querySelectorAll(".react-flow__handle")).toHaveLength(1);
    const dock = () => within(screen.getByRole("region", { name: "Initiator" }));
    await typeInto(user, dock().getByRole("textbox", { name: "Subject" }), "Renewal");
    await typeInto(user, dock().getByRole("textbox", { name: "Email body" }), "Please confirm the renewal.");
    await user.click(dock().getByRole("button", { name: "Run with this email" }));
    expect(await dock().findByText("recorded, not delivered")).toBeInTheDocument();
    expect(dock().getByLabelText("Reply")).toHaveTextContent("Drafted a reply to the broker.");
    expect(dock().getByText("crm.send_mail (no-external-transmission)")).toBeInTheDocument();
    expect(server.calls.find(c => c.url.endsWith("/turn"))!.body).toEqual({ email: { subject: "Renewal", body: "Please confirm the renewal." } });
  });

  it("document mode: a filter reordered by hand moves its slot; the problem lists match", async () => {
    const { user } = start(`/pipelines/${ID}`);
    await card("Model model_1");
    // Wait for the server's environment, so both lists are computed from the same facts.
    await within(screen.getByRole("region", { name: "Validation" })).findByText(/^PSP document resolved/);
    const visual = within(screen.getByRole("region", { name: "Validation" })).getAllByRole("listitem");
    const visualText = visual.map(li => li.textContent);
    await user.click(screen.getByRole("button", { name: "Document" }));
    const editor = await screen.findByRole("textbox", { name: "Pipeline configuration JSON" });
    expect((editor as HTMLTextAreaElement).value).toBe(formatConfig(example()));
    const reordered = (editor as HTMLTextAreaElement).value.replace(/"psp-verify",\n(\s+)"agents-registration",\n(\s+)"covenant-pruning"/, "\"covenant-pruning\",\n$1\"psp-verify\",\n$2\"agents-registration\"");
    fireEvent.change(editor, { target: { value: reordered } });
    expect(screen.getByRole("status", { name: "" }).textContent ?? "").toBeDefined();
    expect(screen.getByText("In sync with the canvas.")).toBeInTheDocument();
    const docProblems = within(screen.getByRole("region", { name: "Document problems" })).getAllByRole("listitem").map(li => li.textContent);
    expect(docProblems).toEqual(visualText);
    fireEvent.change(editor, { target: { value: reordered.slice(0, -5) } });
    expect(screen.getByText(/^Out of sync: Not valid JSON/)).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: reordered } });
    await user.click(screen.getByRole("button", { name: "Visual" }));
    const half = await card("LLMProxy request half llmproxy_1");
    expect(within(half).getAllByRole("listitem")[0]).toHaveAttribute("aria-label", "request filter slot 1: Covenant pruning");
  });

  it("a save from a stale tab gets 409 and offers to reload", async () => {
    const { server, user } = start(`/pipelines/${ID}`);
    await card("Model model_1");
    server.saveConflict = true;
    await typeInto(user, within(screen.getByRole("region", { name: "Pipeline" })).getByRole("textbox", { name: "Description" }), " (edited)");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/saved elsewhere[\s\S]*Reload the saved pipeline\?/)));
    await waitFor(() => expect(screen.queryByText("unsaved")).toBeNull());
    expect(within(screen.getByRole("region", { name: "Pipeline" })).getByRole("textbox", { name: "Description" })).toHaveValue("Intake review with CRM tools and exfiltration guards");
  });

  it("drift refused in a turn shows on the MCPProxy card; the properties dialog has no allowlist", async () => {
    const { server, user } = start(`/pipelines/${ID}`);
    server.turn = turn => ({ turn: 1, toolLoop: { turns: 1, calls: [{ proxyId: "mcpproxy_1", tool: "crm.lookup", drift: "refused", outcome: "DISCOVERY_CHANGED" }] }, reply: "", delivery: "withheld", error: { code: "TOOL_FAILED" } }) as never;
    await card("Model model_1");
    const dock = () => within(screen.getByRole("region", { name: "Initiator" }));
    await typeInto(user, dock().getByLabelText("Message to send through the pipeline"), "Look it up.");
    await user.click(dock().getByRole("button", { name: "Send through ring" }));
    expect(await within(await card("MCPProxy mcpproxy_1")).findByText("refused on drift")).toBeInTheDocument();
    expect(dock().getByText(/→ DISCOVERY_CHANGED/)).toBeInTheDocument();
    await user.dblClick(await card("MCPProxy mcpproxy_1"));
    const dialog = within(await screen.findByRole("dialog", { name: "MCPProxy · mcpproxy_1" }));
    expect(dialog.getAllByRole("tab").map(t => t.textContent)).toEqual(["Backend", "Drift", "Covenants"]);
    expect(dialog.queryByText(/allowlist/i, { selector: "label" })).toBeNull();
    expect(dialog.getByText("lookup")).toBeInTheDocument();
    await user.click(dialog.getByRole("tab", { name: "Covenants" }));
    expect(dialog.getByText(/This proxy has no allowlist/)).toBeInTheDocument();
  });
});
