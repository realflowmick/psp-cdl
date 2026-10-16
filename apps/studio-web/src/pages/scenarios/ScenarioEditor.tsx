// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { ENGINE_KINDS, isIdentifier, type EngineKind, type Scenario } from "@psp-cdl/studio-core";
import { Field, FormGrid, JsonInput, Select, TextArea, TextInput } from "../../components/fields";
import { EditorFrame, Loading, Notice, NotFound, Section, Tabs } from "../../components/Page";
import { useStudio } from "../../data";
import { useDraft } from "../../lib/draft";
import { errorText } from "../../lib/format";
import { applyLoop, ENGINE_LABELS, LOOP_HINTS, replaceScenario, scenarioChecks, templateFor, uniqueId } from "../../lib/scenarioOps";
import { href, navigate, useLocation, useQueryParam } from "../../router";
import { ApplicationTab, CampaignSettings, HeldoutSettings, JointSettings, LimitsTab, PolicyTab, ProviderTab, StudySettings, ToolsTab, TurnsTab } from "./ScenarioForms";

const LIVE_TABS = [
  { id: "general", label: "General" }, { id: "application", label: "Application" }, { id: "provider", label: "Provider" },
  { id: "turns", label: "Turns" }, { id: "tools", label: "Tools" }, { id: "policy", label: "Policy" }, { id: "limits", label: "Limits & plan" }, { id: "json", label: "JSON" }
];
const ENGINE_TABS = [{ id: "general", label: "General" }, { id: "settings", label: "Settings" }, { id: "json", label: "JSON" }];

