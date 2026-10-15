// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { resetRunStreams } from "../src/lib/runEvents";
import { fakeSocket, JOURNAL, mockServer, RUN } from "./harness";

vi.mock("../src/lib/socket", async () => { const harness = await import("./harness"); return { studioSocket: () => harness.fakeSocket }; });

function start(path: string) {
  window.history.replaceState(null, "", path);
  const server = mockServer();
  fakeSocket.journals.set(RUN.runId, JOURNAL);
  fakeSocket.records.set(RUN.runId, RUN);
  const user = userEvent.setup();
  render(<App />);
  return { server, user };
}
const grid = (name: string) => screen.findByRole("grid", { name });
const bodyRows = (el: HTMLElement) => within(el).getAllByRole("row").slice(1);
const puts = (server: ReturnType<typeof mockServer>, prefix: string) => server.calls.filter(c => c.method === "PUT" && c.url.startsWith(prefix));

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); fakeSocket.reset(); resetRunStreams(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("shell", () => {
  it("toggles the left navigation from the hamburger and remembers the choice", async () => {
    const { user } = start("/runs");
    const toggle = screen.getByRole("button", { name: "Close navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Runs" })).toHaveAttribute("aria-current", "page");
    await user.click(toggle);
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("psp-studio:nav-open")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Scenarios" }));
    expect(window.location.pathname).toBe("/scenarios");
    expect(await grid("Scenarios")).toBeInTheDocument();
  });
  it("redirects the root to runs and keeps retrying an unreachable server", async () => {
    window.history.replaceState(null, "", "/");
    const server = mockServer(); server.failStatus = true;
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("fetch failed (retrying)");
    expect(window.location.pathname).toBe("/runs");
  });
});

