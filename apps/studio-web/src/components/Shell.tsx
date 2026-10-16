// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import { Link, useLocation } from "../router";
import { useLocalState } from "../lib/session";
import { useStudio } from "../data";

interface NavItem { to: string; label: string; active: (pathname: string) => boolean }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Run", items: [
    { to: "/runs", label: "Runs", active: p => p === "/runs" || (p.startsWith("/runs/") && p !== "/runs/new") },
    { to: "/runs/new", label: "New run", active: p => p === "/runs/new" }
  ] },
  { group: "Design", items: [
    { to: "/psp", label: "PSP applications", active: p => p.startsWith("/psp") },
    { to: "/pipelines", label: "Pipelines", active: p => p.startsWith("/pipelines") },
    { to: "/scenarios", label: "Scenarios", active: p => p === "/scenarios" || /^\/collections\/[^/]+\/scenarios(\/|$)/.test(p) },
    { to: "/collections", label: "Collections", active: p => p === "/collections" || /^\/collections\/[^/]+$/.test(p) },
    { to: "/workspace", label: "Workspace files", active: p => p.startsWith("/workspace") }
  ] },
  { group: "Settings", items: [
    { to: "/secrets", label: "Secrets", active: p => p.startsWith("/secrets") },
    { to: "/server", label: "Server", active: p => p === "/server" }
  ] }
];
const narrow = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 900px)").matches;

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useLocalState("nav-open", !narrow());
  const { pathname } = useLocation();
  const { status, connected, error, dismiss } = useStudio();
  return (
    <div className={`shell ${open ? "nav-open" : "nav-closed"}`}>
      <header className="appbar">
        <button type="button" className="hamburger" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="sidenav" onClick={() => setOpen(!open)}>
          <span /><span /><span />
        </button>
        <Link to="/runs" className="brand">PSP Studio</Link>
        <span className={`conn ${status && connected ? "ok" : "down"}`} title={status ? `${status.profile} ${status.version}` : "Not connected"}>
          {status ? (connected ? "connected" : "reconnecting") : "connecting"}
        </span>
        {status?.inspectAllowed && <span className="badge warn" title="Runs may attach model-visible payloads to events">inspect allowed</span>}
        <span className="spacer" />
        <span className="notice">{status?.notice ?? "Development tooling."}</span>
      </header>
      {open && (
        <nav id="sidenav" className="sidenav" aria-label="Main">
          {NAV.map(group => (
            <div key={group.group} className="nav-group">
              <div className="nav-heading">{group.group}</div>
              {group.items.map(item => (
                <Link key={item.to} to={item.to} className={item.active(pathname) ? "active" : undefined} aria-current={item.active(pathname) ? "page" : undefined}
                  onClick={() => { if (narrow()) setOpen(false); }}>{item.label}</Link>
              ))}
            </div>
          ))}
        </nav>
      )}
      {open && <div className="nav-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <main className="content">
        {error && <div className="banner" role="alert"><span>{error}</span><button type="button" onClick={dismiss}>Dismiss</button></div>}
        {children}
      </main>
    </div>
  );
}