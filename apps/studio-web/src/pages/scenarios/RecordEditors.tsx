// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { ECHO_SCHEMA, isIdentifier, type LiveLoopScenario, type ScenarioCollection, type ScriptedReply, type SyntheticTool } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Checkbox, Field, FormGrid, JsonInput, Select, TextArea, TextInput, TokenInput } from "../../components/fields";
import { EditorFrame, Loading, Notice, NotFound, Section, type Crumb } from "../../components/Page";
import { useStudio } from "../../data";
import { useDraft } from "../../lib/draft";
import { errorText, oneLine, truncate } from "../../lib/format";
import { deleteTool, deleteTurn, putTool, putTurn, replaceScenario, scriptFor, scriptReferences, toolName, toolUri } from "../../lib/scenarioOps";
import { href, Link, navigate } from "../../router";
import { opt } from "./ScenarioForms";

/** Resolves the collection and live-loop scenario a child record belongs to. */
function useParent(cid: string, sid: string): { loading: boolean; collection?: ScenarioCollection; scenario?: LiveLoopScenario; notLive: boolean } {
  const { collections, collectionsLoaded } = useStudio();
  const collection = collections.find(c => c.id === cid);
  const found = collection?.scenarios.find(s => s.id === sid);
  return { loading: !collectionsLoaded, ...(collection ? { collection } : {}), ...(found?.kind === "live-loop" ? { scenario: found } : {}), notLive: !!found && found.kind !== "live-loop" };
}
const scenarioHref = (cid: string, sid: string, tab: string) => `${href("collections", cid, "scenarios", sid)}?tab=${tab}`;
function parentCrumbs(collection: ScenarioCollection, scenario: LiveLoopScenario, tab: string, tabLabel: string): Crumb[] {
  return [
    { label: "Scenarios", to: "/scenarios" },
    { label: collection.label, to: href("collections", collection.id) },
    { label: scenario.label, to: href("collections", collection.id, "scenarios", scenario.id) },
    { label: tabLabel, to: scenarioHref(collection.id, scenario.id, tab) }
  ];
}

interface TurnDraft { message: string; requestId: string; replies: ScriptedReply[] }

