// SPDX-License-Identifier: Apache-2.0
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m ${Math.round(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}
export function runDurationMs(record: { startedAt: string; finishedAt?: string }, now = Date.now()): number {
  const end = record.finishedAt ? Date.parse(record.finishedAt) : now;
  return end - Date.parse(record.startedAt);
}
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
export const truncate = (text: string, max: number): string => text.length > max ? text.slice(0, max - 1) + "…" : text;
/** Deterministic JSON for dirty checks: object keys sorted, so key order never reads as an edit. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : v);
}
export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    const { code, message } = e as { code: string; message: string };
    return message && message !== code ? `${code}: ${message}` : code;
  }
  return e instanceof Error ? e.message : String(e);
}