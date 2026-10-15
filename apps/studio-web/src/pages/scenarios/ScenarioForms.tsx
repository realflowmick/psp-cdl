// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { CampaignScenario, HeldoutScenario, JointScenario, LiveLoopScenario, PolicyOverride, PolicyResource, StudyScenario, SyntheticTool } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Checkbox, Field, FormGrid, JsonInput, NumberInput, Select, TextArea, TextInput, TokenInput } from "../../components/fields";
import { Notice, Section } from "../../components/Page";
import type { Templates, WorkspaceFile } from "../../lib/api";
import { oneLine, truncate } from "../../lib/format";
import { deleteTool, deleteTurn, moveTurn, scriptFor, scriptReferences, toolName, toolUri } from "../../lib/scenarioOps";
import { Link } from "../../router";

type Change<T> = (next: T) => void;
const INLINE_TEMPLATE = "${psp type=node node-type=application name=\"inline\" version=\"v1.0.0\"}\n  ${psp type=node node-type=prompt id=\"start\" version=\"v1.0.0\"}\n    ${psp type=system version=\"v1.0.0\"}Describe the task.${/psp}\n  ${/psp}\n${/psp}\n";

/** Removes optional keys whose value is blank, so the schema's `additionalProperties` and minimums hold. */
export function opt<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined || value === "") delete next[key]; else next[key] = value;
  return next;
}
export const fileHref = (path: string): string => "/workspace/files/" + path.split("/").map(encodeURIComponent).join("/");
export const pspHref = (path: string): string => "/psp/files/" + path.split("/").map(encodeURIComponent).join("/");

export function ApplicationTab({ s, files, onChange }: { s: LiveLoopScenario; files: WorkspaceFile[]; onChange: Change<LiveLoopScenario> }) {
  const pspFiles = files.map(f => f.path).filter(p => p.endsWith(".psp"));
  const current = "file" in s.application ? s.application.file : null;
  const options = [...new Set([...(current ? [current] : []), ...pspFiles])];
  const knownUris = new Set(s.tools.map(toolUri));
  const strays = s.node.agents.filter(a => !knownUris.has(a));
  const setAgents = (agents: string[]) => onChange({ ...s, node: { ...s.node, agents } });
  return (
    <>
      <Section title="Application" description="The PSP application text the model interprets. It is signed into the system prompt together with the interpreter instructions.">
        <FormGrid>
          <Field label="Source">
            <Select value={current !== null ? "file" : "inline"} options={[{ value: "file", label: "Workspace file" }, { value: "inline", label: "Inline text" }]}
              onChange={v => onChange({ ...s, application: v === "file" ? { file: current ?? pspFiles[0] ?? "application.psp" } : { source: INLINE_TEMPLATE } })} />
          </Field>
          {current !== null && (
            <Field label="File" hint={<><Link to={pspHref(current)}>Open in the PSP editor</Link> · <Link to={fileHref(current)}>as text</Link></>}>
              <Select value={current} options={options.map(p => ({ value: p, label: p }))} onChange={v => onChange({ ...s, application: { file: v } })} />
            </Field>
          )}
          <Field label="Interpreter" hint="The PSP Core 3.2 and CDL 1.5 interpreter candidates from specs/systemprompts, prepended to the application.">
            <Select value={s.interpreter} options={[{ value: "psp-core-3.2-draft-0.1", label: "PSP Core 3.2 + CDL 1.5 (draft 0.1)" }, { value: "none", label: "None: application text only" }]}
              onChange={v => onChange({ ...s, interpreter: v })} />
          </Field>
          {"source" in s.application && (
            <Field label="Application text" wide>
              <TextArea code rows={16} value={s.application.source} onChange={v => onChange({ ...s, application: { source: v } })} />
            </Field>
          )}
        </FormGrid>
      </Section>
      <Section title="Starting node" description="The session starts here. The dispatch gate offers the model only the tools whose mcp:// URI is in this node's agent list.">
        <FormGrid>
          <Field label="Node id"><TextInput value={s.node.nodeId} onChange={v => onChange({ ...s, node: { ...s.node, nodeId: v } })} /></Field>
          <Field label="Node version"><TextInput value={s.node.nodeVersion} onChange={v => onChange({ ...s, node: { ...s.node, nodeVersion: v } })} /></Field>
          <Field label="Tools available at this node" wide hint={s.tools.length ? undefined : "Add tools on the Tools tab."}>
            <div className="check-list">
              {s.tools.map(t => {
                const uri = toolUri(t), on = s.node.agents.includes(uri);
                return <Checkbox key={uri} checked={on} label={<><code>{toolName(t)}</code> <span className="muted">{uri}</span></>} onChange={c => setAgents(c ? [...s.node.agents, uri] : s.node.agents.filter(a => a !== uri))} />;
              })}
            </div>
          </Field>
        </FormGrid>
        {strays.length > 0 && <Notice kind="warn">Agents with no matching tool: {strays.map(a => <span key={a}><code>{a}</code> <button type="button" onClick={() => setAgents(s.node.agents.filter(x => x !== a))}>remove</button> </span>)}</Notice>}
      </Section>
      <Section title="Initial state" description="Model-visible workflow state the session starts with. It is not host authority.">
        <JsonInput ariaLabel="Initial state" value={s.initialState} rows={8} onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) onChange({ ...s, initialState: v as Record<string, unknown> }); }} />
      </Section>
    </>
  );
}

