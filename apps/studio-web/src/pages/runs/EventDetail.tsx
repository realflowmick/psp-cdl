// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo } from "react";
import { JsonBlock, KeyValue, Loading, Notice, NotFound, PageHeader, Section, SeverityBadge } from "../../components/Page";
import { formatTime, oneLine } from "../../lib/format";
import { deriveTurns, eventSummary } from "../../lib/stream";
import { href, Link, navigate } from "../../router";
import { RunEventsGrid, runCrumbs, useRun } from "./RunDetail";

export function EventDetail({ runId, seq }: { runId: string; seq: number }) {
  const { record, missing, events, replayed } = useRun(runId);
  const index = events.findIndex(e => e.seq === seq);
  const event = index >= 0 ? events[index] : undefined;
  const prev = index > 0 ? events[index - 1] : undefined, next = index >= 0 ? events[index + 1] : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft" && prev) navigate(href("runs", runId, "events", prev.seq), { replace: true });
      if (e.key === "ArrowRight" && next) navigate(href("runs", runId, "events", next.seq), { replace: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runId, prev, next]);
  if (!record) return missing ? <NotFound what="Run" back={{ label: "runs", to: "/runs" }} /> : <Loading />;
  if (!event) return replayed ? <NotFound what={`Event ${seq}`} back={{ label: "events", to: href("runs", runId, "events") }} /> : <Loading />;
  const { payload, scope, ...data } = event.data as Record<string, unknown>;
  return (
    <div className="page detail">
      <PageHeader crumbs={runCrumbs(record, { label: "Events", to: href("runs", runId, "events") }, { label: `#${seq}` })}
        title={<>{event.type} <span className="muted">#{event.seq}</span></>} badge={<SeverityBadge severity={event.severity} />}
        subtitle={eventSummary(event) || undefined}
        actions={<>
          <button type="button" disabled={!prev} onClick={() => prev && navigate(href("runs", runId, "events", prev.seq), { replace: true })} title="Previous event (←)">‹ Previous</button>
          <button type="button" disabled={!next} onClick={() => next && navigate(href("runs", runId, "events", next.seq), { replace: true })} title="Next event (→)">Next ›</button>
        </>} />
      <div className="columns">
        <Section title="Event">
          <KeyValue items={[
            ["Sequence", String(event.seq)], ["Recorded", formatTime(event.at)], ["Engine", event.engine], ["Source", event.source],
            ["Type", <code>{event.type}</code>], ["Severity", <SeverityBadge severity={event.severity} />],
            ["Turn", event.turn !== undefined ? <Link to={href("runs", runId, "turns", event.turn)}>Turn {event.turn}</Link> : null],
            ["Step", event.step !== undefined ? String(event.step) : null], ["Round", event.round !== undefined ? String(event.round) : null]
          ]} />
        </Section>
        {scope !== undefined && <Section title="Observer scope"><JsonBlock value={scope} /></Section>}
      </div>
      <Section title="Data"><JsonBlock value={data} /></Section>
      {payload !== undefined && (
        <Section title="Model-visible payload">
          <Notice kind="warn">Captured at inspect level. This is material the model saw or produced, including user and application text.</Notice>
          <JsonBlock value={payload} />
        </Section>
      )}
    </div>
  );
}

export function RunTurnDetail({ runId, turn }: { runId: string; turn: number }) {
  const { record, missing, events, replayed } = useRun(runId);
  const turns = useMemo(() => deriveTurns(events), [events]);
  const info = turns.find(t => t.turn === turn);
  const turnEvents = useMemo(() => events.filter(e => e.turn === turn), [events, turn]);
  if (!record) return missing ? <NotFound what="Run" back={{ label: "runs", to: "/runs" }} /> : <Loading />;
  if (!info) return replayed ? <NotFound what={`Turn ${turn}`} back={{ label: "turns", to: href("runs", runId, "turns") }} /> : <Loading />;
  const prev = turns.find(t => t.turn === turn - 1), next = turns.find(t => t.turn === turn + 1);
  return (
    <div className="page detail">
      <PageHeader crumbs={runCrumbs(record, { label: "Turns", to: href("runs", runId, "turns") }, { label: `Turn ${turn}` })}
        title={`Turn ${turn}`} badge={info.code ? <span className={`badge ${info.code === "OK" ? "success" : "error"}`}>{info.code}</span> : <span className="badge active">running</span>}
        actions={<>
          <button type="button" disabled={!prev} onClick={() => prev && navigate(href("runs", runId, "turns", prev.turn), { replace: true })}>‹ Previous turn</button>
          <button type="button" disabled={!next} onClick={() => next && navigate(href("runs", runId, "turns", next.turn), { replace: true })}>Next turn ›</button>
        </>} />
      <Section title="Turn">
        <KeyValue items={[
          ["Request id", info.requestId], ["User message", info.message ? oneLine(info.message) : null],
          ["Outcome", info.code], ["Response", info.text],
          ["Session after turn", info.sessionVersion === null ? null : `version ${info.sessionVersion}, ${info.sessionStatus ?? ""}`],
          ["Events", String(info.events)]
        ]} />
      </Section>
      <Section title="Events in this turn">
        <RunEventsGrid gridId={`run:${runId}:turn:${turn}`} runId={runId} events={turnEvents} loading={!replayed} />
      </Section>
    </div>
  );
}