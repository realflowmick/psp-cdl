// SPDX-License-Identifier: Apache-2.0
import { DataGrid, type Column } from "../../components/DataGrid";
import { Field, FormGrid, JsonInput, NumberInput, Select, TextArea } from "../../components/fields";
import { Tabs } from "../../components/Page";
import { childNodes, isContainerNode, moveTransition, patchTransition, sectionAt, updateTransition, type GraphEdge } from "../../psp/model";
import { kindOf, TAB_LABELS, type TabId } from "../../psp/kinds";
import { truncate } from "../../lib/format";
import { useEditor, type NodeRef } from "./editor";
import {
  AffinityTab, ApplicationTab, ChildrenTab, CompletionTab, ConfigTab, GeneralTab, InstructionsTab, MachineTab, OutputTab, RoutingTab, SourceTab, ThreatTab
} from "./NodeTabs";

/** Right panel: the properties of whatever is selected, or of the scope's own node when nothing is. */
export function Inspector() {
  const editor = useEditor();
  const { selection, graph } = editor;
  let body;
  if (selection?.kind === "edge") {
    const edge = graph.edges.find(e => e.key === selection.key);
    if (edge) body = <EdgeInspector key={edge.key} edge={edge} />;
  } else if (selection?.kind === "missing" && graph.missing.includes(selection.key)) {
    body = <MissingInspector id={selection.key} />;
  } else if (selection?.kind === "node") {
    const node = graph.nodes.find(n => n.key === selection.key);
    // Keyed by position, not id, so renaming a node keeps focus in the field being typed in.
    if (node) body = <NodeInspector key={node.path.join(".")} node={node} isScope={false} />;
  }
  if (!body) {
    const scopeNode = sectionAt(editor.doc, editor.scopePath);
    body = scopeNode
      ? <NodeInspector key={`scope:${editor.scopePath.join(".")}`} isScope node={{ key: editor.scope[editor.scope.length - 1]!, path: editor.scopePath, section: scopeNode, nodeType: scopeNode.attributes["node-type"] ?? "" }} />
      : <DocumentInspector />;
  }
  return <aside className="psp-inspector" aria-label="Properties">{body}</aside>;
}

function NodeInspector({ node, isScope }: { node: NodeRef; isScope: boolean }) {
  const editor = useEditor();
  const kind = kindOf(node.nodeType);
  const tabs = kind.tabs.filter(t => (t !== "children" || kind.container || isContainerNode(node.section)) && (t !== "config" || kind.config));
  const active = (tabs as string[]).includes(editor.tab) ? editor.tab as TabId : tabs[0]!;
  const label = (t: TabId) => t === "config" && kind.config ? kind.config.label : TAB_LABELS[t];
  const tab = (() => {
    switch (active) {
      case "general": return <GeneralTab node={node} isScope={isScope} />;
      case "application": return <ApplicationTab node={node} />;
      case "instructions": return <InstructionsTab node={node} />;
      case "output": return <OutputTab node={node} />;
      case "config": return <ConfigTab node={node} kind={kind} />;
      case "affinity": return <AffinityTab node={node} />;
      case "routing": return <RoutingTab node={node} isScope={isScope} />;
      case "children": return <ChildrenTab node={node} />;
      case "completion": return <CompletionTab node={node} />;
      case "machine": return <MachineTab node={node} />;
      case "threat": return <ThreatTab node={node} />;
      case "source": return <SourceTab node={node} />;
    }
  })();
  return (
    <>
      <div className="psp-inspector-head">
        <span className={`swatch large tone-${kind.tone}`} aria-hidden="true" />
        <div className="psp-inspector-title">
          <div className="muted small">{isScope ? `${kind.label} containing this diagram` : `${kind.label} node`}</div>
          <h2>{node.key}</h2>
        </div>
        {!isScope && <button type="button" className="danger" onClick={() => editor.deleteNode(node.key)}>Delete</button>}
      </div>
      {isScope && <p className="muted small psp-inspector-note">Nothing is selected. Select a node or transition in the diagram to edit it.</p>}
      <Tabs label={`${node.key} properties`} tabs={tabs.map(t => ({ id: t, label: label(t) }))} active={active} onSelect={t => editor.setTab(t)} />
      <div className="psp-inspector-body" role="tabpanel" aria-label={label(active)}>{tab}</div>
    </>
  );
}