export function ProviderTab({ s, onChange }: { s: LiveLoopScenario; onChange: Change<LiveLoopScenario> }) {
  const p = s.provider;
  const setKind = (kind: string) => onChange({ ...s, provider:
    kind === "mock" ? { kind: "mock", script: s.turns.map(() => [{ type: "final" as const, text: "Done." }]) }
    : kind === "openai" ? { kind: "openai" } : { kind: "anthropic", model: "claude-opus-5-5" } });
  return (
    <>
      <Section title="Model provider">
        <FormGrid>
          <Field label="Provider">
            <Select value={p.kind} onChange={setKind} options={[{ value: "mock", label: "Mock: scripted replies, offline" }, { value: "openai", label: "OpenAI: live model calls" }, { value: "anthropic", label: "Anthropic (not supported by the live loop)" }]} />
          </Field>
          {p.kind === "openai" && <Field label="Model" hint="The OpenAI adapter pins its own model; this value is informational."><TextInput value={p.model ?? ""} onChange={v => onChange({ ...s, provider: opt(p, "model", v) })} /></Field>}
          {p.kind === "anthropic" && <Field label="Model"><TextInput value={p.model} onChange={v => onChange({ ...s, provider: { ...p, model: v } })} /></Field>}
          {p.kind !== "mock" && <>
            <Field label="Max output tokens"><NumberInput value={p.maxOutputTokens} min={1} max={32768} onChange={v => onChange({ ...s, provider: opt(p, "maxOutputTokens", v) })} /></Field>
            <Field label="Timeout (ms)"><NumberInput value={p.timeoutMs} min={1000} max={120000} onChange={v => onChange({ ...s, provider: opt(p, "timeoutMs", v) })} /></Field>
          </>}
        </FormGrid>
        {p.kind === "mock" && <Notice kind="info">Scripted replies are edited per turn. Open a turn on the Turns tab to change what the mock model answers.</Notice>}
        {p.kind === "openai" && <Notice kind="info">Live runs read the OpenAI key from Secrets and must be admitted with the digest that Prepare returns.</Notice>}
        {p.kind === "anthropic" && <Notice kind="warn">The live loop has no TypeScript Anthropic adapter, so prepare reports UNSUPPORTED_PROVIDER. Campaign scenarios drive Anthropic models from Python.</Notice>}
      </Section>
      <Section title="Recipient capabilities" description="CDL capabilities of the parties that receive data. The inference phase evaluates policy against the provider; the release phase against the operator.">
        <FormGrid>
          <Field label="Provider capabilities" hint="For example used-for-model-training. Empty means the provider declares none."><TokenInput value={s.providerCapabilities ?? []} onChange={v => onChange(opt(s, "providerCapabilities", v.length ? v : undefined))} /></Field>
          <Field label="Release capabilities" hint="For example can-display-to-operator."><TokenInput value={s.releaseCapabilities ?? []} onChange={v => onChange(opt(s, "releaseCapabilities", v.length ? v : undefined))} /></Field>
        </FormGrid>
      </Section>
    </>
  );
}

