// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultLiveLoopScenario, type LiveLoopScenario } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../src/components/DataGrid";
import { matchPath, navigate, useLeaveGuard } from "../src/router";
import { applyLoop, deleteTool, deleteTurn, moveTurn, putTool, putTurn, scenarioChecks, scriptFor, toolUri } from "../src/lib/scenarioOps";

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); window.history.replaceState(null, "", "/"); });
afterEach(() => vi.restoreAllMocks());

describe("router", () => {
  it("matches literal, parameter and rest segments with decoding", () => {
    expect(matchPath("/runs/:id", "/runs/abc")).toEqual({ id: "abc" });
    expect(matchPath("/runs/:id", "/runs/abc/events")).toBeNull();
    expect(matchPath("/runs/new", "/runs/abc")).toBeNull();
    expect(matchPath("/workspace/files/*path", "/workspace/files/dir/my%20file.psp")).toEqual({ path: "dir/my file.psp" });
    expect(matchPath("/workspace/files/*path", "/workspace/files")).toBeNull();
    expect(matchPath("/", "/")).toEqual({});
  });
  it("pushes history, and a leave guard can refuse unless forced", () => {
    function Guarded() { useLeaveGuard(true); return null; }
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = render(<Guarded />);
    expect(navigate("/runs")).toBe(false);
    expect(window.location.pathname).toBe("/");
    expect(confirm).toHaveBeenCalledOnce();
    expect(navigate("/runs", { force: true })).toBe(true);
    expect(window.location.pathname).toBe("/runs");
    unmount();
    expect(navigate("/scenarios")).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
});

interface Row { id: string; name: string; size: number }
const rows: Row[] = [{ id: "a", name: "gamma", size: 3 }, { id: "b", name: "alpha", size: 10 }, { id: "c", name: "beta", size: 2 }];
const columns: Column<Row>[] = [{ key: "name", header: "Name", value: r => r.name }, { key: "size", header: "Size", value: r => r.size, align: "right" }];
const bodyRows = () => within(screen.getByRole("grid", { name: "Things" })).getAllByRole("row").slice(1);
const names = () => bodyRows().map(r => within(r).getAllByRole("cell")[0]!.textContent);

describe("DataGrid", () => {
  it("sorts by header, filters across columns, and counts", async () => {
    const user = userEvent.setup();
    render(<DataGrid id="t" label="Things" rows={rows} columns={columns} rowKey={r => r.id} />);
    expect(names()).toEqual(["gamma", "alpha", "beta"]);
    await user.click(screen.getByRole("button", { name: /Size/ }));
    expect(names()).toEqual(["beta", "gamma", "alpha"]);
    expect(screen.getByRole("columnheader", { name: /Size/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: /Size/ }));
    expect(names()).toEqual(["alpha", "gamma", "beta"]);
    await user.type(screen.getByLabelText("Filter Things"), "ta");
    expect(names()).toEqual(["beta"]);
    expect(screen.getByText("1 of 3 rows")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Filter Things"));
    await user.type(screen.getByLabelText("Filter Things"), "zzz");
    expect(screen.getByText("No rows match the filter.")).toBeInTheDocument();
  });
  it("selects on click, opens on double-click, Enter and the Open button, and moves with arrows", async () => {
    const user = userEvent.setup(), onOpen = vi.fn();
    render(<DataGrid id="t2" label="Things" rows={rows} columns={columns} rowKey={r => r.id} onOpen={onOpen}
      actions={sel => <span data-testid="sel">{sel?.name ?? "none"}</span>} />);
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    await user.click(bodyRows()[1]!);
    expect(bodyRows()[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("sel")).toHaveTextContent("alpha");
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenLastCalledWith(rows[1]);
    await user.dblClick(bodyRows()[2]!);
    expect(onOpen).toHaveBeenLastCalledWith(rows[2]);
    screen.getByRole("grid", { name: "Things" }).focus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByTestId("sel")).toHaveTextContent("gamma");
    await user.keyboard("{End}{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith(rows[2]);
  });
  it("pages large row sets and remembers state per grid id", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 25 }, (_, i) => ({ id: String(i), name: `row ${String(i).padStart(2, "0")}`, size: i }));
    const { unmount } = render(<DataGrid id="paged" label="Things" rows={many} columns={columns} rowKey={r => r.id} pageSize={10} />);
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(names()[0]).toBe("row 10");
    await user.click(bodyRows()[3]!);
    unmount();
    render(<DataGrid id="paged" label="Things" rows={many} columns={columns} rowKey={r => r.id} pageSize={10} />);
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(bodyRows()[3]).toHaveAttribute("aria-selected", "true");
  });
});

describe("scenario operations", () => {
  const base = (): LiveLoopScenario => ({
    ...defaultLiveLoopScenario("s"),
    plan: { statePolicy: "accumulate", completeOnTurn: 3 },
    policy: { default: { classes: [], covenants: [], capabilities: [] }, overrides: [{ phase: "inference", turn: 2, resource: { classes: [], covenants: [], capabilities: ["x"] } }, { phase: "release", turn: 3, resource: { classes: [], covenants: [], capabilities: [] } }] }
  });
  it("deleting a turn drops its replies and renumbers completion and overrides", () => {
    const s = deleteTurn(base(), 1);
    expect(s.turns.map(t => t.message)).toEqual(["Please review my situation.", "That makes sense, thank you."]);
    expect(scriptFor(s, 1).at(-1)).toEqual({ type: "final", text: "Collected feedback. Review complete." });
    expect(s.plan.completeOnTurn).toBe(2);
    expect(s.policy.overrides).toEqual([{ phase: "release", turn: 2, resource: { classes: [], covenants: [], capabilities: [] } }]);
    const first = deleteTurn(base(), 2);
    expect(first.plan.completeOnTurn).toBeNull();
  });
  it("moving a turn carries its replies, completion and overrides", () => {
    const s = moveTurn(base(), 2, -1);
    expect(s.turns[1]!.message).toBe("That makes sense, thank you.");
    expect(scriptFor(s, 1)[0]).toEqual({ type: "tool", name: "echo.read", arguments: { message: "feedback form" } });
    expect(s.plan.completeOnTurn).toBe(2);
    expect(s.policy.overrides!.map(o => o.turn)).toEqual([3, 2]);
    expect(moveTurn(base(), 0, -1)).toEqual(base());
  });
  it("putTurn appends with replies; renaming a tool updates agents and scripts; deleting removes its agent", () => {
    const appended = putTurn(base(), 3, { message: "Four" }, [{ type: "final", text: "4" }]);
    expect(appended.turns).toHaveLength(4);
    expect(scriptFor(appended, 3)).toEqual([{ type: "final", text: "4" }]);
    const tool = base().tools[0]!;
    const renamed = putTool(base(), "echo.read", { ...tool, server: "files" }, true);
    expect(renamed.node.agents).toEqual(["mcp://files/read"]);
    expect(scriptFor(renamed, 0)[0]).toMatchObject({ type: "tool", name: "files.read" });
    const removed = deleteTool(renamed, "files.read");
    expect(removed.tools).toHaveLength(0);
    expect(removed.node.agents).toEqual([]);
    expect(putTool(base(), null, { ...tool, server: "extra" }, false).node.agents).toEqual([toolUri(tool)]);
  });
  it("applyLoop keeps only settings the loop understands, and checks flag broken scripts", () => {
    const refreshing = applyLoop(base(), "refreshing");
    expect(refreshing.refresh).toEqual({ policy: "interval", interval: 2, ttl: 600 });
    const durable = applyLoop(refreshing, "durable");
    expect("refresh" in durable).toBe(false);
    const context = applyLoop({ ...base(), interpreter: "none" }, "context");
    expect(context.limits.maxRounds).toBe(4);
    expect(context.interpreter).toBe("psp-core-3.2-draft-0.1");
    expect(applyLoop(context, "buffered").limits.maxRounds).toBeUndefined();
    const broken = putTurn(base(), 0, { message: "x" }, [{ type: "tool", name: "echo.read", arguments: {} }]);
    expect(scenarioChecks(broken)).toContain("Turn 1 ends with a tool call; add a final reply.");
    expect(scenarioChecks({ ...base(), node: { ...base().node, agents: [] } }).some(c => c.includes("TOOL_NOT_ALLOWED"))).toBe(true);
  });
});
