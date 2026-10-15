// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { resetRunStreams } from "../src/lib/runEvents";
import { mockReactFlow } from "./flow-mocks";
import { fakeSocket, mockServer, SUPPORT_APP } from "./harness";

vi.mock("../src/lib/socket", async () => { const harness = await import("./harness"); return { studioSocket: () => harness.fakeSocket }; });

beforeAll(mockReactFlow);
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); fakeSocket.reset(); resetRunStreams(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function start(path: string, files: Record<string, string> = {}) {
  window.history.replaceState(null, "", path);
  const server = mockServer();
  Object.assign(server.files, { "support.psp": SUPPORT_APP }, files);
  const user = userEvent.setup();
  render(<App />);
  return { server, user };
}
const query = () => new URLSearchParams(window.location.search);
// The editor chunk loads lazily, which can take longer than the default wait on a cold start.
const card = (label: string) => screen.findByLabelText(label, { selector: ".psp-node" }, { timeout: 5000 });
const outlineItem = (name: string) => within(screen.getByRole("region", { name: "Outline" })).getByRole("button", { name });
const inspector = () => within(screen.getByRole("complementary", { name: "Properties" }));
const putFor = (server: ReturnType<typeof mockServer>, path: string) => server.calls.filter(c => c.method === "PUT" && c.url === `/api/workspace/files/${path}`);

describe("PSP editor", () => {
  it("opens a PSP file from its grid as a diagram with the palette, outline and properties", async () => {
    const { user } = start("/psp");
    const grid = await screen.findByRole("grid", { name: "PSP applications" });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(3));
    await user.dblClick(within(grid).getByRole("row", { name: /support\.psp/ }));
    expect(window.location.pathname).toBe("/psp/files/support.psp");
    expect(await card("Prompt node review")).toBeInTheDocument();
    expect(screen.getByLabelText("Composite node help", { selector: ".psp-node" })).toHaveTextContent("Open (1) ›");
    expect(screen.getByRole("button", { name: /^Transition review to help: if the customer seems uncertain/ })).toHaveTextContent("p10");
    expect(within(screen.getByRole("region", { name: "Node types" })).getAllByRole("button").map(b => b.textContent))
      .toEqual(["Prompt", "Decision", "Composite", "Connector", "Checkpoint", "Loop", "Reset", "Application"]);
    expect(within(screen.getByRole("navigation", { name: "Scope" })).getByText("support")).toHaveAttribute("aria-current", "page");
    // Nothing selected: the inspector shows the application that contains the diagram.
    expect(inspector().getByRole("heading", { name: "support" })).toBeInTheDocument();
    expect(inspector().getAllByRole("tab").map(t => t.textContent)).toEqual(["Application", "Instructions", "Children", "Completion", "Machine", "Threat policy", "Affinity", "Routing", "Output", "Source"]);
  });

  it("edits a node on its tabs and saves the PSP text", async () => {
    const { server, user } = start("/psp/files/support.psp");
    await card("Prompt node review");
    await user.click(outlineItem("survey"));
    expect(query().get("sel")).toBe("n:survey");
    expect(inspector().getByRole("heading", { name: "survey" })).toBeInTheDocument();
    expect(inspector().getAllByRole("tab").map(t => t.textContent)).toEqual(["General", "Instructions", "Output", "Affinity", "Routing", "Source"]);
    await user.click(inspector().getByRole("tab", { name: "Instructions" }));
    expect(query().get("tab")).toBe("instructions");
    const instructions = inspector().getByLabelText("System instructions");
    await user.clear(instructions);
    await user.type(instructions, "Ask for feedback in one question.");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    await user.click(inspector().getByRole("checkbox", { name: "interval" }));
    await user.type(inspector().getByLabelText("Refresh interval"), "5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("unsaved")).toBeNull());
    const saved = putFor(server, "support.psp");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.body.text).toContain('${psp type=system version="v1.0.0" refresh-policy="interval" refresh-interval="5"}Ask for feedback in one question.${/psp}');
    expect(saved[0]!.body.text).toContain('{"source_node":"review","target_node":"help","condition":"if the customer seems uncertain, offer clarification","priority":10}');
    // Layout was never touched, so no sidecar is written.
    expect(putFor(server, ".studio/layouts/support.psp.json")).toHaveLength(0);
  });

  it("adds a node from the palette, routes it with a transition and edits the condition", async () => {
    const { server, user } = start("/psp/files/support.psp");
    await card("Prompt node review");
    await user.click(screen.getByRole("button", { name: "Add Checkpoint node" }));
    expect(await card("Checkpoint node checkpoint_1")).toBeInTheDocument();
    expect(query().get("sel")).toBe("n:checkpoint_1");
    await user.click(inspector().getByRole("tab", { name: "Checkpoint" }));
    await user.type(inspector().getByLabelText("Notify to"), "approver@example.test");
    await user.click(inspector().getByRole("tab", { name: "Routing" }));
    await user.selectOptions(inspector().getByLabelText("New transition target"), "survey");
    await user.click(inspector().getByRole("button", { name: "Add transition" }));
    expect(query().get("sel")).toMatch(/^e:/);
    expect(inspector().getByRole("heading", { name: "checkpoint_1 → survey" })).toBeInTheDocument();
    await user.type(inspector().getByLabelText("Condition"), "approved == true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putFor(server, "support.psp")).toHaveLength(1));
    const text = putFor(server, "support.psp")[0]!.body.text as string;
    expect(text).toContain('{"source_node":"checkpoint_1","target_node":"survey","condition":"approved == true"}');
    expect(text).toContain('"notification":{"to":"approver@example.test"}');
    expect(text.indexOf('id="checkpoint_1"')).toBeLessThan(text.indexOf("type=transitions"));
    const layout = JSON.parse(putFor(server, ".studio/layouts/support.psp.json")[0]!.body.text);
    expect(layout.profile).toBe("PSP-STUDIO-LAYOUT-0.1");
    expect(Object.keys(layout.scopes.support).sort()).toEqual(["checkpoint_1", "help", "review", "survey"]);
  });

  it("selects a transition from its label, reorders it and keeps renames consistent", async () => {
    const { server, user } = start("/psp/files/support.psp");
    await card("Prompt node review");
    await user.click(screen.getByRole("button", { name: /^Transition review to survey: if the customer seems satisfied/ }));
    expect(inspector().getByLabelText("Condition")).toHaveValue("if the customer seems satisfied, route to survey");
    expect(inspector().getByText("3 of 3 from review")).toBeInTheDocument();
    await user.click(inspector().getByRole("button", { name: "Earlier" }));
    expect(inspector().getByText("2 of 3 from review")).toBeInTheDocument();
    await user.click(outlineItem("survey"));
    const id = inspector().getByLabelText("Id");
    await user.clear(id);
    expect(inspector().getByText("Id is required.")).toBeInTheDocument();
    await user.type(id, "feedback");
    expect(query().get("sel")).toBe("n:feedback");
    expect(await card("Prompt node feedback")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putFor(server, "support.psp")).toHaveLength(1));
    const text = putFor(server, "support.psp")[0]!.body.text as string;
    expect(text).not.toContain('"survey"');
    expect(text.indexOf("route to survey")).toBeLessThan(text.indexOf('"condition":"approved == true"'));
    expect(text.match(/"target_node":"feedback"/g)).toHaveLength(2);
  });

  it("drills into a composite and back, deletes a node and undoes it", async () => {
    const { user } = start("/psp/files/support.psp");
    await card("Prompt node review");
    await user.click(within(screen.getByLabelText("Composite node help", { selector: ".psp-node" })).getByRole("button", { name: "Open (1) ›" }));
    expect(query().get("scope")).toBe("support/help");
    expect(await card("Prompt node clarify")).toBeInTheDocument();
    expect(inspector().getByRole("heading", { name: "help" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("navigation", { name: "Scope" })).getByRole("button", { name: "support" }));
    expect(await card("Prompt node survey")).toBeInTheDocument();
    await user.click(outlineItem("survey"));
    await user.click(inspector().getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByLabelText("Prompt node survey", { selector: ".psp-node" })).toBeNull());
    expect(screen.queryByRole("button", { name: /^Transition review to survey/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await card("Prompt node survey")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Transition review to survey/ })).toHaveLength(2);
    expect(screen.queryByText("unsaved")).toBeNull();
  });

  it("shows a dangling target as a missing node that can be created", async () => {
    const broken = '${psp type=node node-type=application name="a" session-id="s" version="1"}\n  ${psp type=node node-type=prompt id="x" version="1"}\n    ${psp type=transitions}[{"target_node":"later"}]${/psp}\n  ${/psp}\n${/psp}\n';
    const { user } = start("/psp/files/broken.psp", { "broken.psp": broken });
    const ghost = await card("Missing node later");
    const checks = () => within(screen.getByRole("region", { name: "Checks" }));
    await user.click(checks().getByRole("button", { name: "x → later: no node later in a." }));
    expect(query().get("sel")).toMatch(/^e:/);
    expect(inspector().getByRole("heading", { name: "x → later" })).toBeInTheDocument();
    // A plain click: d3-drag reads event.view on mousedown, which user-event leaves null under jsdom.
    fireEvent.click(ghost);
    expect(query().get("sel")).toBe("m:later");
    await user.click(await inspector().findByRole("button", { name: "Create prompt node later" }));
    expect(await card("Prompt node later")).toBeInTheDocument();
    expect(checks().queryByRole("button", { name: /no node later/ })).toBeNull();
  });

  it("falls back to the source view when the markup does not parse", async () => {
    const { user } = start("/psp/files/support.psp?view=source");
    const source = await screen.findByLabelText("PSP source");
    await user.type(source, "${{/psp}");
    expect(await screen.findByText(/The markup does not parse: UNEXPECTED_CLOSE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diagram" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Diagram" }));
    expect(await card("Prompt node review")).toBeInTheDocument();
  });

  it("creates a new application file and opens it in the editor", async () => {
    const { server, user } = start("/psp/new");
    const name = await screen.findByLabelText("Application name");
    await user.clear(name);
    await user.type(name, "intake");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.pathname).toBe("/psp/files/new-application.psp"));
    expect(putFor(server, "new-application.psp")[0]!.body.text).toContain('${psp type=node node-type=application name="intake"');
    expect(await card("Prompt node start")).toBeInTheDocument();
  });
});