function EdgeInspector({ edge }: { edge: GraphEdge }) {
  const editor = useEditor();
  const active = editor.tab === "json" ? "json" : "transition";
  const peers = editor.graph.edges.filter(e => e.source === edge.source);
  const sameBlock = peers.filter(e => e.block.join(".") === edge.block.join("."));
  const position = sameBlock.findIndex(e => e.key === edge.key);
  const targets = editor.graph.nodes.map(n => ({ value: n.key, label: n.key }));
  if (!targets.some(t => t.value === edge.target)) targets.push({ value: edge.target, label: `${edge.target} (missing)` });
  const patch = (fields: Record<string, unknown>, field: string) => editor.apply(doc => patchTransition(doc, edge, fields), `edge:${edge.key}:${field}`);
  const move = (direction: -1 | 1) => {
    let key = edge.key;
    editor.apply(doc => { const r = moveTransition(doc, editor.graph, edge, direction); key = r.key; return r.doc; });
    editor.select({ kind: "edge", key });
  };
  return (
    <>
      <div className="psp-inspector-head">
        <span className="swatch large tone-edge" aria-hidden="true" />
        <div className="psp-inspector-title">
          <div className="muted small">Transition</div>
          <h2>{edge.source} → {edge.target}</h2>
        </div>
        <button type="button" className="danger" onClick={() => editor.deleteEdge(edge)}>Delete</button>
      </div>
      <Tabs label="Transition properties" tabs={[{ id: "transition", label: "Transition" }, { id: "json", label: "JSON" }]} active={active} onSelect={t => editor.setTab(t)} />
      <div className="psp-inspector-body" role="tabpanel" aria-label={active === "json" ? "JSON" : "Transition"}>
        {active === "transition" ? (
          <>
            <FormGrid>
              <Field label="From"><button type="button" className="link" onClick={() => editor.select({ kind: "node", key: edge.source })}>{edge.source}</button></Field>
              <Field label="Target"><Select value={edge.target} options={targets} onChange={v => editor.retarget(edge, v)} /></Field>
            </FormGrid>
            <Field label="Condition" hint="Natural language or an expression. The model evaluates it in context (PSP 15.3); the studio never does. Leave empty for none.">
              <TextArea rows={5} value={edge.condition ?? ""} onChange={v => patch({ condition: v === "" ? undefined : v }, "condition")} />
            </Field>
            <FormGrid>
              <Field label="Priority" hint="Optional, for resolving conflicts (PSP 15.2)."><NumberInput value={edge.priority ?? undefined} onChange={v => patch({ priority: v }, "priority")} /></Field>
              <Field label="Order" hint={edge.owner ? `Declared in ${edge.owner}'s own transitions.` : "Declared in this scope's transitions."}>
                <div className="row">
                  <span>{peers.indexOf(edge) + 1} of {peers.length} from {edge.source}</span>
                  <button type="button" disabled={position <= 0} onClick={() => move(-1)}>Earlier</button>
                  <button type="button" disabled={position < 0 || position >= sameBlock.length - 1} onClick={() => move(1)}>Later</button>
                </div>
              </Field>
            </FormGrid>
          </>
        ) : (
          <Field label="Transition JSON" hint="Fields other than target_node, source_node, condition and priority are kept as written.">
            <JsonInput rows={12} value={edge.entry} onChange={v => {
              if (v === null || typeof v !== "object" || Array.isArray(v) || typeof (v as { target_node?: unknown }).target_node !== "string") { editor.report("A transition is a JSON object with a target_node string."); return; }
              editor.report(null);
              editor.apply(doc => updateTransition(doc, edge, v as Record<string, unknown>), `edge:${edge.key}:json`);
            }} />
          </Field>
        )}
      </div>
    </>
  );
}

function MissingInspector({ id }: { id: string }) {
  const editor = useEditor();
  const refs = editor.graph.edges.filter(e => e.source === id || e.target === id);
  const columns: Column<GraphEdge>[] = [
    { key: "from", header: "From", width: "110px", value: e => e.source },
    { key: "to", header: "To", width: "110px", value: e => e.target },
    { key: "condition", header: "Condition", value: e => e.condition ? truncate(e.condition, 60) : "" }
  ];
  return (
    <>
      <div className="psp-inspector-head">
        <span className="swatch large tone-missing" aria-hidden="true" />
        <div className="psp-inspector-title"><div className="muted small">Missing node</div><h2>{id}</h2></div>
      </div>
      <div className="psp-inspector-body">
        <p>Transitions in this scope name <code>{id}</code>, but no node here has that id. The model would find no such node to route to.</p>
        <div className="row"><button type="button" className="primary" onClick={() => editor.addNode("prompt", editor.positions[id], id)}>Create prompt node {id}</button></div>
        <DataGrid id={`psp-missing:${editor.file}:${id}`} label="Transitions naming this id" rows={refs} columns={columns} rowKey={e => e.key}
          onOpen={e => editor.select({ kind: "edge", key: e.key })} openLabel="Edit" />
      </div>
    </>
  );
}

function DocumentInspector() {
  const editor = useEditor();
  const top = childNodes(editor.doc, []);
  return (
    <>
      <div className="psp-inspector-head"><div className="psp-inspector-title"><div className="muted small">Document</div><h2>{editor.file}</h2></div></div>
      <div className="psp-inspector-body">
        <p>{top.length} top-level node{top.length === 1 ? "" : "s"}. Select a node or transition to edit it, or add nodes from the palette.</p>
        <p className="muted small">An application file usually holds one application node (PSP 8.1); add one from the palette if this file has none.</p>
      </div>
    </>
  );
}
