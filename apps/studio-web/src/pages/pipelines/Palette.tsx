// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { FILTER_KINDS, kindInfo, primaryProxy, terminals, filtersOf } from "@psp-cdl/studio-core";
import { PALETTE_MIME, type DragItem, type DropIntent } from "../../pipeline/drop";
import { usePipelineEditor } from "../../pipeline/store";
import { commitDrop } from "./Canvas";

interface Item extends DragItem { note: string; description: string; disabled?: boolean }
interface Group { title: string; items: Item[] }

function groups(placed: { model: boolean; initiator: boolean; proxy: boolean; psp: boolean }): Group[] {
  const k = (kind: string) => kindInfo(kind)!;
  return [
    { title: "Ring · splices into a path", items: [{ role: "ring", kind: "llmproxy", label: "LLMProxy", note: placed.proxy ? "placed" : "both sides", description: k("llmproxy").description, disabled: placed.proxy }] },
    { title: "Bootstrap · attaches to LLMProxy", items: [
      { role: "bootstrap", kind: "psp-document", label: "PSP Document", note: placed.psp ? "attached" : "1 / session", description: "A signed .psp or .pspx, resolved once per session. Referenced, never edited here." },
      { role: "bootstrap", kind: "psp-context", label: "PSP Context", note: "auto", description: "Session state, created with the document.", disabled: true }
    ] },
    { title: "Filters · drop into an LLMProxy half", items: FILTER_KINDS.map(f => ({ role: "filter" as const, kind: f.kind, label: f.label, note: f.supported ? f.side : `${f.side} · unsupported`, description: `${f.description} ${f.reference}` })) },
    { title: "Loop · attached to the turn", items: [{ role: "loop", kind: "mcpproxy", label: "MCPProxy", note: "+ backend", description: k("mcpproxy").description }] },
    { title: "Auxiliary · off LLMProxy", items: ["vector-store", "logger", "otel"].map(kind => ({ role: "aux" as const, kind, label: k(kind).label, note: kind === "vector-store" ? "PSP-EXFIL-0.1" : kind === "otel" ? "unsupported" : "observe", description: k(kind).description })) },
    { title: "Terminals & backends", items: [
      { role: "terminal", kind: "model", label: "Model", note: placed.model ? "placed" : "add", description: k("model").description, disabled: placed.model },
      { role: "terminal", kind: "initiator", label: "Initiator", note: placed.initiator ? "placed" : "add", description: k("initiator").description, disabled: placed.initiator },
      { role: "terminal", kind: "mcp-server", label: "MCP Server", note: "backend", description: "Comes with each MCPProxy; set its URL on the proxy's Backend tab.", disabled: true }
    ] }
  ];
}

/** Left panel: components by role. Drag one onto the canvas, or click to place it where it belongs. */
export function Palette() {
  const config = usePipelineEditor(s => s.config)!;
  const [query, setQuery] = useState("");
  const { model, initiator } = terminals(config);
  const proxy = primaryProxy(config);
  const store = usePipelineEditor.getState;
  const list = groups({ model: !!model, initiator: !!initiator, proxy: !!proxy, psp: !!config.psp })
    .map(g => ({ ...g, items: g.items.filter(i => !query.trim() || `${i.label} ${i.kind} ${i.note}`.toLowerCase().includes(query.trim().toLowerCase())) }))
    .filter(g => g.items.length);
  /** Click places the item where a drop would usually put it. */
  const place = (item: Item) => {
    let intent: DropIntent;
    if (item.role === "bootstrap") intent = { kind: "attach-bootstrap" };
    else if (item.role === "ring") intent = initiator && model ? { kind: "splice", edge: [initiator.id, model.id], side: "request" } : { kind: "free", at: { x: 660, y: 300 } };
    else if (item.role === "filter") {
      const side = FILTER_KINDS.find(f => f.kind === item.kind)!.side;
      intent = proxy ? { kind: "slot", componentId: proxy.id, side, index: filtersOf(proxy, side).length } : { kind: "refuse", reason: "Place an LLMProxy first" };
    } else if (item.role === "loop") intent = model ? { kind: "attach-loop", caller: model.id } : { kind: "refuse", reason: "A loop component needs the Model" };
    else if (item.role === "aux") intent = proxy ? { kind: "tap", target: proxy.id, side: "response" } : { kind: "free", at: { x: 1320, y: 300 } };
    else intent = { kind: "free", at: { x: 660, y: 300 } };
    commitDrop(item, intent);
  };
  return (
    <aside className="pl-palette" aria-label="Components">
      <input type="search" placeholder="Search components" aria-label="Search components" value={query} onChange={e => setQuery(e.target.value)} />
      {list.map(g => (
        <section key={g.title} aria-label={g.title}>
          <h3>{g.title}</h3>
          <div className="pl-palette-items">
            {g.items.map(item => (
              <button key={item.kind} type="button" className={`pl-item role-${item.role}`} draggable={!item.disabled} disabled={item.disabled} title={item.description} aria-label={`Add ${item.label}`}
                onDragStart={e => { const { note: _n, description: _d, disabled: _x, ...drag } = item; e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(drag)); e.dataTransfer.effectAllowed = "copy"; store().setDrag({ item: drag }); }}
                onDragEnd={() => store().setDrag(null)}
                onClick={() => place(item)}>
                <span className={`pl-swatch role-${item.role}`} aria-hidden="true" />
                <span className="pl-item-label">{item.label}</span>
                <span className="pl-item-note">{item.note}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}