interface TurnRow { index: number; message: string; requestId: string; replies: number }
export function TurnsTab({ s, onChange, openChild }: { s: LiveLoopScenario; onChange: Change<LiveLoopScenario>; openChild(...segments: string[]): void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const mock = s.provider.kind === "mock";
  const rows: TurnRow[] = s.turns.map((t, index) => ({ index, message: t.message, requestId: t.requestId ?? "", replies: scriptFor(s, index).length }));
  const columns: Column<TurnRow>[] = [
    { key: "turn", header: "Turn", width: "64px", align: "right", value: r => r.index + 1 },
    { key: "message", header: "User message", value: r => truncate(oneLine(r.message), 160) },
    { key: "request", header: "Request id", width: "140px", value: r => r.requestId || `turn-${r.index + 1}` },
    ...(mock ? [{ key: "replies", header: "Scripted replies", width: "130px", align: "right" as const, value: (r: TurnRow) => r.replies }] : []),
    { key: "complete", header: "Completes", width: "100px", value: r => s.plan.completeOnTurn === r.index + 1 ? "yes" : "" }
  ];
  const move = (row: TurnRow, delta: number) => { onChange(moveTurn(s, row.index, delta)); setSelected(String(row.index + delta)); };
  return (
    <Section title="Turns" description="Each turn sends one user message. Durable loops restart every turn from the signed prompt and that message; committed state carries over. Double-click a turn to edit it and its scripted replies.">
      <DataGrid id={`scenario:${s.id}:turns`} label="Scenario turns" rows={rows} columns={columns} rowKey={r => String(r.index)}
        selected={selected} onSelectedChange={setSelected} onOpen={r => openChild("turns", String(r.index + 1))}
        actions={sel => <>
          <button type="button" className="primary" onClick={() => openChild("turns", "new")}>New turn</button>
          <button type="button" disabled={!sel || sel.index === 0} onClick={() => sel && move(sel, -1)}>Move up</button>
          <button type="button" disabled={!sel || sel.index === rows.length - 1} onClick={() => sel && move(sel, 1)}>Move down</button>
          <button type="button" className="danger" disabled={!sel || rows.length <= 1} title={rows.length <= 1 ? "A scenario needs at least one turn" : undefined}
            onClick={() => { if (sel && window.confirm(`Remove turn ${sel.index + 1}${mock ? " and its scripted replies" : ""}? Save to apply.`)) { onChange(deleteTurn(s, sel.index)); setSelected(null); } }}>Delete</button>
        </>} />
    </Section>
  );
}

export function ToolsTab({ s, onChange, openChild }: { s: LiveLoopScenario; onChange: Change<LiveLoopScenario>; openChild(...segments: string[]): void }) {
  const columns: Column<SyntheticTool>[] = [
    { key: "name", header: "Tool", value: t => toolName(t), render: t => <code>{toolName(t)}</code> },
    { key: "revision", header: "Revision", width: "110px", value: t => t.revision ?? "tool-1" },
    { key: "response", header: "Response", width: "100px", value: t => t.response.kind },
    { key: "caps", header: "Capabilities", value: t => (t.capabilities ?? []).join(", ") },
    { key: "node", header: "At node", width: "90px", value: t => s.node.agents.includes(toolUri(t)) },
    { key: "calls", header: "Script calls", width: "110px", align: "right", value: t => scriptReferences(s, toolName(t)) }
  ];
  return (
    <Section title="Synthetic tools" description="Read-only tools registered with the MCP dispatch gate. They return synthetic data; nothing leaves the machine. Double-click a tool to edit it.">
      <DataGrid id={`scenario:${s.id}:tools`} label="Scenario tools" rows={s.tools} columns={columns} rowKey={toolName}
        onOpen={t => openChild("tools", toolName(t))} emptyMessage="No tools. The model can still answer without them."
        actions={sel => <>
          <button type="button" className="primary" onClick={() => openChild("tools", "new")}>New tool</button>
          <button type="button" className="danger" disabled={!sel} onClick={() => {
            if (!sel) return;
            const refs = scriptReferences(s, toolName(sel));
            if (window.confirm(`Remove ${toolName(sel)}?${refs ? ` ${refs} scripted replies still call it.` : ""} Save to apply.`)) onChange(deleteTool(s, toolName(sel)));
          }}>Delete</button>
        </>} />
    </Section>
  );
}

const PHASES: PolicyOverride["phase"][] = ["inference", "tool", "release", "dispatch", "recovery"];
function ResourceFields({ value, onChange }: { value: PolicyResource; onChange: Change<PolicyResource> }) {
  return <>
    <Field label="Classes" hint="Data classes of the resource."><TokenInput value={value.classes} onChange={v => onChange({ ...value, classes: v })} /></Field>
    <Field label="Covenants" hint="Obligations the recipient must honor, for example no-training."><TokenInput value={value.covenants} onChange={v => onChange({ ...value, covenants: v })} /></Field>
    <Field label="Capabilities" hint="Capabilities on this path, for example used-for-model-training to force a denial."><TokenInput value={value.capabilities} onChange={v => onChange({ ...value, capabilities: v })} /></Field>
  </>;
}
export function PolicyTab({ s, onChange }: { s: LiveLoopScenario; onChange: Change<LiveLoopScenario> }) {
  const overrides = s.policy.overrides ?? [];
  const setOverrides = (next: PolicyOverride[]) => onChange({ ...s, policy: next.length ? { ...s.policy, overrides: next } : { default: s.policy.default } });
  const setOne = (i: number, o: PolicyOverride) => setOverrides(overrides.map((x, j) => j === i ? o : x));
  return (
    <>
      <Section title="Default resource" description="The host returns this CDL resource for every policy decision unless an override matches. CDL evaluates it against the recipient's capabilities.">
        <FormGrid><ResourceFields value={s.policy.default} onChange={v => onChange({ ...s, policy: { ...s.policy, default: v } })} /></FormGrid>
      </Section>
      <Section title="Overrides" description="Replace the resource for one phase, optionally only on one turn or step. The last matching override wins. Blank turn or step means every one."
        actions={<button type="button" onClick={() => setOverrides([...overrides, { phase: "release", resource: structuredClone(s.policy.default) }])}>Add override</button>}>
        {overrides.length === 0 ? <p className="muted">No overrides.</p> : (
          <div className="grid"><div className="grid-scroll">
            <table className="inline-table" aria-label="Policy overrides">
              <thead><tr><th>Phase</th><th style={{ width: "90px" }}>Turn</th><th style={{ width: "90px" }}>Step</th><th>Classes</th><th>Covenants</th><th>Capabilities</th><th style={{ width: "90px" }} /></tr></thead>
              <tbody>
                {overrides.map((o, i) => (
                  <tr key={i}>
                    <td><Select ariaLabel={`Override ${i + 1} phase`} value={o.phase} options={PHASES.map(p => ({ value: p, label: p }))} onChange={v => setOne(i, { ...o, phase: v })} /></td>
                    <td><NumberInput ariaLabel={`Override ${i + 1} turn`} value={o.turn} min={1} max={64} onChange={v => setOne(i, opt(o, "turn", v))} /></td>
                    <td><NumberInput ariaLabel={`Override ${i + 1} step`} value={o.step} min={1} max={32} onChange={v => setOne(i, opt(o, "step", v))} /></td>
                    <td><TokenInput ariaLabel={`Override ${i + 1} classes`} value={o.resource.classes} onChange={v => setOne(i, { ...o, resource: { ...o.resource, classes: v } })} /></td>
                    <td><TokenInput ariaLabel={`Override ${i + 1} covenants`} value={o.resource.covenants} onChange={v => setOne(i, { ...o, resource: { ...o.resource, covenants: v } })} /></td>
                    <td><TokenInput ariaLabel={`Override ${i + 1} capabilities`} value={o.resource.capabilities} onChange={v => setOne(i, { ...o, resource: { ...o.resource, capabilities: v } })} /></td>
                    <td><button type="button" className="danger" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
      </Section>
    </>
  );
}

export function LimitsTab({ s, onChange }: { s: LiveLoopScenario; onChange: Change<LiveLoopScenario> }) {
  const r = s.refresh;
  return (
    <>
      <Section title="Limits">
        <FormGrid>
          <Field label="Max steps per turn" hint="Model calls allowed in one turn, tool calls included."><NumberInput value={s.limits.maxSteps} min={1} max={32} onChange={v => v !== undefined && onChange({ ...s, limits: { ...s.limits, maxSteps: v } })} /></Field>
          {s.loop === "context" && <Field label="Max service rounds"><NumberInput value={s.limits.maxRounds} min={1} max={16} onChange={v => onChange({ ...s, limits: opt(s.limits, "maxRounds", v) })} /></Field>}
          <Field label="Turn deadline (seconds)"><NumberInput value={s.limits.deadlineSeconds} min={1} max={3600} onChange={v => v !== undefined && onChange({ ...s, limits: { ...s.limits, deadlineSeconds: v } })} /></Field>
          <Field label="Clock" hint="Virtual time advances one second per provider or tool call, so expiry and refresh are reproducible. Live providers always use the wall clock.">
            <Select value={s.clock} options={[{ value: "virtual", label: "Virtual" }, { value: "wall", label: "Wall clock" }]} onChange={v => onChange({ ...s, clock: v })} />
          </Field>
        </FormGrid>
      </Section>
      <Section title="Turn plan" description="How the host turns the model's final answer into committed state. Durable and refreshing loops only.">
        <FormGrid>
          <Field label="State policy" hint={s.plan.statePolicy === "accumulate" ? "Append each answer to state.turns." : s.plan.statePolicy === "replace" ? "Replace state with the latest answer." : "Use the model's JSON {\"state\": {...}} when present, else accumulate."}>
            <Select value={s.plan.statePolicy} options={[{ value: "accumulate", label: "Accumulate" }, { value: "replace", label: "Replace" }, { value: "model-state", label: "Model-proposed state" }]} onChange={v => onChange({ ...s, plan: { ...s.plan, statePolicy: v } })} />
          </Field>
          <Field label="Complete on turn" hint="The session completes after this turn; later turns meet the post-completion lockdown.">
            <Select value={String(s.plan.completeOnTurn ?? "")} options={[{ value: "", label: "Never" }, ...s.turns.map((_, i) => ({ value: String(i + 1), label: `Turn ${i + 1}` }))]}
              onChange={v => onChange({ ...s, plan: v ? { ...s.plan, completeOnTurn: Number(v) } : { statePolicy: s.plan.statePolicy } })} />
          </Field>
        </FormGrid>
      </Section>
      {s.loop === "refreshing" && r && (
        <Section title="Prompt refresh" description="Signed attributes on the system prompt. The refreshing loop re-signs the prompt when a trigger fires.">
          <FormGrid>
            <Field label="Policy"><Select value={r.policy} options={[{ value: "interval", label: "Every N turns" }, { value: "expiration", label: "Before expiry" }, { value: "interval|expiration", label: "Both" }]}
              onChange={v => onChange({ ...s, refresh: v.includes("interval") ? { ...r, policy: v, interval: r.interval ?? 2 } : opt({ ...r, policy: v }, "interval", undefined) })} /></Field>
            {r.policy.includes("interval") && <Field label="Interval (turns)"><NumberInput value={r.interval} min={1} max={64} onChange={v => onChange({ ...s, refresh: opt(r, "interval", v) })} /></Field>}
            <Field label="Grace (seconds)" hint="Refresh this long before expiry. Default 300."><NumberInput value={r.grace} min={0} max={86400} onChange={v => onChange({ ...s, refresh: opt(r, "grace", v) })} /></Field>
            <Field label="Prompt lifetime (seconds)"><NumberInput value={r.ttl} min={1} max={86400} onChange={v => v !== undefined && onChange({ ...s, refresh: { ...r, ttl: v } })} /></Field>
          </FormGrid>
        </Section>
      )}
    </>
  );
}

export function CampaignSettings({ s, onChange, onValidity }: { s: CampaignScenario; onChange: Change<CampaignScenario>; onValidity(valid: boolean): void }) {
  return (
    <Section title="Campaign" description="Runs scripts/campaign.py: prepare, run, analyze. The configuration is the native PSP-CAMPAIGN-0.1 document.">
      <FormGrid>
        <Field label="Live collection" hint="Live runs call the providers named in the config and need their API keys in Secrets plus admission."><Checkbox checked={!!s.live} label="Call live providers" onChange={v => onChange({ ...s, live: v })} /></Field>
        <Field label="Pair ids" hint="Optional corpus pair ids. Each expands to its attack and benign case."><TokenInput value={s.pairIds ?? []} onChange={v => onChange(opt(s, "pairIds", v.length ? v : undefined))} placeholder="read, disclosure" /></Field>
        <Field label="Configuration" wide><JsonInput value={s.config} rows={24} onValidity={onValidity} onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) onChange({ ...s, config: v as Record<string, unknown> }); }} /></Field>
      </FormGrid>
    </Section>
  );
}
export function JointSettings({ s, onChange, templates }: { s: JointScenario; onChange: Change<JointScenario>; templates: Templates }) {
  return (
    <Section title="Joint interpreter validation" description="Runs scripts/joint_interpreter.py against the shared interpreter cases.">
      <FormGrid>
        <Field label="Language"><Select value={s.language} options={[{ value: "python", label: "python" }, { value: "typescript", label: "typescript" }]} onChange={v => onChange({ ...s, language: v })} /></Field>
        <Field label="Mode" hint="Rehearsal uses scripted providers. Live needs an OpenAI key and admission."><Select value={s.mode} options={[{ value: "rehearsal", label: "Rehearsal" }, { value: "live", label: "Live" }]} onChange={v => onChange({ ...s, mode: v })} /></Field>
        <Field label="Cases" wide hint={templates.jointCaseIds.length ? `Leave empty for all. Known: ${templates.jointCaseIds.join(", ")}` : "Leave empty for all cases."}><TokenInput value={s.caseIds ?? []} onChange={v => onChange(opt(s, "caseIds", v.length ? v : undefined))} /></Field>
      </FormGrid>
    </Section>
  );
}
type Language = StudyScenario["hosts"][number];
export function StudySettings({ s, onChange, templates }: { s: StudyScenario; onChange: Change<StudyScenario>; templates: Templates }) {
  const toggle = <T extends string,>(list: readonly T[], value: T, on: boolean): T[] => on ? [...new Set([...list, value])] : list.filter(x => x !== value);
  const languages: Language[] = ["typescript", "python"];
  return (
    <Section title="Study" description="Runs scripts/run-study.py in offline mode. The run directory must be under .artifacts.">
      <FormGrid>
        <Field label="Mode"><Select value={s.mode} options={[{ value: "offline", label: "Offline" }, { value: "live", label: "Live (CLI only)" }]} onChange={v => onChange({ ...s, mode: v })} /></Field>
        <Field label="Repeats"><NumberInput value={s.repeats} min={1} max={64} onChange={v => v !== undefined && onChange({ ...s, repeats: v })} /></Field>
        <Field label="Hosts"><div className="check-list">{languages.map(l => <Checkbox key={l} label={l} checked={s.hosts.includes(l)} onChange={c => onChange({ ...s, hosts: toggle(s.hosts, l, c) })} />)}</div></Field>
        <Field label="Peers"><div className="check-list">{languages.map(l => <Checkbox key={l} label={l} checked={s.peers.includes(l)} onChange={c => onChange({ ...s, peers: toggle(s.peers, l, c) })} />)}</div></Field>
        <Field label="Conditions" wide><div className="check-list">{templates.studyConditions.map(c => <Checkbox key={c} label={c} checked={s.conditions.includes(c)} onChange={on => onChange({ ...s, conditions: toggle(s.conditions, c, on) })} />)}</div></Field>
        <Field label="Cases" wide hint="Leave empty for every corpus case."><TokenInput value={s.caseIds ?? []} onChange={v => onChange(opt(s, "caseIds", v.length ? v : undefined))} /></Field>
      </FormGrid>
    </Section>
  );
}
export function HeldoutSettings({ s, onChange }: { s: HeldoutScenario; onChange: Change<HeldoutScenario> }) {
  return (
    <Section title="Held-out executor" description="Plans with scripts/pilot.mjs, then prepares and runs scripts/run-heldout.py in rehearsal.">
      <FormGrid>
        <Field label="Mode"><Select value={s.mode} options={[{ value: "rehearsal", label: "Rehearsal" }, { value: "live", label: "Live (CLI only)" }]} onChange={v => onChange({ ...s, mode: v })} /></Field>
        <Field label="Plan request" hint="Repository-relative path."><TextInput value={s.plan} onChange={v => onChange({ ...s, plan: v })} /></Field>
        <Field label="Corpus" hint="Repository-relative path."><TextInput value={s.corpus} onChange={v => onChange({ ...s, corpus: v })} /></Field>
      </FormGrid>
    </Section>
  );
}
