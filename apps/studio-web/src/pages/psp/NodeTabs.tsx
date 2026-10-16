// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type ReactNode } from "react";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Checkbox, Field, FormGrid, NumberInput, Select, TextArea, TextInput, TokenInput } from "../../components/fields";
import { Notice } from "../../components/Page";
import {
  addChildSection, blockBody, blockIndex, blockOf, blocksOf, buildSection, childNodes, formatSection, isSection, makeEntry, newSection, parseJsonBody,
  parsePsp, removeSection, replaceSection, scopeKeys, sectionAt, setAttributes, setBlock, withBody, type ChildNode, type GraphEdge, type Path
} from "../../psp/model";
import {
  APP_MODES, COMMON_CAPABILITIES, kindOf, LOCALITIES, NODE_KINDS, POST_COMPLETION, REFRESH_POLICIES, TRUST_LEVELS, TRUST_PRESETS, VERSION, type NodeKind
} from "../../psp/kinds";
import { truncate } from "../../lib/format";
import { useEditor, type NodeRef } from "./editor";

const pk = (path: Path) => path.join(".");
const list = (raw: string | undefined) => (raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
const num = (raw: string | undefined) => raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const jsonProblem = (text: string) => { try { JSON.parse(text); return null; } catch (e) { return (e as Error).message; } };
/** Select options that always include the current value, so an unusual value is shown rather than lost. */
const options = (values: readonly { value: string; label: string }[], current: string) =>
  current === "" || values.some(o => o.value === current) ? values : [...values, { value: current, label: current }];

/** Edits on one node, each an undoable step that coalesces while typing in the same field. */
function useNode(node: NodeRef) {
  const editor = useEditor();
  const attr = (name: string) => node.section.attributes[name] ?? "";
  const setAttr = (name: string, value: string | undefined, path: Path = node.path) =>
    editor.apply(doc => setAttributes(doc, path, { [name]: value === "" ? undefined : value }), `attr:${pk(path)}:${name}`);
  const body = (type: string) => { const b = blockOf(node.section, type); return b ? blockBody(b) : null; };
  const setBody = (type: string, value: string | null, attributes?: Record<string, string>) =>
    editor.apply(doc => setBlock(doc, node.path, type, value, attributes), `block:${pk(node.path)}:${type}`);
  const blockPath = (type: string): Path | null => { const i = blockIndex(node.section, type); return i < 0 ? null : [...node.path, i]; };
  return { editor, attr, setAttr, body, setBody, blockPath };
}

/** A leaf body that keeps what the user typed, including trailing whitespace the document trims. */
function BodyArea({ value, onChange, rows = 6, code }: { value: string; onChange(value: string): void; rows?: number; code?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => { if (value !== text.trim()) setText(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <TextArea rows={rows} code={!!code} value={text} onChange={v => { setText(v); onChange(v.trim()); }} />;
}
function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="psp-group" role="group" aria-label={title}><div className="psp-group-head"><h4>{title}</h4><span className="spacer" />{actions}</div>{children}</div>;
}
function Empty({ children, action, onClick }: { children: ReactNode; action: string; onClick(): void }) {
  return <div className="psp-empty"><p className="muted">{children}</p><button type="button" onClick={onClick}>{action}</button></div>;
}

// ---------------------------------------------------------------- general and application

const KNOWN = new Set([
  "type", "node-type", "id", "name", "version", "load", "trust-level", "priority", "agents", "models", "capabilities", "transition-trust",
  "transition-max-trust-level", "transition-min-priority", "transition-require-signature", "transition-endpoints", "session-id", "mode",
  "post-completion", "post-completion-message", "post-completion-target"
]);

function KeyField({ node, label }: { node: NodeRef; label: string }) {
  const editor = useEditor();
  const [text, setText] = useState(node.key);
  useEffect(() => setText(node.key), [node.key]);
  const taken = childNodes(editor.doc, node.path.slice(0, -1)).map(n => n.key).filter(k => k !== node.key);
  const problem = (v: string) => !v ? `${label} is required.` : /\s/.test(v) ? `${label}s cannot contain spaces.` : taken.includes(v) ? `${v} is already used in this scope.` : null;
  return (
    <Field label={label} error={problem(text)} hint="Unique among its siblings. Renaming updates the transitions and reset targets that name it.">
      <TextInput value={text} onChange={v => { setText(v); if (!problem(v)) editor.rename(node, v); }} />
    </Field>
  );
}

export function GeneralTab({ node, isScope }: { node: NodeRef; isScope: boolean }) {
  const { editor, attr, setAttr } = useNode(node);
  const types = options(NODE_KINDS.map(k => ({ value: k.type, label: k.label })), node.nodeType);
  const entry = !isScope && editor.graph.entry === node.key;
  return (
    <>
      <FormGrid>
        <KeyField node={node} label="Id" />
        <Field label="Node type" hint={kindOf(node.nodeType).description}><Select value={node.nodeType} options={types} onChange={v => setAttr("node-type", v)} /></Field>
        <Field label="Version" hint="Semantic version (PSP 9.2)."><TextInput value={attr("version")} onChange={v => setAttr("version", v)} /></Field>
        <Field label="Load"><Select value={attr("load")} options={options([{ value: "", label: "eager (default)" }, { value: "lazy", label: "lazy" }], attr("load"))} onChange={v => setAttr("load", v)} /></Field>
        <TrustFields node={node} />
      </FormGrid>
      {!isScope && (
        <Group title="Entry">
          {entry ? <p className="muted small">The first node in this scope, where execution usually begins (PSP 16.1).</p> : (
            <div className="row"><span className="muted small">Execution usually begins at the first node in a scope.</span>
              <button type="button" onClick={() => editor.apply(doc => makeEntry(doc, editor.scopePath, node.key))}>Make start node</button></div>
          )}
        </Group>
      )}
      <OtherAttributes node={node} />
    </>
  );
}

function TrustFields({ node }: { node: NodeRef }) {
  const { attr, setAttr } = useNode(node);
  return (
    <>
      <Field label="Trust level" hint="Lower is more trusted (PSP 12.2)."><Select value={attr("trust-level")} options={options([{ value: "", label: "not set" }, ...TRUST_LEVELS], attr("trust-level"))} onChange={v => setAttr("trust-level", v)} /></Field>
      <Field label="Priority" hint="0 to 100, weight within its trust level."><NumberInput value={num(attr("priority"))} min={0} max={100} onChange={v => setAttr("priority", v === undefined ? "" : String(v))} /></Field>
    </>
  );
}

function OtherAttributes({ node }: { node: NodeRef }) {
  const { editor, setAttr } = useNode(node);
  const [name, setName] = useState(""), [value, setValue] = useState("");
  const rows = Object.entries(node.section.attributes).filter(([k]) => !KNOWN.has(k));
  const invalid = name !== "" && (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) || Object.hasOwn(node.section.attributes, name));
  return (
    <Group title="Other attributes">
      {rows.length > 0 && (
        <table className="inline-table" aria-label="Other attributes">
          <thead><tr><th>Attribute</th><th>Value</th><th /></tr></thead>
          <tbody>{rows.map(([k, v]) => (
            <tr key={k}><td><code>{k}</code></td><td><TextInput ariaLabel={`${k} value`} value={v} onChange={nv => setAttr(k, nv)} /></td>
              <td><button type="button" onClick={() => editor.apply(doc => setAttributes(doc, node.path, { [k]: undefined }))}>Remove</button></td></tr>
          ))}</tbody>
        </table>
      )}
      <div className="row">
        <input aria-label="New attribute name" placeholder="name" value={name} onChange={e => setName(e.target.value)} />
        <input aria-label="New attribute value" placeholder="value" value={value} onChange={e => setValue(e.target.value)} />
        <button type="button" disabled={!name || invalid} onClick={() => { editor.apply(doc => setAttributes(doc, node.path, { [name]: value })); setName(""); setValue(""); }}>Add</button>
      </div>
      {invalid && <div className="field-error">Use a new attribute name of letters, digits, _ . : or -.</div>}
    </Group>
  );
}

export function ApplicationTab({ node }: { node: NodeRef }) {
  const { attr, setAttr } = useNode(node);
  const hasId = node.section.attributes.id !== undefined;
  return (
    <>
      <FormGrid>
        {hasId ? <KeyField node={node} label="Id" /> : <KeyField node={node} label="Name" />}
        {hasId && <Field label="Name" hint="Human-readable application name (PSP 8.2)."><TextInput value={attr("name")} onChange={v => setAttr("name", v)} /></Field>}
        <Field label="Session id" hint="Unique per execution; hosts normally assign it (PSP 8.2)."><TextInput value={attr("session-id")} onChange={v => setAttr("session-id", v)} /></Field>
        <Field label="Version"><TextInput value={attr("version")} onChange={v => setAttr("version", v)} /></Field>
        <Field label="Mode" hint="Signature, output and input handling (PSP 8.3).">
          <Select value={attr("mode")} options={options([{ value: "", label: "not set (prod)" }, ...APP_MODES.map(m => ({ value: m, label: m }))], attr("mode"))} onChange={v => setAttr("mode", v)} />
        </Field>
        <TrustFields node={node} />
      </FormGrid>
      <OtherAttributes node={node} />
    </>
  );
}

// ---------------------------------------------------------------- instructions

const SIGNATURE_ATTRIBUTES = ["signature", "signature-algorithm", "signature-version", "kid", "timestamp", "expires", "nonce"];

export function InstructionsTab({ node }: { node: NodeRef }) {
  const { editor, body, setBody, blockPath, setAttr } = useNode(node);
  const system = blockOf(node.section, "system");
  const systemPath = blockPath("system");
  const contexts = blocksOf(node.section, "context");
  return (
    <>
      {system && systemPath ? (
        <>
          <Field label="System instructions" hint="Session-level instructions for this node (PSP 7.1.1). The live loop signs prompts at run time.">
            <BodyArea rows={10} value={body("system") ?? ""} onChange={v => setBody("system", v)} />
          </Field>
          <FormGrid>
            <Field label="Instructions version"><TextInput value={system.attributes.version ?? ""} onChange={v => setAttr("version", v, systemPath)} /></Field>
          </FormGrid>
          {system.attributes.signature && (
            <Notice kind="warn">
              This block carries a stored signature{system.attributes.kid ? ` (key ${system.attributes.kid})` : ""}. Editing the instructions makes it stale.{" "}
              <button type="button" onClick={() => editor.apply(doc => setAttributes(doc, systemPath, Object.fromEntries(SIGNATURE_ATTRIBUTES.map(a => [a, undefined]))))}>Remove signature attributes</button>
            </Notice>
          )}
          <RefreshFields path={systemPath} attributes={system.attributes} />
        </>
      ) : <Empty action="Add instructions" onClick={() => setBody("system", "Describe what this node accomplishes.", { version: VERSION })}>This node has no system instructions.</Empty>}
      <Group title="Context blocks" actions={<button type="button" onClick={() => editor.apply(doc => addChildSection(doc, node.path, newSection({ type: "context" }, "Context")).doc)}>Add context</button>}>
        {contexts.length === 0 && <p className="muted small">Verified contextual data for this node (PSP 7.1.2).</p>}
        {contexts.map(({ section, index }, i) => (
          <Field key={index} label={`Context ${i + 1}`}>
            <BodyArea rows={4} value={blockBody(section)} onChange={v => editor.apply(doc => replaceSection(doc, [...node.path, index], withBody(section, v, node.path.length)), `context:${pk(node.path)}:${index}`)} />
            <div className="row"><button type="button" className="danger" onClick={() => editor.apply(doc => removeSection(doc, [...node.path, index]))}>Remove context {i + 1}</button></div>
          </Field>
        ))}
      </Group>
    </>
  );
}

function RefreshFields({ path, attributes }: { path: Path; attributes: Record<string, string> }) {
  const editor = useEditor();
  const set = (name: string, value: string | undefined) => editor.apply(doc => setAttributes(doc, path, { [name]: value || undefined }), `attr:${pk(path)}:${name}`);
  const policies = (attributes["refresh-policy"] ?? "").split("|").filter(Boolean);
  const on = list(attributes["refresh-on"]);
  const toggle = (values: string[], value: string, checked: boolean) => checked ? [...values, value] : values.filter(v => v !== value);
  return (
    <Group title="Refresh directive">
      <p className="muted small">When the host re-asserts these instructions (PSP 21.10). Default is expiration.</p>
      <div className="check-row" role="group" aria-label="Refresh policy">
        {REFRESH_POLICIES.map(p => <Checkbox key={p} label={p} checked={policies.includes(p)} onChange={c => set("refresh-policy", toggle(policies, p, c).join("|"))} />)}
      </div>
      <FormGrid>
        {policies.includes("interval") && <Field label="Refresh interval" hint="Turns between refreshes."><NumberInput min={1} value={num(attributes["refresh-interval"])} onChange={v => set("refresh-interval", v === undefined ? undefined : String(v))} /></Field>}
        <Field label="Refresh grace" hint="Seconds before expiry to refresh. Default 300."><NumberInput min={0} value={num(attributes["refresh-grace"])} onChange={v => set("refresh-grace", v === undefined ? undefined : String(v))} /></Field>
        <Field label="Refresh endpoint" hint="Omit to discover through the MCP server."><TextInput value={attributes["refresh-endpoint"] ?? ""} onChange={v => set("refresh-endpoint", v)} /></Field>
      </FormGrid>
      <div className="check-row" role="group" aria-label="Refresh on">
        <span className="muted small">Refresh before</span>
        {["checkpoint", "connector", "decision"].map(t => <Checkbox key={t} label={t} checked={on.includes(t)} onChange={c => set("refresh-on", toggle(on, t, c).join(","))} />)}
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------- output and config

export function OutputTab({ node }: { node: NodeRef }) {
  const { body, setBody } = useNode(node);
  const schema = body("output-schema");
  if (schema === null) return <Empty action="Add output schema" onClick={() => setBody("output-schema", '{"type":"object","properties":{}}', { "content-type": "json" })}>No output schema. When present, the node's output must conform to it (PSP 14.1).</Empty>;
  const problem = jsonProblem(schema);
  return (
    <>
      <Field label="Output schema" hint={problem ? <span className="warn-text">Not valid JSON: {problem}</span> : "JSON Schema or a compatible shape."}>
        <BodyArea code rows={14} value={schema} onChange={v => setBody("output-schema", v)} />
      </Field>
      <div className="row">
        <button type="button" disabled={!!problem} onClick={() => setBody("output-schema", JSON.stringify(JSON.parse(schema), null, 2))}>Format JSON</button>
        <button type="button" className="danger" onClick={() => setBody("output-schema", null)}>Remove output schema</button>
      </div>
    </>
  );
}

export function ConfigTab({ node, kind }: { node: NodeRef; kind: NodeKind }) {
  const { editor, body, setBody } = useNode(node);
  const block = kind.config!.block;
  const raw = body(block);
  if (raw === null) {
    const fallback = kind.blocks.find(b => b.type === block)?.body ?? "{}";
    return <Empty action={`Add ${block}`} onClick={() => setBody(block, fallback, { "content-type": "json" })}>This {kind.label.toLowerCase()} node has no {block} block.</Empty>;
  }
  const value = parseJsonBody(blockOf(node.section, block));
  const set = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...(isRecord(value) ? value : {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") delete next[k]; else next[k] = v; }
    editor.apply(doc => setBlock(doc, node.path, block, raw.includes("\n") ? JSON.stringify(next, null, 2) : JSON.stringify(next)), `config:${pk(node.path)}:${Object.keys(patch).join(",")}`);
  };
  const str = (k: string) => isRecord(value) && typeof value[k] === "string" ? value[k] as string : "";
  const siblings = childNodes(editor.doc, node.path.slice(0, -1)).filter(n => n.key !== node.key);
  let fields: ReactNode = null;
  if (isRecord(value)) {
    if (block === "loop-config") fields = (
      <FormGrid>
        <Field label="Collection" hint="Variable holding the items."><TextInput value={str("collection")} onChange={v => set({ collection: v })} /></Field>
        <Field label="Item variable"><TextInput value={str("item_var")} onChange={v => set({ item_var: v })} /></Field>
        <Field label="Max iterations"><NumberInput min={1} value={typeof value.max_iterations === "number" ? value.max_iterations : undefined} onChange={v => set({ max_iterations: v })} /></Field>
      </FormGrid>
    );
    else if (block === "connector-config") fields = (
      <FormGrid>
        <Field label="Connector type"><TextInput value={str("type")} onChange={v => set({ type: v })} /></Field>
        <Field label="Operation"><TextInput value={str("operation")} onChange={v => set({ operation: v })} /></Field>
      </FormGrid>
    );
    else if (block === "checkpoint-config") {
      const notification = isRecord(value.notification) ? value.notification : {};
      const setNote = (k: string, v: string) => { const n: Record<string, unknown> = { ...notification }; if (v) n[k] = v; else delete n[k]; set({ notification: Object.keys(n).length ? n : undefined }); };
      const note = (k: string) => typeof notification[k] === "string" ? notification[k] as string : "";
      fields = (
        <FormGrid>
          <Field label="Timeout" hint="For example 72h."><TextInput value={str("timeout")} onChange={v => set({ timeout: v })} /></Field>
          <Field label="Resume link expires" hint="ISO 8601 time."><TextInput value={str("resume_link_expires")} onChange={v => set({ resume_link_expires: v })} /></Field>
          <Field label="Notify by"><Select value={note("type")} options={options([{ value: "", label: "not set" }, { value: "email", label: "email" }, { value: "sms", label: "sms" }, { value: "webhook", label: "webhook" }], note("type"))} onChange={v => setNote("type", v)} /></Field>
          <Field label="Notify to"><TextInput value={note("to")} onChange={v => setNote("to", v)} /></Field>
          <Field label="Subject"><TextInput value={note("subject")} onChange={v => setNote("subject", v)} /></Field>
        </FormGrid>
      );
    } else if (block === "reset-config") {
      const preserve = Array.isArray(value.preserve_nodes) ? value.preserve_nodes.filter((v): v is string => typeof v === "string") : [];
      fields = (
        <>
          <FormGrid>
            <Field label="Target node" hint="Where the workflow resumes after the reset.">
              <Select value={str("target_node")} options={options([{ value: "", label: "choose a node" }, ...siblings.map(s => ({ value: s.key, label: s.key }))], str("target_node"))} onChange={v => set({ target_node: v })} />
            </Field>
          </FormGrid>
          <div className="check-row" role="group" aria-label="Preserve nodes">
            <span className="muted small">Keep outputs of</span>
            {siblings.map(s => <Checkbox key={s.key} label={s.key} checked={preserve.includes(s.key)} onChange={c => set({ preserve_nodes: c ? [...preserve, s.key] : preserve.filter(p => p !== s.key) })} />)}
          </div>
          <div className="check-row">
            <Checkbox label="Generate a new session" checked={value.generate_new_session !== false} onChange={c => set({ generate_new_session: c })} />
            <Checkbox label="Archive the previous session" checked={value.archive_previous !== false} onChange={c => set({ archive_previous: c })} />
          </div>
        </>
      );
    }
  }
  const problem = jsonProblem(raw);
  return (
    <>
      {problem ? <Notice kind="warn">The {block} block is not valid JSON, so only the raw text can be edited.</Notice> : !isRecord(value) && <Notice kind="warn">The {block} block should be a JSON object.</Notice>}
      {fields}
      <Field label={`${block} JSON`} hint={problem ? <span className="warn-text">Not valid JSON: {problem}</span> : "Fields this form does not show are kept."}>
        <BodyArea code rows={8} value={raw} onChange={v => setBody(block, v)} />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------- affinity and routing

export function AffinityTab({ node }: { node: NodeRef }) {
  const { editor, attr, setAttr } = useNode(node);
  const inherited: { from: string; agents: string[] }[] = [];
  for (let depth = 1; depth < node.path.length; depth++) {
    const ancestor = sectionAt(editor.doc, node.path.slice(0, depth));
    const agents = list(ancestor?.attributes.agents);
    if (ancestor && agents.length) inherited.push({ from: ancestor.attributes.id ?? ancestor.attributes.name ?? "ancestor", agents });
  }
  return (
    <>
      <FormGrid>
        <Field label="Agents" hint="Agent URIs such as mcp://server/tool. No agents means no tool access (PSP 11.3.1)."><TokenInput placeholder="mcp://server/tool" value={list(attr("agents"))} onChange={v => setAttr("agents", v.join(","))} /></Field>
        <Field label="Models" hint="Preference order, first is most preferred (PSP 11.3.2)."><TokenInput placeholder="model, model" value={list(attr("models"))} onChange={v => setAttr("models", v.join(","))} /></Field>
        <Field label="Capabilities" hint={`Required model capabilities, such as ${COMMON_CAPABILITIES.join(", ")}.`}><TokenInput placeholder="capability" value={list(attr("capabilities"))} onChange={v => setAttr("capabilities", v.join(","))} /></Field>
      </FormGrid>
      <Group title="Inherited agents">
        {inherited.length === 0 ? <p className="muted small">None. A child node also gets every agent its ancestors declare (PSP 11.4).</p>
          : <ul className="plain">{inherited.map(i => <li key={i.from}><code>{i.from}</code>: {i.agents.join(", ")}</li>)}</ul>}
      </Group>
    </>
  );
}

export function RoutingTab({ node, isScope }: { node: NodeRef; isScope: boolean }) {
  const { editor, attr, setAttr } = useNode(node);
  const outgoing = isScope ? [] : editor.graph.edges.filter(e => e.source === node.key);
  const [target, setTarget] = useState("");
  const columns: Column<GraphEdge>[] = [
    { key: "order", header: "#", width: "34px", align: "right", value: e => outgoing.indexOf(e) + 1 },
    { key: "target", header: "Target", width: "110px", value: e => e.target, render: e => <code>{e.target}</code> },
    { key: "condition", header: "Condition", value: e => e.condition ?? "", render: e => e.condition ? truncate(e.condition, 80) : <span className="muted">no condition</span> },
    { key: "priority", header: "Priority", width: "70px", align: "right", value: e => e.priority ?? "" }
  ];
  return (
    <>
      <Group title="Transition sources">
        <p className="muted small">Which data may inform this node's transitions (PSP 12.5). Explicit values override the preset.</p>
        <FormGrid>
          <Field label="Trust preset"><Select value={attr("transition-trust")} options={options([{ value: "", label: "not set" }, ...TRUST_PRESETS], attr("transition-trust"))} onChange={v => setAttr("transition-trust", v)} /></Field>
          <Field label="Max trust level" hint="Data less trusted than this is excluded."><Select value={attr("transition-max-trust-level")} options={options([{ value: "", label: "not set (3)" }, ...TRUST_LEVELS], attr("transition-max-trust-level"))} onChange={v => setAttr("transition-max-trust-level", v)} /></Field>
          <Field label="Min priority" hint="0 to 100. Default 50."><NumberInput min={0} max={100} value={num(attr("transition-min-priority"))} onChange={v => setAttr("transition-min-priority", v === undefined ? "" : String(v))} /></Field>
          <Field label="Require signature"><Select value={attr("transition-require-signature")} options={options([{ value: "", label: "not set (false)" }, { value: "true", label: "true" }, { value: "false", label: "false" }], attr("transition-require-signature"))} onChange={v => setAttr("transition-require-signature", v)} /></Field>
          <Field label="Endpoints" hint="Agent URI patterns; * matches a capability."><TokenInput placeholder="mcp://erp/*" value={list(attr("transition-endpoints"))} onChange={v => setAttr("transition-endpoints", v.join(","))} /></Field>
        </FormGrid>
      </Group>
      {isScope ? <p className="muted small">This node's own transitions appear in the diagram that contains it.</p> : (
        <Group title="Outgoing transitions">
          <DataGrid id={`psp-out:${editor.file}:${editor.scope.join("/")}:${node.key}`} label="Outgoing transitions" rows={outgoing} columns={columns} rowKey={e => e.key}
            emptyMessage="No transitions leave this node. Drag from its right handle to another node to add one."
            onOpen={e => editor.select({ kind: "edge", key: e.key })} openLabel="Edit"
            actions={() => (
              <>
                <select aria-label="New transition target" value={target} onChange={e => setTarget(e.target.value)}>
                  <option value="">target…</option>
                  {editor.graph.nodes.map(n => <option key={n.key} value={n.key}>{n.key}</option>)}
                </select>
                <button type="button" disabled={!target} onClick={() => { editor.connect(node.key, target); setTarget(""); }}>Add transition</button>
              </>
            )} />
        </Group>
      )}
    </>
  );
}

export function ChildrenTab({ node }: { node: NodeRef }) {
  const editor = useEditor();
  const children = childNodes(editor.doc, node.path);
  const scope = scopeKeys(editor.doc, node.path);
  const columns: Column<ChildNode>[] = [
    { key: "id", header: "Id", value: c => c.key, render: c => <code>{c.key}</code> },
    { key: "type", header: "Type", width: "110px", value: c => c.nodeType },
    { key: "version", header: "Version", width: "80px", value: c => c.section.attributes.version ?? "" }
  ];
  return (
    <DataGrid id={`psp-children:${editor.file}:${scope.join("/")}`} label="Child nodes" rows={children} columns={columns} rowKey={c => c.key}
      emptyMessage="No child nodes. Open the diagram to add some."
      onOpen={c => editor.openScope(scope, { kind: "node", key: c.key })}
      actions={() => <button type="button" onClick={() => editor.openScope(scope)}>Open diagram</button>} />
  );
}

// ---------------------------------------------------------------- application-only tabs

export function CompletionTab({ node }: { node: NodeRef }) {
  const { editor, attr, setAttr } = useNode(node);
  const policy = attr("post-completion");
  const pcIndex = blockIndex(node.section, "post-completion");
  const pc = pcIndex < 0 ? undefined : node.section.children[pcIndex];
  const scoped = isSection(pc) ? blockOf(pc, "system") : undefined;
  const setScoped = (v: string) => editor.apply(doc => pcIndex < 0
    ? addChildSection(doc, node.path, buildSection({ type: "post-completion" }, [newSection({ type: "system", version: VERSION }, v)], node.path.length)).doc
    : setBlock(doc, [...node.path, pcIndex], "system", v, { version: VERSION }), `pc:${pk(node.path)}`);
  return (
    <>
      <FormGrid>
        <Field label="After completion" hint="What happens once the workflow completes (PSP 8.5).">
          <Select value={policy} options={options([{ value: "", label: "not set (unmanaged)" }, ...POST_COMPLETION.map(p => ({ value: p, label: p }))], policy)} onChange={v => setAttr("post-completion", v)} />
        </Field>
        {policy === "redirect" && <Field label="Redirect target" error={attr("post-completion-target") ? null : "Required for redirect."}><TextInput placeholder="mcp://server/applications/name" value={attr("post-completion-target")} onChange={v => setAttr("post-completion-target", v)} /></Field>}
      </FormGrid>
      {(policy === "lockdown" || policy === "redirect") && (
        <Field label="Completion message" hint="Shown to the user when the session closes or hands over.">
          <TextArea rows={3} value={attr("post-completion-message")} onChange={v => setAttr("post-completion-message", v)} />
        </Field>
      )}
      {policy === "scoped" && (
        <Field label="Post-completion instructions" hint="Govern conversation after completion. Loaded only once the workflow completes.">
          <BodyArea rows={8} value={scoped ? blockBody(scoped) : ""} onChange={setScoped} />
        </Field>
      )}
      {pc && policy !== "scoped" && (
        <Notice kind="info">A post-completion section exists but only applies when the policy is scoped.{" "}
          <button type="button" onClick={() => editor.apply(doc => removeSection(doc, [...node.path, pcIndex]))}>Remove it</button></Notice>
      )}
    </>
  );
}

const MACHINE_FIELDS = [["model", "Model"], ["version", "Version"], ["region", "Region"], ["provider", "Provider"], ["jurisdiction", "Jurisdiction"]] as const;
export function MachineTab({ node }: { node: NodeRef }) {
  const { editor, setAttr, blockPath } = useNode(node);
  const machine = blockOf(node.section, "machine"), path = blockPath("machine");
  if (!machine || !path) return <Empty action="Add machine declaration" onClick={() => editor.apply(doc => addChildSection(doc, node.path, newSection({ type: "machine", model: "" })).doc)}>No machine section. It records what the inference engine reports about itself (PSP 7.1.5).</Empty>;
  const value = (k: string) => machine.attributes[k] ?? "";
  return (
    <>
      <p className="muted small">Self-reported by the inference engine. The studio records it; it does not verify it.</p>
      <FormGrid>
        {MACHINE_FIELDS.map(([k, label]) => <Field key={k} label={label}><TextInput value={value(k)} onChange={v => setAttr(k, k === "model" ? v || "" : v, path)} /></Field>)}
        <Field label="Locality"><Select value={value("locality")} options={options([{ value: "", label: "not set" }, ...LOCALITIES.map(l => ({ value: l, label: l }))], value("locality"))} onChange={v => setAttr("locality", v, path)} /></Field>
      </FormGrid>
      <div className="row"><button type="button" className="danger" onClick={() => editor.apply(doc => removeSection(doc, path))}>Remove machine section</button></div>
    </>
  );
}

export function ThreatTab({ node }: { node: NodeRef }) {
  const { editor, body, setBody, blockPath, setAttr } = useNode(node);
  const policy = body("threat-policy"), path = blockPath("threat-policy");
  if (policy === null || !path) return <Empty action="Add threat policy" onClick={() => setBody("threat-policy", "Monitor this session for sustained adversarial probing and become more cautious as signals accumulate.")}>No threat policy. It configures session threat accumulation in natural language or JSON (PSP 28.4).</Empty>;
  const format = blockOf(node.section, "threat-policy")!.attributes.format ?? "";
  return (
    <>
      <FormGrid>
        <Field label="Format"><Select value={format} options={options([{ value: "", label: "natural language" }, { value: "json", label: "json" }], format)} onChange={v => setAttr("format", v, path)} /></Field>
      </FormGrid>
      <Field label="Threat policy" hint={format === "json" && jsonProblem(policy) ? <span className="warn-text">Not valid JSON.</span> : undefined}>
        <BodyArea code={format === "json"} rows={10} value={policy} onChange={v => setBody("threat-policy", v)} />
      </Field>
      <div className="row"><button type="button" className="danger" onClick={() => editor.apply(doc => removeSection(doc, path))}>Remove threat policy</button></div>
    </>
  );
}

// ---------------------------------------------------------------- source

export function SourceTab({ node }: { node: NodeRef }) {
  const editor = useEditor();
  const initial = formatSection(node.section);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(initial); setError(null); }, [initial]);
  const apply = () => {
    const parsed = parsePsp(text);
    if (!parsed.ok) { setError(`${parsed.error} at line ${parsed.line}, column ${parsed.column}.`); return; }
    const sections = parsed.doc.children.filter(isSection);
    const stray = parsed.doc.children.some(c => c.kind === "text" && c.value.trim());
    if (sections.length !== 1 || stray || sections[0]!.attributes.type !== "node") { setError("Enter exactly one ${psp type=node …} section."); return; }
    setError(null);
    editor.apply(doc => replaceSection(doc, node.path, sections[0]!));
  };
  return (
    <>
      <p className="muted small">The markup for this node. Applying replaces it as written; references to a changed id are not updated.</p>
      <Field label="Node markup" error={error}><TextArea code rows={20} value={text} onChange={setText} /></Field>
      <div className="row">
        <button type="button" className="primary" disabled={text === initial} onClick={apply}>Apply</button>
        <button type="button" disabled={text === initial} onClick={() => { setText(initial); setError(null); }}>Discard</button>
      </div>
    </>
  );
}
