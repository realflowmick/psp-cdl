// SPDX-License-Identifier: Apache-2.0
/**
 * Diagram positions live in a sidecar file under `.studio/layouts/`, never in the PSP text, so
 * layout never becomes model-visible content. The workspace grid hides dot folders.
 */
export interface Point { x: number; y: number }
/** Positions per scope (node keys joined by "/", "" for the document) and node key. */
export type Layout = Record<string, Record<string, Point>>;
export const LAYOUT_PROFILE = "PSP-STUDIO-LAYOUT-0.1";
export const layoutPath = (file: string): string => `.studio/layouts/${file}.json`;
export const scopeId = (scope: readonly string[]): string => scope.join("/");

export const COLUMN = 300, ROW = 150;

export function parseLayout(text: string | null): Layout {
  if (!text) return {};
  try {
    const value = JSON.parse(text) as { scopes?: unknown };
    const layout: Layout = {};
    if (!value || typeof value.scopes !== "object" || value.scopes === null) return {};
    for (const [scope, nodes] of Object.entries(value.scopes as Record<string, unknown>)) {
      if (!nodes || typeof nodes !== "object") continue;
      const positions: Record<string, Point> = {};
      for (const [key, p] of Object.entries(nodes as Record<string, unknown>)) {
        if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) positions[key] = { x: p[0] as number, y: p[1] as number };
      }
      layout[scope] = positions;
    }
    return layout;
  } catch { return {}; }
}
/** Stable text: sorted keys and whole-pixel positions, so saving an unchanged layout is a no-op. */
export function serializeLayout(layout: Layout): string {
  const scopes: Record<string, Record<string, [number, number]>> = {};
  for (const scope of Object.keys(layout).sort()) {
    const nodes = layout[scope]!, keys = Object.keys(nodes).sort();
    if (!keys.length) continue;
    scopes[scope] = Object.fromEntries(keys.map(k => [k, [Math.round(nodes[k]!.x), Math.round(nodes[k]!.y)]]));
  }
  return JSON.stringify({ profile: LAYOUT_PROFILE, scopes }, null, 2) + "\n";
}

/**
 * Layered placement: columns by breadth-first distance from the entry node along transitions,
 * nodes no transition reaches in a final column. Purely visual; it implies no execution order.
 */
export function autoLayout(nodes: readonly string[], edges: readonly { source: string; target: string }[]): Record<string, Point> {
  const layer = new Map<string, number>();
  const order: string[] = [];
  const visit = (start: string) => {
    if (layer.has(start)) return;
    layer.set(start, layer.size ? Math.max(...layer.values()) + 1 : 0);
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q]!;
      order.push(at);
      for (const e of edges) if (e.source === at && nodes.includes(e.target) && !layer.has(e.target)) { layer.set(e.target, layer.get(at)! + 1); queue.push(e.target); }
    }
  };
  if (nodes[0] !== undefined) visit(nodes[0]);
  const unreached = nodes.filter(n => !layer.has(n));
  const last = layer.size ? Math.max(...layer.values()) + 1 : 0;
  for (const n of unreached) { layer.set(n, last); order.push(n); }
  const columns = new Map<number, string[]>();
  for (const n of order) (columns.get(layer.get(n)!) ?? columns.set(layer.get(n)!, []).get(layer.get(n)!)!).push(n);
  const tallest = Math.max(1, ...[...columns.values()].map(c => c.length));
  const positions: Record<string, Point> = {};
  for (const [column, members] of columns) {
    const offset = ((tallest - members.length) * ROW) / 2;
    members.forEach((n, row) => { positions[n] = { x: column * COLUMN, y: offset + row * ROW }; });
  }
  return positions;
}
/** Stored positions where present; auto-layout fills in nodes that have none. */
export function positionsFor(stored: Record<string, Point> | undefined, nodes: readonly string[], edges: readonly { source: string; target: string }[]): Record<string, Point> {
  const known = stored ?? {};
  if (nodes.every(n => known[n])) return Object.fromEntries(nodes.map(n => [n, known[n]!]));
  const auto = autoLayout(nodes, edges);
  const placed = nodes.filter(n => known[n]);
  // New nodes go below everything already placed so they never land on top of an existing card.
  const floor = placed.length ? Math.max(...placed.map(n => known[n]!.y)) + ROW : 0;
  let next = 0;
  return Object.fromEntries(nodes.map(n => [n, known[n] ?? (placed.length ? { x: next++ * COLUMN, y: floor } : auto[n]!)]));
}
