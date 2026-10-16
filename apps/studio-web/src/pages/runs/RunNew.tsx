// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { PreparedRun } from "@psp-cdl/studio-core";
import { Checkbox, Field, FormGrid, Select, TextInput } from "../../components/fields";
import { JsonBlock, KeyValue, Notice, PageHeader, Section } from "../../components/Page";
import { useStudio } from "../../data";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { ENGINE_LABELS, scenarioDetail } from "../../lib/scenarioOps";
import { href, Link, navigate, useLocation } from "../../router";

/** Prepare first, then start. A live run must repeat the admission digest the preview returned. */
export function RunNew() {
  const { collections, collectionsLoaded, status, upsertRun } = useStudio();
  const location = useLocation();
  const [collectionId, setCollectionId] = useState(location.search.get("collection") ?? "");
  const [scenarioId, setScenarioId] = useState(location.search.get("scenario") ?? "");
  const [label, setLabel] = useState("");
  const [inspect, setInspect] = useState(false);
  const [prepared, setPrepared] = useState<PreparedRun | null>(null);
  const [admission, setAdmission] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collection = collections.find(c => c.id === collectionId) ?? collections[0];
  const scenario = collection?.scenarios.find(s => s.id === scenarioId) ?? collection?.scenarios[0];
  useEffect(() => { setPrepared(null); setAdmission(""); setError(null); }, [collection?.id, scenario?.id]);

  const prepare = async () => {
    if (!collection || !scenario) return;
    setBusy(true); setError(null);
    try { setPrepared(await api.prepare(collection.id, scenario.id)); } catch (e) { setPrepared(null); setError(errorText(e)); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!collection || !scenario || !prepared) return;
    setBusy(true); setError(null);
    try {
      const record = await api.start({ collectionId: collection.id, scenarioId: scenario.id, ...(label.trim() ? { label: label.trim() } : {}), ...(inspect ? { inspect: true } : {}), ...(prepared.admissionDigest ? { admissionDigest: admission.trim() } : {}) });
      upsertRun(record);
      navigate(href("runs", record.runId), { force: true });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const needsAdmission = !!prepared?.admissionDigest;
  const admitted = !needsAdmission || admission.trim() === prepared?.admissionDigest;

  return (
    <div className="page editor">
      <PageHeader crumbs={[{ label: "Runs", to: "/runs" }, { label: "New run" }]} title="New run"
        subtitle="Choose a scenario, prepare it to see what will run, then start it."
        actions={<>
          <button type="button" onClick={prepare} disabled={!scenario || busy}>Prepare</button>
          <button type="button" className="primary" onClick={start} disabled={!prepared || !admitted || busy}>Start</button>
        </>} />
      {error && <Notice kind="error">{error}</Notice>}
      {collectionsLoaded && !collections.length && <Notice kind="info">No collections yet. <Link to="/collections/new">Create one</Link>.</Notice>}
      <Section title="Scenario">
        <FormGrid>
          <Field label="Collection"><Select value={collection?.id ?? ""} onChange={v => { setCollectionId(v); setScenarioId(""); }} options={collections.map(c => ({ value: c.id, label: c.label }))} /></Field>
          <Field label="Scenario"><Select value={scenario?.id ?? ""} onChange={setScenarioId} options={(collection?.scenarios ?? []).map(s => ({ value: s.id, label: `${s.label} (${s.kind})` }))} /></Field>
          <Field label="Run label" hint="Optional. Defaults to the scenario label."><TextInput value={label} onChange={setLabel} placeholder={scenario?.label ?? ""} /></Field>
          {status?.inspectAllowed && <Field label="Inspect" hint="Attaches model-visible payloads (messages, tool data, state) to events. Keep local."><Checkbox checked={inspect} onChange={setInspect} label="Attach model-visible payloads" /></Field>}
        </FormGrid>
        {scenario && collection && (
          <KeyValue items={[
            ["Engine", ENGINE_LABELS[scenario.kind]],
            ["Configuration", scenarioDetail(scenario)],
            ...(scenario.kind === "live-loop" ? [["Turns", String(scenario.turns.length)] as [string, string]] : []),
            ["Edit", <Link to={href("collections", collection.id, "scenarios", scenario.id)}>Open scenario editor</Link>]
          ]} />
        )}
      </Section>
      {prepared && (
        <Section title="Preview" description="Nothing has run yet. The engine built its harness, or ran its own prepare step, and reported what it will do.">
          <div aria-label="Preview">
            {prepared.warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
            {needsAdmission && (
              <Field label="Admission digest" hint={<>This run calls a live provider or spends budget. Repeat the digest to admit it: <code className="digest">{prepared.admissionDigest}</code></>}>
                <TextInput value={admission} onChange={setAdmission} placeholder="admission digest" />
              </Field>
            )}
            <JsonBlock value={prepared.preview} />
          </div>
        </Section>
      )}
    </div>
  );
}