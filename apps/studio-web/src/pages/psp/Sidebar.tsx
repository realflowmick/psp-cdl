// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { checkDocument, outline, type OutlineItem } from "../../psp/model";
import { kindOf, NODE_KINDS } from "../../psp/kinds";
import { NODE_TYPE_MIME } from "./Canvas";
import { useEditor } from "./editor";

/** Left panel: node types to add, the document outline, and authoring checks. */
export function Sidebar() {
  const editor = useEditor();
  const items = useMemo(() => outline(editor.doc), [editor.doc]);
  const checks = useMemo(() => checkDocument(editor.doc), [editor.doc]);
  const warnings = checks.filter(c => c.level === "warn").length;
  return (
    <aside className="psp-sidebar" aria-label="Node types and outline">
      <section aria-label="Node types">
        <h3>Add node</h3>
        <p className="muted small">Click to add, or drag onto the diagram.</p>
        <div className="psp-palette">
          {NODE_KINDS.map(k => (
            <button key={k.type} type="button" draggable title={k.description} aria-label={`Add ${k.label} node`}
              onDragStart={e => { e.dataTransfer.setData(NODE_TYPE_MIME, k.type); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => editor.addNode(k.type)}>
              <span className={`swatch tone-${k.tone}`} aria-hidden="true" />{k.label}
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Outline">
        <h3>Outline</h3>
        {items.length ? <OutlineList items={items} /> : <p className="muted small">No nodes yet.</p>}
      </section>
      <section aria-label="Checks">
        <h3>Checks {checks.length > 0 && <span className={`badge ${warnings ? "warn" : "info"}`}>{checks.length}</span>}</h3>
        {checks.length === 0 ? <p className="muted small">No findings.</p> : (
          <ul className="psp-checks">
            {checks.map((c, i) => (
              <li key={i} className={c.level}>
                <button type="button" onClick={() => editor.openScope(c.scope, c.edge ? { kind: "edge", key: c.edge } : c.node ? { kind: "node", key: c.node } : null)}>{c.message}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function OutlineList({ items }: { items: OutlineItem[] }) {
  const editor = useEditor();
  const here = editor.scope.join("/");
  return (
    <ul className="psp-outline">
      {items.map(item => {
        const selected = item.scope.join("/") === here && editor.selection?.kind === "node" && editor.selection.key === item.key;
        const open = [...item.scope, item.key].join("/") === here;
        return (
          <li key={item.key}>
            <button type="button" className={selected ? "selected" : open ? "open" : undefined} aria-current={selected ? "true" : undefined}
              onClick={() => editor.openScope(item.scope, { kind: "node", key: item.key })}
              onDoubleClick={() => { if (item.children.length) editor.openScope([...item.scope, item.key]); }}>
              <span className={`swatch tone-${kindOf(item.nodeType).tone}`} aria-hidden="true" />{item.key}
            </button>
            {item.children.length > 0 && <OutlineList items={item.children} />}
          </li>
        );
      })}
    </ul>
  );
}