describe("runs", () => {
  it("drills from the runs grid to a run, its events grid, one event, and its turn", async () => {
    const { user } = start("/runs");
    const runs = await grid("Runs");
    await waitFor(() => expect(bodyRows(runs)).toHaveLength(1));
    await user.dblClick(bodyRows(runs)[0]!);
    expect(window.location.pathname).toBe(`/runs/${RUN.runId}`);
    expect(await screen.findByRole("heading", { name: RUN.label })).toBeInTheDocument();
    await user.click(await screen.findByRole("tab", { name: "Events (6)" }));
    const events = await grid("Events");
    expect(bodyRows(events)).toHaveLength(6);
    await user.selectOptions(screen.getByLabelText("Source filter"), "mcpproxy");
    expect(bodyRows(events)).toHaveLength(1);
    await user.dblClick(bodyRows(events)[0]!);
    expect(window.location.pathname).toBe(`/runs/${RUN.runId}/events/4`);
    expect(await screen.findByRole("heading", { name: /dispatch\.released/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next ›" }));
    expect(window.location.pathname).toBe(`/runs/${RUN.runId}/events/5`);
    await user.click(screen.getByRole("link", { name: "Turn 1" }));
    expect(window.location.pathname).toBe(`/runs/${RUN.runId}/turns/1`);
    expect(await screen.findByText("Reviewed the record.")).toBeInTheDocument();
    expect(bodyRows(await grid("Events"))).toHaveLength(4);
  });
  it("prepares a run and starts it only with the repeated admission digest", async () => {
    const { server, user } = start("/runs/new?collection=starter&scenario=durable-echo");
    await user.click(await screen.findByRole("button", { name: "Prepare" }));
    expect(await screen.findByText("No signing key is stored in the vault.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("admission digest"), "abc123");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(window.location.pathname).toBe("/runs/r9"));
    expect(server.calls.find(c => c.url === "/api/runs" && c.method === "POST")?.body).toEqual({ collectionId: "starter", scenarioId: "durable-echo", admissionDigest: "abc123" });
  });
});

describe("scenarios", () => {
  it("opens a scenario from the grid, edits it, saves the collection, and guards unsaved changes", async () => {
    const { server, user } = start("/scenarios");
    const scenarios = await grid("Scenarios");
    await waitFor(() => expect(bodyRows(scenarios)).toHaveLength(3));
    await user.dblClick(within(scenarios).getByRole("row", { name: /Durable loop with a synthetic read tool/ }));
    expect(window.location.pathname).toBe("/collections/starter/scenarios/durable-echo");
    const label = await screen.findByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Renamed durable loop");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Runs" }));
    expect(confirm).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/collections/starter/scenarios/durable-echo");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("unsaved")).toBeNull());
    const saved = puts(server, "/api/collections/starter").at(-1)!.body;
    expect(saved.scenarios[0].label).toBe("Renamed durable loop");
    expect(saved.scenarios).toHaveLength(3);
  });
  it("drills from the turns grid to a turn editor and saves its message and replies", async () => {
    const { server, user } = start("/collections/starter/scenarios/durable-echo?tab=turns");
    const turns = await grid("Scenario turns");
    expect(bodyRows(turns)).toHaveLength(3);
    await user.click(bodyRows(turns)[1]!);
    await user.click(within(turns.closest(".grid") as HTMLElement).getByRole("button", { name: "Open" }));
    expect(window.location.pathname).toBe("/collections/starter/scenarios/durable-echo/turns/2");
    const message = await screen.findByLabelText("Message");
    expect(message).toHaveValue("I am not sure the amount is right.");
    expect(bodyRows(screen.getByRole("table", { name: "Scripted replies" }))).toHaveLength(1);
    await user.clear(message);
    await user.type(message, "Is the amount right?");
    await user.click(screen.getByRole("button", { name: "Add final reply" }));
    await user.type(screen.getByLabelText("Step 2 text"), "Yes.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts(server, "/api/collections/starter")).toHaveLength(1));
    const scenario = puts(server, "/api/collections/starter")[0]!.body.scenarios[0];
    expect(scenario.turns[1].message).toBe("Is the amount right?");
    expect(scenario.provider.script[1]).toEqual([{ type: "final", text: "Offered clarification and recorded the answer." }, { type: "final", text: "Yes." }]);
  });
  it("creates a collection from the collections grid and lands on its editor route", async () => {
    const { server, user } = start("/collections");
    await grid("Collections");
    await user.click(screen.getByRole("button", { name: "New collection" }));
    expect(window.location.pathname).toBe("/collections/new");
    await user.click(await screen.findByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.pathname).toBe("/collections/collection-1"));
    expect(puts(server, "/api/collections/collection-1")).toHaveLength(1);
  });
});

describe("workspace and secrets", () => {
  it("opens a workspace file from its grid and lists the scenarios that use it", async () => {
    const { user } = start("/workspace");
    const files = await grid("Workspace files");
    await waitFor(() => expect(bodyRows(files)).toHaveLength(2));
    await user.dblClick(within(files).getByRole("row", { name: /application\.psp/ }));
    expect(window.location.pathname).toBe("/workspace/files/application.psp");
    expect(await screen.findByLabelText("Text")).toHaveValue("${psp type=node node-type=application name=\"support\"}${/psp}");
    expect(bodyRows(await grid("Scenarios using this record"))).toHaveLength(3);
  });
  it("opens a secret from its grid and stores a value without showing it again", async () => {
    const { server, user } = start("/secrets");
    const secrets = await grid("Secrets");
    await waitFor(() => expect(bodyRows(secrets)).toHaveLength(3));
    await user.dblClick(within(secrets).getByRole("row", { name: /openai\.apiKey/ }));
    expect(window.location.pathname).toBe("/secrets/openai.apiKey");
    await user.type(await screen.findByLabelText("Value"), "sk-synthetic-1234");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("openai.apiKey saved.")).toBeInTheDocument();
    expect(server.calls.find(c => c.method === "PUT" && c.url === "/api/secrets/openai.apiKey")?.body).toEqual({ value: "sk-synthetic-1234" });
    expect(screen.getByLabelText("Value")).toHaveValue("");
  });
});