export function TurnEditor({ cid, sid, turn }: { cid: string; sid: string; turn: number | null }) {
  const { saveCollection } = useStudio();
  const { loading, collection, scenario, notLive } = useParent(cid, sid);
  const isNew = turn === null;
  const index = scenario ? (isNew ? scenario.turns.length : turn - 1) : 0;
  const existing = scenario && !isNew ? scenario.turns[index] : undefined;
  const source = useMemo<TurnDraft | undefined>(() => {
    if (!scenario) return undefined;
    if (isNew) return { message: "", requestId: "", replies: [{ type: "final", text: "" }] };
    if (!existing) return undefined;
    return { message: existing.message, requestId: existing.requestId ?? "", replies: scriptFor(scenario, index) };
  }, [scenario, isNew, existing, index]);
  const { draft, dirty, update, markSaved, revert } = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidJson, setInvalidJson] = useState<Set<number>>(new Set());
  if (loading) return <Loading />;
  if (notLive) return <NotFound what="Turn" back={{ label: "scenario", to: href("collections", cid, "scenarios", sid) }} />;
  if (!collection || !scenario || !draft) return <NotFound what={isNew ? "Scenario" : `Turn ${turn}`} back={{ label: "scenarios", to: "/scenarios" }} />;

  const mock = scenario.provider.kind === "mock";
  const toolOptions = scenario.tools.map(t => ({ value: toolName(t), label: toolName(t) }));
  const number = index + 1;
  const validate = (): string | null => {
    if (!draft.message.trim()) return "The user message is required.";
    if (draft.requestId && !isIdentifier(draft.requestId)) return "Request id must be an identifier.";
    if (invalidJson.size) return "Fix the invalid JSON arguments before saving.";
    if (mock) {
      if (!draft.replies.length) return "A mock turn needs at least one scripted reply.";
      for (const r of draft.replies) if (r.type === "tool" && !toolOptions.some(o => o.value === r.name)) return `Reply calls unknown tool ${r.name || "(none)"}.`;
    }
    return null;
  };
  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      const next = putTurn(scenario, index, { message: draft.message, ...(draft.requestId ? { requestId: draft.requestId } : {}) }, mock ? draft.replies : undefined);
      await saveCollection(replaceScenario(collection, scenario.id, next));
      markSaved(draft);
      if (isNew) navigate(href("collections", cid, "scenarios", sid, "turns", number), { replace: true, force: true });
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  const setReply = (i: number, reply: ScriptedReply) => update(d => ({ ...d, replies: d.replies.map((r, j) => j === i ? reply : r) }));
  const moveReply = (i: number, delta: number) => update(d => {
    const replies = [...d.replies], j = i + delta;
    if (j < 0 || j >= replies.length) return d;
    [replies[i], replies[j]] = [replies[j]!, replies[i]!];
    return { ...d, replies };
  });
  const lastIsTool = draft.replies.length > 0 && draft.replies[draft.replies.length - 1]!.type === "tool";

  return (
    <EditorFrame crumbs={[...parentCrumbs(collection, scenario, "turns", "Turns"), { label: isNew ? "New turn" : `Turn ${number}` }]}
      title={isNew ? "New turn" : `Turn ${number}`} subtitle={`${scenario.label} · ${scenario.loop} loop · ${scenario.provider.kind} provider`}
      dirty={dirty} saving={saving} isNew={isNew} error={error} onSave={() => void save()} onRevert={revert}
      onDelete={scenario.turns.length > 1 ? async () => {
        try { await saveCollection(replaceScenario(collection, scenario.id, deleteTurn(scenario, index))); navigate(scenarioHref(cid, sid, "turns"), { force: true }); }
        catch (e) { setError(errorText(e)); }
      } : undefined}
      deletePrompt={`Delete turn ${number}${mock ? " and its scripted replies" : ""}? Later turns renumber.`}
      actions={!isNew && <>
        <button type="button" disabled={index === 0} onClick={() => navigate(href("collections", cid, "scenarios", sid, "turns", number - 1))}>‹ Previous turn</button>
        <button type="button" disabled={index >= scenario.turns.length - 1} onClick={() => navigate(href("collections", cid, "scenarios", sid, "turns", number + 1))}>Next turn ›</button>
      </>}>
      <Section title="User message">
        <FormGrid>
          <Field label="Message" wide hint="Sent as the user message for this turn. Durable loops see only the signed prompt and this message; committed state carries over separately.">
            <TextArea rows={5} value={draft.message} onChange={v => update(d => ({ ...d, message: v }))} />
          </Field>
          <Field label="Request id" hint={`Idempotency key for the durable store. Defaults to turn-${number}.`}><TextInput value={draft.requestId} placeholder={`turn-${number}`} onChange={v => update(d => ({ ...d, requestId: v }))} /></Field>
        </FormGrid>
      </Section>
      {mock ? (
        <Section title="Scripted replies" description="What the mock model returns at each step of this turn, in order. Tool calls go through the dispatch gate; the final reply ends the turn."
          actions={<>
            <button type="button" disabled={!toolOptions.length} title={toolOptions.length ? undefined : "Add a tool to the scenario first"} onClick={() => update(d => ({ ...d, replies: [...d.replies, { type: "tool", name: toolOptions[0]!.value, arguments: { message: "" } }] }))}>Add tool call</button>
            <button type="button" onClick={() => update(d => ({ ...d, replies: [...d.replies, { type: "final", text: "" }] }))}>Add final reply</button>
          </>}>
          {lastIsTool && <Notice kind="warn">The turn ends with a tool call. Add a final reply, or the mock provider fails with SCRIPT_EXHAUSTED.</Notice>}
          {draft.replies.length > scenario.limits.maxSteps && <Notice kind="warn">{draft.replies.length} replies exceed maxSteps ({scenario.limits.maxSteps}); the loop stops with STEP_LIMIT.</Notice>}
          <div className="grid"><div className="grid-scroll">
            <table className="inline-table" aria-label="Scripted replies">
              <thead><tr><th style={{ width: "48px" }}>Step</th><th style={{ width: "120px" }}>Type</th><th>Reply</th><th style={{ width: "220px" }} /></tr></thead>
              <tbody>
                {draft.replies.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td><Select ariaLabel={`Step ${i + 1} type`} value={r.type} options={[{ value: "tool", label: "Tool call" }, { value: "final", label: "Final" }]}
                      onChange={v => setReply(i, v === "final" ? { type: "final", text: "" } : { type: "tool", name: toolOptions[0]?.value ?? "", arguments: {} })} /></td>
                    <td>
                      {r.type === "final"
                        ? <textarea aria-label={`Step ${i + 1} text`} rows={2} value={r.text} onChange={e => setReply(i, { type: "final", text: e.target.value })} />
                        : <div className="stack">
                            <Select ariaLabel={`Step ${i + 1} tool`} value={r.name} options={toolOptions.some(o => o.value === r.name) ? toolOptions : [{ value: r.name, label: `${r.name} (unknown)` }, ...toolOptions]} onChange={v => setReply(i, { ...r, name: v })} />
                            <JsonInput ariaLabel={`Step ${i + 1} arguments`} value={r.arguments} rows={3}
                              onValidity={valid => setInvalidJson(set => { const next = new Set(set); if (valid) next.delete(i); else next.add(i); return next; })}
                              onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) setReply(i, { ...r, arguments: v as Record<string, unknown> }); }} />
                          </div>}
                    </td>
                    <td className="row-actions">
                      <button type="button" disabled={i === 0} onClick={() => moveReply(i, -1)} aria-label={`Move step ${i + 1} up`}>↑</button>
                      <button type="button" disabled={i === draft.replies.length - 1} onClick={() => moveReply(i, 1)} aria-label={`Move step ${i + 1} down`}>↓</button>
                      <button type="button" className="danger" onClick={() => update(d => ({ ...d, replies: d.replies.filter((_, j) => j !== i) }))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </Section>
      ) : <Notice kind="info">The {scenario.provider.kind} provider generates replies live; there is no script for this turn.</Notice>}
    </EditorFrame>
  );
}

