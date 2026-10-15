// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RunRecord, ScenarioCollection } from "@psp-cdl/studio-core";
import { api, type StudioStatus, type Templates, type WorkspaceFile } from "./lib/api";
import { errorText } from "./lib/format";
import { FALLBACK_TEMPLATES } from "./lib/scenarioOps";
import { studioSocket } from "./lib/socket";

/** Server-backed lists shared by every page. Editors write through `saveCollection` so grids stay current. */
export interface StudioData {
  status: StudioStatus | null;
  connected: boolean;
  templates: Templates;
  collections: ScenarioCollection[];
  collectionsLoaded: boolean;
  runs: RunRecord[];
  runsLoaded: boolean;
  files: WorkspaceFile[];
  filesLoaded: boolean;
  error: string | null;
  report(e: unknown): void;
  dismiss(): void;
  refreshCollections(): Promise<void>;
  refreshRuns(): Promise<void>;
  refreshFiles(): Promise<void>;
  saveCollection(collection: ScenarioCollection): Promise<ScenarioCollection>;
  deleteCollection(id: string): Promise<void>;
  upsertRun(record: RunRecord): void;
}
const StudioContext = createContext<StudioData | null>(null);
export function useStudio(): StudioData {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio needs a StudioProvider");
  return value;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [templates, setTemplates] = useState<Templates>(FALLBACK_TEMPLATES);
  const [collections, setCollections] = useState<ScenarioCollection[]>([]);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = useCallback((e: unknown) => setError(errorText(e)), []);
  const refreshCollections = useCallback(() => api.collections().then(c => { setCollections(c); setCollectionsLoaded(true); }).catch(report), [report]);
  const refreshRuns = useCallback(() => api.runs().then(r => { setRuns(r); setRunsLoaded(true); }).catch(report), [report]);
  const refreshFiles = useCallback(() => api.files().then(r => { setFiles(r.files); setFilesLoaded(true); }).catch(report), [report]);
  const upsertRun = useCallback((record: RunRecord) => setRuns(current => {
    const index = current.findIndex(r => r.runId === record.runId);
    if (index < 0) return [record, ...current];
    const next = [...current]; next[index] = record; return next;
  }), []);

  useEffect(() => {
    // The dev proxy answers 502 until the backend listens; retry quietly instead of stranding the page.
    let timer: ReturnType<typeof setTimeout> | undefined, cancelled = false;
    const connect = () => api.status().then(s => {
      if (cancelled) return;
      setStatus(s); setError(null);
      void refreshCollections(); void refreshRuns(); void refreshFiles();
      api.templates().then(t => { if (!cancelled) setTemplates(t); }).catch(() => { /* older server: fallbacks apply */ });
    }).catch(e => {
      if (cancelled) return;
      setError(`${errorText(e)} (retrying)`);
      timer = setTimeout(connect, 3000);
    });
    void connect();
    const socket = studioSocket();
    const onConnect = () => setConnected(true), onDisconnect = () => setConnected(false);
    socket.on("run", upsertRun); socket.on("connect", onConnect); socket.on("disconnect", onDisconnect);
    return () => { cancelled = true; if (timer) clearTimeout(timer); socket.off("run", upsertRun); socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); };
  }, [refreshCollections, refreshRuns, refreshFiles, upsertRun]);

  const saveCollection = useCallback(async (collection: ScenarioCollection) => {
    const stored = await api.putCollection(collection);
    setCollections(current => {
      const index = current.findIndex(c => c.id === stored.id);
      if (index < 0) return [...current, stored].sort((a, b) => a.id < b.id ? -1 : 1);
      const next = [...current]; next[index] = stored; return next;
    });
    return stored;
  }, []);
  const deleteCollection = useCallback(async (id: string) => {
    await api.deleteCollection(id);
    setCollections(current => current.filter(c => c.id !== id));
  }, []);

  const value = useMemo<StudioData>(() => ({
    status, connected, templates, collections, collectionsLoaded, runs, runsLoaded, files, filesLoaded, error,
    report, dismiss: () => setError(null), refreshCollections, refreshRuns, refreshFiles, saveCollection, deleteCollection, upsertRun
  }), [status, connected, templates, collections, collectionsLoaded, runs, runsLoaded, files, filesLoaded, error, report, refreshCollections, refreshRuns, refreshFiles, saveCollection, deleteCollection, upsertRun]);
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}