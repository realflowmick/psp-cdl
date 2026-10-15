// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

/**
 * A deliberately small History API router. Every record has a route; editors register leave guards
 * so navigation away from unsaved work asks first. No dependency, and the studio server's index
 * fallback makes deep links work when the bundle is served statically.
 */
type Guard = () => boolean;
const listeners = new Set<() => void>();
const guards = new Set<Guard>();
const here = (): string => window.location.pathname + window.location.search;
let lastPath = typeof window === "undefined" ? "/" : here();

function emit(): void { lastPath = here(); for (const listener of listeners) listener(); }
function allowLeave(): boolean { for (const guard of guards) if (!guard()) return false; return true; }

export interface NavigateOptions { replace?: boolean; force?: boolean }
/** Returns false when a leave guard kept the user on the current page. */
export function navigate(to: string, options: NavigateOptions = {}): boolean {
  if (to === here()) return true;
  if (!options.force && !allowLeave()) return false;
  if (options.replace) window.history.replaceState(null, "", to); else window.history.pushState(null, "", to);
  emit();
  return true;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    // Back and forward cannot be cancelled, so a refused guard restores the page the user was on.
    if (!allowLeave()) { window.history.pushState(null, "", lastPath); return; }
    emit();
  });
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export interface Location { pathname: string; search: URLSearchParams; href: string }
export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, here, () => "/");
  return useMemo(() => {
    const url = new URL(href, "http://studio.local");
    return { pathname: url.pathname, search: url.searchParams, href };
  }, [href]);
}

/** `:name` matches one segment, `*name` the rest of the path. Values are URI-decoded. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean), actual = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.startsWith("*")) {
      if (actual.length <= i) return null;
      params[part.slice(1)] = actual.slice(i).map(decode).join("/");
      return params;
    }
    if (i >= actual.length) return null;
    if (part.startsWith(":")) params[part.slice(1)] = decode(actual[i]!);
    else if (part !== actual[i]) return null;
  }
  return actual.length === parts.length ? params : null;
}
const decode = (segment: string): string => { try { return decodeURIComponent(segment); } catch { return segment; } };

/** Builds a path from raw segments, encoding each one. */
export const href = (...segments: (string | number)[]): string => "/" + segments.map(s => encodeURIComponent(String(s))).join("/");

export function useLeaveGuard(active: boolean, message = "You have unsaved changes. Leave without saving?"): void {
  useEffect(() => {
    if (!active) return;
    const guard: Guard = () => window.confirm(message) === true;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    guards.add(guard);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { guards.delete(guard); window.removeEventListener("beforeunload", beforeUnload); };
  }, [active, message]);
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> { to: string }
export function Link({ to, onClick, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** Merges query parameters into the current URL (null removes one) without remounting or tripping leave guards. */
export function updateQuery(patch: Record<string, string | null>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === null) params.delete(k); else params.set(k, v); }
  const query = params.toString();
  navigate(window.location.pathname + (query ? `?${query}` : ""), { replace: true, force: true });
}

/** Reads and writes one query parameter without remounting the page or tripping leave guards. */
export function useQueryParam(name: string, fallback: string): [string, (value: string) => void] {
  const location = useLocation();
  const value = location.search.get(name) ?? fallback;
  const set = (next: string) => {
    const params = new URLSearchParams(location.search);
    if (next === fallback) params.delete(name); else params.set(name, next);
    const query = params.toString();
    navigate(location.pathname + (query ? `?${query}` : ""), { replace: true, force: true });
  };
  return [value, set];
}