interface ToolDraft { tool: SyntheticTool; atNode: boolean }
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function ToolEditor({ cid, sid, tool }: { cid: string; sid: string; tool: string | null }) {
  const { saveCollection } = useStudio();
  const { loading, collection, scenario, notLive } = useParent(cid, sid);
  const isNew = tool === null;
  const existing = scenario && tool !== null ? scenario.tools.find(t => toolName(t) === tool) : undefined;
  const source = useMemo<ToolDraft | undefined>(() => {
    if (!scenario) return undefined;
    if (isNew) {
      const taken = new Set(scenario.tools.map(toolName));
      let i = 1; while (taken.has(`tool${i}.read`)) i++;
      return { tool: { server: `tool${i}`, name: "read", revision: "tool-1", inputSchema: structuredClone(ECHO_SCHEMA), outputSchema: structuredClone(ECHO_SCHEMA), capabilities: [], response: { kind: "echo" } }, atNode: true };
    }
    return existing ? { tool: structuredClone(existing), atNode: scenario.node.agents.includes(toolUri(existing)) } : undefined;
  }, [scenario, isNew, existing]);
  const { draft, dirty, update, markSaved, revert } = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  if (loading) return <Loading />;
  if (notLive) return <NotFound what="Tool" back={{ label: "scenario", to: href("collections", cid, "scenarios", sid) }} />;
  if (!collection || !scenario || !draft) return <NotFound what={isNew ? "Scenario" : `Tool ${tool}`} back={{ label: "scenarios", to: "/scenarios" }} />;

  const t = draft.tool;
  const setTool = (next: SyntheticTool) => update(d => ({ ...d, tool: next }));
  const validity = (key: string) => (valid: boolean) => setInvalid(set => { const next = new Set(set); if (valid) next.delete(key); else next.add(key); return next; });
  const references = tool === null ? [] : scenario.turns.flatMap((_, i) => scriptFor(scenario, i).some(r => r.type === "tool" && r.name === tool) ? [i + 1] : []);
  const validate = (): string | null => {
    if (!NAME.test(t.server) || !NAME.test(t.name)) return "Server and name must be 1 to 64 letters, digits, dash or underscore.";
    if (t.revision !== undefined && !isIdentifier(t.revision)) return "Revision must be an identifier.";
    if (scenario.tools.some(x => toolName(x) === toolName(t) && toolName(x) !== tool)) return `Another tool is already named ${toolName(t)}.`;
    if (invalid.size) return "Fix the invalid JSON before saving.";
    if (t.inputSchema.type !== "object" || t.outputSchema.type !== "object") return "Input and output schemas must have type \"object\".";
    return null;
  };
  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      await saveCollection(replaceScenario(collection, scenario.id, putTool(scenario, tool, t, draft.atNode)));
      markSaved(draft);
      if (toolName(t) !== tool) navigate(href("collections", cid, "scenarios", sid, "tools", toolName(t)), { replace: true, force: true });
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };

  return (
    <EditorFrame crumbs={[...parentCrumbs(collection, scenario, "tools", "Tools"), { label: isNew ? "New tool" : toolName(existing ?? t) }]}
      title={<code>{toolName(t)}</code>} subtitle={`${toolUri(t)} · ${scenario.label}`}
      dirty={dirty} saving={saving} isNew={isNew} error={error} onSave={() => void save()} onRevert={revert}
      onDelete={async () => {
        try { await saveCollection(replaceScenario(collection, scenario.id, deleteTool(scenario, tool!))); navigate(scenarioHref(cid, sid, "tools"), { force: true }); }
        catch (e) { setError(errorText(e)); }
      }}
      deletePrompt={`Delete ${tool}?${references.length ? ` Turns ${references.join(", ")} still call it.` : ""}`}>
      <Section title="Identity">
        <FormGrid>
          <Field label="Server" hint="The model calls the tool as server.name."><TextInput value={t.server} onChange={v => setTool({ ...t, server: v })} /></Field>
          <Field label="Name"><TextInput value={t.name} onChange={v => setTool({ ...t, name: v })} /></Field>
          <Field label="Revision" hint="Bound into dispatch provenance."><TextInput value={t.revision ?? ""} onChange={v => setTool(opt(t, "revision", v))} /></Field>
          <Field label="Capabilities" hint="CDL capabilities of the tool's server, aggregated into the dispatch decision. For example logs-operations."><TokenInput value={t.capabilities ?? []} onChange={v => setTool(opt(t, "capabilities", v.length ? v : undefined))} /></Field>
          <Field label="Starting node" hint={!isNew && tool !== toolName(t) ? "Renaming updates the node's agent list and the scripted replies that call it." : "Lists the tool's mcp:// URI in the starting node's agents."}>
            <Checkbox checked={draft.atNode} label="Available at the starting node" onChange={v => update(d => ({ ...d, atNode: v }))} />
          </Field>
        </FormGrid>
      </Section>
      <Section title="Response" description="What the synthetic tool returns. Output must satisfy the output schema or the gate answers INVALID_OUTPUT.">
        <FormGrid>
          <Field label="Behavior">
            <Select value={t.response.kind} options={[{ value: "echo", label: "Echo the arguments" }, { value: "static", label: "Return fixed data" }, { value: "fail", label: "Fail (TOOL_FAILED)" }]}
              onChange={v => setTool({ ...t, response: v === "static" ? { kind: "static", data: { message: "synthetic" } } : { kind: v } })} />
          </Field>
          {t.response.kind === "static" && (
            <Field label="Data" wide><JsonInput value={t.response.data} rows={6} onValidity={validity("data")} onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) setTool({ ...t, response: { kind: "static", data: v as Record<string, unknown> } }); }} /></Field>
          )}
        </FormGrid>
      </Section>
      <Section title="Schemas" description="The dispatch gate accepts a bounded JSON Schema subset; prepare reports UNSUPPORTED_SCHEMA for anything else.">
        <FormGrid>
          <Field label="Input schema" wide><JsonInput value={t.inputSchema} rows={10} onValidity={validity("input")} onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) setTool({ ...t, inputSchema: v as Record<string, unknown> }); }} /></Field>
          <Field label="Output schema" wide><JsonInput value={t.outputSchema} rows={10} onValidity={validity("output")} onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) setTool({ ...t, outputSchema: v as Record<string, unknown> }); }} /></Field>
        </FormGrid>
      </Section>
      {!isNew && (
        <Section title="Called by" description="Scripted turns whose replies call this tool.">
          {references.length ? <ul>{references.map(n => <li key={n}><Link to={href("collections", cid, "scenarios", sid, "turns", n)}>Turn {n}</Link>: {truncate(oneLine(scenario.turns[n - 1]!.message), 100)}</li>)}</ul>
            : <p className="muted">{scenario.provider.kind === "mock" ? "No scripted reply calls this tool." : "The provider is live; calls depend on the model."}</p>}
          {scriptReferences(scenario, toolName(t)) === 0 && tool !== toolName(t) && <p className="muted">Renamed; references move on save.</p>}
        </Section>
      )}
    </EditorFrame>
  );
}

/** A compact grid of scenarios, reused where a record links back to the scenarios that use it. */
export function ScenarioLinksGrid({ id, rows }: { id: string; rows: { collection: ScenarioCollection; scenarioId: string; label: string }[] }) {
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "label", header: "Scenario", value: r => r.label },
    { key: "collection", header: "Collection", width: "200px", value: r => r.collection.label }
  ];
  return <DataGrid id={id} label="Scenarios using this record" rows={rows} columns={columns} rowKey={r => `${r.collection.id}/${r.scenarioId}`}
    onOpen={r => navigate(href("collections", r.collection.id, "scenarios", r.scenarioId))} emptyMessage="No scenario uses this file." />;
}