export function ScenarioEditor({ cid, sid }: { cid: string; sid: string | null }) {
  const { collections, collectionsLoaded, files, templates, saveCollection } = useStudio();
  const location = useLocation();
  const isNew = sid === null;
  const collection = collections.find(c => c.id === cid);
  const existing = sid === null ? undefined : collection?.scenarios.find(s => s.id === sid);
  const requested = location.search.get("kind") as EngineKind | null;
  const template = useMemo<Scenario | undefined>(() => {
    if (!collectionsLoaded || !collection) return undefined;
    if (!isNew) return existing;
    const kind = requested && ENGINE_KINDS.includes(requested) ? requested : "live-loop";
    return templateFor(kind, { id: uniqueId("scenario", collection.scenarios.map(s => s.id)), label: "New scenario" }, templates);
  }, [collectionsLoaded, collection, isNew, existing]); // eslint-disable-line react-hooks/exhaustive-deps
  const { draft, saved, dirty, setDraft, markSaved, revert } = useDraft<Scenario>(template);
  const [tab, setTab] = useQueryParam("tab", "general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonValid, setJsonValid] = useState(true);

  if (!collectionsLoaded) return <Loading />;
  if (!collection) return <NotFound what="Collection" back={{ label: "scenarios", to: "/scenarios" }} />;
  if (!draft) return <NotFound what="Scenario" back={{ label: collection.label, to: href("collections", cid) }} />;
  const originalId = isNew ? null : sid;
  const tabs = draft.kind === "live-loop" ? LIVE_TABS : ENGINE_TABS;
  const activeTab = tabs.some(t => t.id === tab) ? tab : "general";
  const change = (next: Scenario) => setDraft(next);

  const validate = (): string | null => {
    if (!jsonValid) return "Fix the invalid JSON before saving.";
    if (!isIdentifier(draft.id) || draft.id === "new") return "Id must be 1 to 64 letters, digits, dot, dash or underscore, start with a letter or digit, and not be \"new\".";
    if (collection.scenarios.some(s => s.id === draft.id && s.id !== originalId)) return `Another scenario in ${collection.label} already uses id ${draft.id}.`;
    if (!draft.label.trim()) return "Label is required.";
    if (draft.kind === "live-loop") {
      if (!draft.turns.length) return "A live-loop scenario needs at least one turn.";
      if (draft.turns.some(t => !t.message.trim())) return "Every turn needs a user message.";
      if (draft.loop === "context" && draft.interpreter === "none") return "The context loop needs the interpreter instructions.";
    }
    return null;
  };
  const save = async (): Promise<boolean> => {
    const problem = validate();
    if (problem) { setError(problem); return false; }
    setSaving(true); setError(null);
    try {
      const stored = await saveCollection(replaceScenario(collection, originalId, draft));
      markSaved(stored.scenarios.find(s => s.id === draft.id) ?? draft);
      if (draft.id !== originalId) navigate(href("collections", cid, "scenarios", draft.id) + (activeTab !== "general" ? `?tab=${activeTab}` : ""), { replace: true, force: true });
      return true;
    } catch (e) { setError(errorText(e)); return false; } finally { setSaving(false); }
  };
  /** Child records save the stored scenario, so unsaved edits here are saved first. */
  const openChild = async (...segments: string[]) => {
    if (isNew) { setError("Create the scenario before editing its turns and tools."); return; }
    if (dirty) {
      if (!window.confirm("Save changes to this scenario before opening the record?")) return;
      if (!await save()) return;
    }
    navigate(href("collections", cid, "scenarios", draft.id, ...segments), { force: true });
  };
  const run = async () => {
    if (dirty) { if (!window.confirm("Save changes before running?")) return; if (!await save()) return; }
    navigate(`/runs/new?${new URLSearchParams({ collection: cid, scenario: draft.id })}`, { force: true });
  };
  const checks = scenarioChecks(draft);
  const setDescription = (v: string) => {
    const { description: _drop, ...rest } = draft;
    change(v ? { ...draft, description: v } : rest as Scenario);
  };

  return (
    <EditorFrame
      crumbs={[{ label: "Scenarios", to: "/scenarios" }, { label: collection.label, to: href("collections", cid) }, { label: saved?.label ?? draft.label }]}
      title={draft.label || draft.id} subtitle={`${ENGINE_LABELS[draft.kind]} · ${collection.label}`}
      dirty={dirty} saving={saving} isNew={isNew} error={error} onSave={() => void save()} onRevert={() => { revert(); setError(null); }}
      onDelete={async () => {
        try { await saveCollection({ ...collection, scenarios: collection.scenarios.filter(s => s.id !== originalId) }); navigate("/scenarios", { force: true }); }
        catch (e) { setError(errorText(e)); }
      }}
      deletePrompt={`Delete scenario "${draft.label}"? Past runs keep their records.`}
      actions={!isNew && <button type="button" onClick={() => void run()}>Run</button>}>
      {checks.length > 0 && <Notice kind="warn"><strong>Checks</strong><ul>{checks.map(c => <li key={c}>{c}</li>)}</ul></Notice>}
      <Tabs label="Scenario sections" tabs={tabs} active={activeTab} onSelect={setTab} />
      {activeTab === "general" && (
        <Section title="General">
          <FormGrid>
            <Field label="Id" hint="Used in URLs and run records. Renaming keeps past runs under the old id."><TextInput value={draft.id} onChange={v => change({ ...draft, id: v })} /></Field>
            <Field label="Label"><TextInput value={draft.label} onChange={v => change({ ...draft, label: v })} /></Field>
            <Field label="Engine" hint={isNew ? "Changing the engine replaces the configuration with that engine's template." : "Fixed after creation. Create a new scenario for another engine."}>
              {isNew
                ? <Select value={draft.kind} options={ENGINE_KINDS.map(k => ({ value: k, label: ENGINE_LABELS[k] }))} onChange={k => change(templateFor(k, { id: draft.id, label: draft.label, ...(draft.description ? { description: draft.description } : {}) }, templates))} />
                : <TextInput value={ENGINE_LABELS[draft.kind]} readOnly onChange={() => {}} />}
            </Field>
            {draft.kind === "live-loop" && (
              <Field label="Loop" hint={LOOP_HINTS[draft.loop]}>
                <Select value={draft.loop} options={[{ value: "buffered", label: "Buffered" }, { value: "durable", label: "Durable" }, { value: "refreshing", label: "Refreshing" }, { value: "context", label: "Context service" }]} onChange={v => change(applyLoop(draft, v))} />
              </Field>
            )}
            <Field label="Description" wide><TextArea rows={3} value={draft.description ?? ""} onChange={setDescription} /></Field>
          </FormGrid>
        </Section>
      )}
      {draft.kind === "live-loop" && activeTab === "application" && <ApplicationTab s={draft} files={files} onChange={change} />}
      {draft.kind === "live-loop" && activeTab === "provider" && <ProviderTab s={draft} onChange={change} />}
      {draft.kind === "live-loop" && activeTab === "turns" && <TurnsTab s={draft} onChange={change} openChild={(...s) => void openChild(...s)} />}
      {draft.kind === "live-loop" && activeTab === "tools" && <ToolsTab s={draft} onChange={change} openChild={(...s) => void openChild(...s)} />}
      {draft.kind === "live-loop" && activeTab === "policy" && <PolicyTab s={draft} onChange={change} />}
      {draft.kind === "live-loop" && activeTab === "limits" && <LimitsTab s={draft} onChange={change} />}
      {draft.kind === "campaign" && activeTab === "settings" && <CampaignSettings s={draft} onChange={change} onValidity={setJsonValid} />}
      {draft.kind === "joint" && activeTab === "settings" && <JointSettings s={draft} onChange={change} templates={templates} />}
      {draft.kind === "study" && activeTab === "settings" && <StudySettings s={draft} onChange={change} templates={templates} />}
      {draft.kind === "heldout" && activeTab === "settings" && <HeldoutSettings s={draft} onChange={change} />}
      {activeTab === "json" && (
        <Section title="JSON" description="The scenario exactly as stored. Edits apply when the text parses; the server validates the whole collection on save.">
          <JsonInput ariaLabel="Scenario JSON" value={draft} rows={32} onValidity={setJsonValid} onChange={v => { if (v && typeof v === "object" && !Array.isArray(v)) change(v as Scenario); }} />
        </Section>
      )}
    </EditorFrame>
  );
}
