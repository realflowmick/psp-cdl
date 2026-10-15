// SPDX-License-Identifier: Apache-2.0
import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useSessionState } from "../lib/session";

export type CellValue = string | number | boolean | null | undefined;
export interface Column<T> {
  key: string;
  header: string;
  /** Drives sorting, filtering and the default cell text. */
  value: (row: T) => CellValue;
  render?: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
}
export interface GridSort { key: string; dir: "asc" | "desc" }
export interface DataGridProps<T> {
  /** Persistence key: sort, filter, page and selection survive a trip to the editor and back. */
  id: string;
  label: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  /** Double-click, Enter or the Open button. Usually navigates to the record's editor route. */
  onOpen?: (row: T) => void;
  openLabel?: string;
  actions?: (selected: T | undefined) => ReactNode;
  filters?: ReactNode;
  emptyMessage?: ReactNode;
  loading?: boolean | undefined;
  pageSize?: number;
  initialSort?: GridSort;
  rowClassName?: (row: T) => string | undefined;
  /** Keep the newest rows in view while they stream in, unless the user scrolled away. */
  follow?: boolean | undefined;
  /** Controlled selection, for callers that move rows and want the selection to follow. */
  selected?: string | null;
  onSelectedChange?: (key: string | null) => void;
  /** Fill the remaining page height (list pages) instead of sizing to content (editor sections). */
  fill?: boolean;
}

const blank = (v: CellValue): boolean => v === null || v === undefined || v === "";
function compare(a: CellValue, b: CellValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}
const display = (v: CellValue): string => v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "") : String(v);

/** The base view for every collection of records in the studio. Click selects; double-click or Enter opens. */
export function DataGrid<T>(props: DataGridProps<T>) {
  const { id, label, rows, columns, rowKey, onOpen, openLabel = "Open", actions, filters, emptyMessage, loading, pageSize = 100, initialSort, rowClassName, follow, fill, selected: controlledKey, onSelectedChange } = props;
  const [sort, setSort] = useSessionState<GridSort | null>(`grid:${id}:sort`, initialSort ?? null);
  const [filter, setFilter] = useSessionState(`grid:${id}:filter`, "");
  const [page, setPage] = useSessionState(`grid:${id}:page`, 0);
  const [storedKey, setStoredKey] = useSessionState<string | null>(`grid:${id}:selected`, null);
  const selectedKey = controlledKey !== undefined ? controlledKey : storedKey;
  const setSelectedKey = (key: string | null) => { if (onSelectedChange) onSelectedChange(key); if (controlledKey === undefined) setStoredKey(key); };
  const scroller = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pinnedToBottom = useRef(true);

  const filtered = useMemo(() => {
    const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [...rows];
    return rows.filter(row => {
      const haystack = columns.map(c => display(c.value(row))).join("\u0000").toLowerCase();
      return terms.every(t => haystack.includes(t));
    });
  }, [rows, columns, filter]);
  const sorted = useMemo(() => {
    const column = sort && columns.find(c => c.key === sort.key);
    if (!column) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.map((row, index) => ({ row, index, value: column.value(row) }))
      .sort((a, b) => {
        if (blank(a.value) || blank(b.value)) return (Number(blank(a.value)) - Number(blank(b.value))) || a.index - b.index;
        return dir * compare(a.value, b.value) || a.index - b.index;
      })
      .map(x => x.row);
  }, [filtered, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize);
  const selectedIndex = selectedKey === null ? -1 : sorted.findIndex(r => rowKey(r) === selectedKey);
  const selected = selectedIndex >= 0 ? sorted[selectedIndex] : undefined;

  const previousPages = useRef(pages);
  useEffect(() => {
    if (follow && pinnedToBottom.current && current === previousPages.current - 1 && pages > previousPages.current) setPage(pages - 1);
    previousPages.current = pages;
  }, [follow, pages, current, setPage]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [follow, visible.length]);
  useEffect(() => {
    if (selectedKey !== null) rowRefs.current.get(selectedKey)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedKey]);

  const select = (index: number) => {
    if (!sorted.length) return;
    const i = Math.max(0, Math.min(sorted.length - 1, index));
    setSelectedKey(rowKey(sorted[i]!));
    const target = Math.floor(i / pageSize);
    if (target !== current) setPage(target);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const start = selectedIndex < 0 ? current * pageSize - 1 : selectedIndex;
    const moves: Record<string, () => void> = {
      ArrowDown: () => select(start + 1), ArrowUp: () => select(selectedIndex < 0 ? current * pageSize : start - 1),
      PageDown: () => select(start + 10), PageUp: () => select(start - 10),
      Home: () => select(0), End: () => select(sorted.length - 1),
      Enter: () => { if (selected && onOpen) onOpen(selected); }
    };
    const move = moves[event.key];
    if (move) { event.preventDefault(); move(); }
  };
  const toggleSort = (key: string) => setSort(s => !s || s.key !== key ? { key, dir: "asc" } : { key, dir: s.dir === "asc" ? "desc" : "asc" });
  const count = filtered.length === rows.length ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}` : `${filtered.length} of ${rows.length} rows`;

  return (
    <div className={`grid${fill ? " fill" : ""}`}>
      <div className="grid-toolbar" role="toolbar" aria-label={`${label} toolbar`}>
        <input type="search" className="grid-filter" aria-label={`Filter ${label}`} placeholder="Filter…" value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0); }} />
        {filters}
        <span className="grid-count">{count}</span>
        <span className="spacer" />
        {actions?.(selected)}
        {onOpen && <button type="button" disabled={!selected} onClick={() => selected && onOpen(selected)}>{openLabel}</button>}
      </div>
      <div className="grid-scroll" ref={scroller}
        onScroll={e => { const el = e.currentTarget; pinnedToBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8; }}>
        <table role="grid" aria-label={label} aria-rowcount={sorted.length + 1} tabIndex={0} onKeyDown={onKeyDown}>
          <colgroup>{columns.map(c => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
          <thead>
            <tr>
              {columns.map(c => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" style={{ textAlign: c.align ?? "left" }} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
                    {c.sortable === false ? c.header : (
                      <button type="button" className="sort" onClick={() => toggleSort(c.key)}>
                        {c.header}<span className="sort-mark" aria-hidden="true">{active ? (sort!.dir === "asc" ? "▲" : "▼") : ""}</span>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const key = rowKey(row);
              return (
                <tr key={key} data-key={key} aria-selected={key === selectedKey}
                  className={[key === selectedKey ? "selected" : "", rowClassName?.(row) ?? ""].join(" ").trim() || undefined}
                  ref={el => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}
                  onClick={() => setSelectedKey(key)} onDoubleClick={() => { setSelectedKey(key); onOpen?.(row); }}>
                  {columns.map(c => <td key={c.key} style={{ textAlign: c.align ?? "left" }}>{c.render ? c.render(row) : display(c.value(row))}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && <div className="grid-empty">{loading ? "Loading…" : filter.trim() ? "No rows match the filter." : emptyMessage ?? "Nothing here yet."}</div>}
      </div>
      {pages > 1 && (
        <div className="grid-pager" aria-label={`${label} pages`}>
          <button type="button" onClick={() => setPage(0)} disabled={current === 0} aria-label="First page">«</button>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">‹</button>
          <span>Page {current + 1} of {pages}</span>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page">›</button>
          <button type="button" onClick={() => setPage(pages - 1)} disabled={current >= pages - 1} aria-label="Last page">»</button>
        </div>
      )}
    </div>
  );
}