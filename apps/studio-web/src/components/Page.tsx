// SPDX-License-Identifier: Apache-2.0
import { useEffect, type ReactNode } from "react";
import { Link, useLeaveGuard } from "../router";

export interface Crumb { label: string; to?: string }

export function PageHeader({ crumbs, title, subtitle, badge, actions }: { crumbs?: Crumb[]; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}{i < crumbs.length - 1 && <span className="sep" aria-hidden="true">/</span>}</span>
          ))}
        </nav>
      )}
      <div className="title-row">
        <h1>{title}</h1>
        {badge}
        <span className="spacer" />
        <div className="actions">{actions}</div>
      </div>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </header>
  );
}

/** A list route: header plus one grid filling the rest of the page. */
export function ListPage({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <div className="page list"><PageHeader title={title} subtitle={subtitle} actions={actions} />{children}</div>;
}

export interface EditorFrameProps {
  className?: string;
  crumbs: Crumb[];
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  dirty: boolean;
  saving: boolean;
  isNew?: boolean;
  error?: string | null;
  onSave(): void;
  onRevert(): void;
  onDelete?: (() => void) | undefined;
  deleteLabel?: string;
  deletePrompt?: string;
  actions?: ReactNode;
  children: ReactNode;
}
/** A record route: breadcrumb, save/revert/delete, unsaved-change guard and Ctrl+S. */
export function EditorFrame(props: EditorFrameProps) {
  const { crumbs, title, subtitle, badge, dirty, saving, isNew, error, onSave, onRevert, onDelete, deleteLabel = "Delete", deletePrompt, actions, children, className } = props;
  useLeaveGuard(dirty);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if ((dirty || isNew) && !saving) onSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, isNew, saving, onSave]);
  return (
    <div className={`page editor${className ? ` ${className}` : ""}`}>
      <PageHeader crumbs={crumbs} title={title} subtitle={subtitle}
        badge={<>{badge}{isNew ? <span className="badge info">new</span> : dirty ? <span className="badge warn">unsaved</span> : null}</>}
        actions={<>
          {actions}
          {onDelete && !isNew && <button type="button" className="danger" disabled={saving} onClick={() => { if (window.confirm(deletePrompt ?? "Delete this record?")) onDelete(); }}>{deleteLabel}</button>}
          <button type="button" onClick={onRevert} disabled={!dirty || saving}>Revert</button>
          <button type="button" className="primary" onClick={onSave} disabled={(!dirty && !isNew) || saving}>{saving ? "Saving…" : isNew ? "Create" : "Save"}</button>
        </>} />
      {error && <Notice kind="error">{error}</Notice>}
      {children}
    </div>
  );
}

export interface TabDef { id: string; label: ReactNode; hidden?: boolean }
export function Tabs({ tabs, active, onSelect, label }: { tabs: TabDef[]; active: string; onSelect(id: string): void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.filter(t => !t.hidden).map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} className={t.id === active ? "active" : undefined} onClick={() => onSelect(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}
/** Tabs that are separate routes, so each tab is linkable and back/forward moves between them. */
export function RouteTabs({ tabs, active, label }: { tabs: { id: string; label: ReactNode; to: string }[]; active: string; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(t => <Link key={t.id} to={t.to} role="tab" aria-selected={t.id === active} className={t.id === active ? "active" : undefined}>{t.label}</Link>)}
    </div>
  );
}

export function Section({ title, actions, children, description }: { title: string; actions?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="section" aria-label={title}>
      <div className="section-head"><h2>{title}</h2><span className="spacer" />{actions}</div>
      {description && <p className="subtitle">{description}</p>}
      {children}
    </section>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v]) => <div key={k} className="kv-row"><dt>{k}</dt><dd>{v === null || v === undefined || v === "" ? <span className="muted">none</span> : v}</dd></div>)}</dl>;
}
export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
export function Notice({ kind, children }: { kind: "error" | "warn" | "info"; children: ReactNode }) {
  return <div className={`notice-box ${kind}`} role={kind === "error" ? "alert" : "note"}>{children}</div>;
}
export function NotFound({ what, back }: { what: string; back?: Crumb }) {
  return (
    <div className="page">
      <PageHeader title={`${what} not found`} />
      <p>{back?.to ? <Link to={back.to}>Back to {back.label}</Link> : <Link to="/runs">Back to runs</Link>}</p>
    </div>
  );
}
export function Loading() { return <div className="page"><p className="muted">Loading…</p></div>; }

export function StatusBadge({ status }: { status: string }) {
  const kind = status === "completed" || status === "OK" || status === "configured" || status === "accepted" ? "success"
    : status === "failed" ? "error" : status === "cancelled" || status === "cancelling" || status === "rejected" ? "warn"
    : status === "running" || status === "queued" || status === "preparing" ? "active" : /^[A-Z_]+$/.test(status) ? "error" : "info";
  return <span className={`badge ${kind}`}>{status}</span>;
}
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${severity === "info" ? "info" : severity}`}>{severity}</span>;
}