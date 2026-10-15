// SPDX-License-Identifier: Apache-2.0
import { Fragment, useEffect, type ReactNode } from "react";
import { Shell } from "./components/Shell";
import { StudioProvider } from "./data";
import { matchPath, navigate, useLocation } from "./router";
import { EventDetail, RunTurnDetail } from "./pages/runs/EventDetail";
import { RunDetail } from "./pages/runs/RunDetail";
import { RunNew } from "./pages/runs/RunNew";
import { RunsList } from "./pages/runs/RunsList";
import { CollectionEditor } from "./pages/scenarios/CollectionEditor";
import { ToolEditor, TurnEditor } from "./pages/scenarios/RecordEditors";
import { ScenarioEditor } from "./pages/scenarios/ScenarioEditor";
import { CollectionsList, ScenariosList } from "./pages/scenarios/ScenariosList";
import { SecretEditor, SecretsList, ServerPage } from "./pages/settings/SettingsPages";
import { FileEditor, FilesList } from "./pages/workspace/WorkspacePages";
import { PspEditor, PspList, PspNew } from "./pages/psp/PspPages";
import { AssistantHistory, AssistantRecordPage } from "./pages/psp/AssistantPages";
import { PipelineEditorPage, PipelinesList } from "./pages/pipelines/PipelinesList";
import { NotFound } from "./components/Page";

type Params = Record<string, string>;
/** Every list is a grid route; every record opened from a grid has its own route. Order matters: literals before params. */
export const ROUTES: [string, (p: Params) => ReactNode][] = [
  ["/", () => <Redirect to="/runs" />],
  ["/runs", () => <RunsList />],
  ["/runs/new", () => <RunNew />],
  ["/runs/:id", p => <RunDetail runId={p.id!} tab="overview" />],
  ["/runs/:id/events", p => <RunDetail runId={p.id!} tab="events" />],
  ["/runs/:id/turns", p => <RunDetail runId={p.id!} tab="turns" />],
  ["/runs/:id/events/:seq", p => <EventDetail runId={p.id!} seq={Number(p.seq)} />],
  ["/runs/:id/turns/:turn", p => <RunTurnDetail runId={p.id!} turn={Number(p.turn)} />],
  ["/psp", () => <PspList />],
  ["/psp/new", () => <PspNew />],
  ["/psp/assistant", () => <AssistantHistory />],
  ["/psp/assistant/:id", p => <AssistantRecordPage id={p.id!} />],
  ["/psp/files/*path", p => <PspEditor path={p.path!} />],
  ["/pipelines", () => <PipelinesList />],
  ["/pipelines/:id", p => <PipelineEditorPage id={p.id!} />],
  ["/scenarios", () => <ScenariosList />],
  ["/collections", () => <CollectionsList />],
  ["/collections/new", () => <CollectionEditor id={null} />],
  ["/collections/:cid", p => <CollectionEditor id={p.cid!} />],
  ["/collections/:cid/scenarios", p => <Redirect to={`/collections/${encodeURIComponent(p.cid!)}`} />],
  ["/collections/:cid/scenarios/new", p => <ScenarioEditor cid={p.cid!} sid={null} />],
  ["/collections/:cid/scenarios/:sid", p => <ScenarioEditor cid={p.cid!} sid={p.sid!} />],
  ["/collections/:cid/scenarios/:sid/turns/new", p => <TurnEditor cid={p.cid!} sid={p.sid!} turn={null} />],
  ["/collections/:cid/scenarios/:sid/turns/:turn", p => <TurnEditor cid={p.cid!} sid={p.sid!} turn={Number(p.turn)} />],
  ["/collections/:cid/scenarios/:sid/tools/new", p => <ToolEditor cid={p.cid!} sid={p.sid!} tool={null} />],
  ["/collections/:cid/scenarios/:sid/tools/:tool", p => <ToolEditor cid={p.cid!} sid={p.sid!} tool={p.tool!} />],
  ["/workspace", () => <FilesList />],
  ["/workspace/new", () => <FileEditor path={null} />],
  ["/workspace/files/*path", p => <FileEditor path={p.path!} />],
  ["/secrets", () => <SecretsList />],
  ["/secrets/:name", p => <SecretEditor name={p.name!} />],
  ["/server", () => <ServerPage />]
];

function Redirect({ to }: { to: string }) {
  useEffect(() => { navigate(to, { replace: true, force: true }); }, [to]);
  return null;
}

function Routes() {
  const { pathname } = useLocation();
  for (const [pattern, render] of ROUTES) {
    const params = matchPath(pattern, pathname);
    if (!params) continue;
    const invalidNumber = (params.seq !== undefined && !Number.isSafeInteger(Number(params.seq))) || (params.turn !== undefined && !Number.isSafeInteger(Number(params.turn)));
    if (invalidNumber) break;
    // Keyed by route and params: opening another record remounts the editor with a fresh draft.
    return <Fragment key={`${pattern}:${JSON.stringify(params)}`}>{render(params)}</Fragment>;
  }
  return <NotFound what="Page" />;
}

export function App() {
  return (
    <StudioProvider>
      <Shell><Routes /></Shell>
    </StudioProvider>
  );
}
