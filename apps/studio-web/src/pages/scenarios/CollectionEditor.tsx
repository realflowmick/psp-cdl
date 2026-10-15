// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { isIdentifier, type Scenario, type ScenarioCollection } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Field, FormGrid, TextArea, TextInput } from "../../components/fields";
import { EditorFrame, Loading, NotFound, Section } from "../../components/Page";
import { useStudio } from "../../data";
import { useDraft } from "../../lib/draft";
import { errorText } from "../../lib/format";
import { scenarioDetail, uniqueId } from "../../lib/scenarioOps";
import { href, navigate } from "../../router";

const scenarioColumns: Column<Scenario>[] = [
  { key: "label", header: "Scenario", value: s => s.label },
  { key: "id", header: "Id", width: "180px", value: s => s.id },
  { key: "kind", header: "Engine", width: "100px", value: s => s.kind },
  { key: "detail", header: "Configuration", width: "220px", value: s => scenarioDetail(s) },
  { key: "turns", header: "Turns", width: "70px", align: "right", value: s => s.kind === "live-loop" ? s.turns.length : null }
];

export function CollectionEditor({ id }: { id: string | null }) {
  const { collections, collectionsLoaded, saveCollection, deleteCollection } = useStudio();
  const isNew = id === null;
  const existing = id === null ? undefined : collections.find(c => c.id === id);
  const template = useMemo<ScenarioCollection | undefined>(() => {
    if (!collectionsLoaded) return undefined;
    if (!isNew) return existing;
    const now = new Date().toISOString();
    return { id: uniqueId("collection", collections.map(c => c.id)), label: "New collection", description: "", createdAt: now, updatedAt: now, scenarios: [] };
  }, [isNew, existing, collectionsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const { draft, saved, dirty, update, markSaved, revert } = useDraft(template);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!collectionsLoaded) return <Loading />;
  if (!draft) return <NotFound what="Collection" back={{ label: "collections", to: "/collections" }} />;

  const validate = (): string | null => {
    if (!isIdentifier(draft.id) || draft.id === "new") return "Id must be 1 to 64 letters, digits, dot, dash or underscore, start with a letter or digit, and not be \"new\".";
    if (isNew && collections.some(c => c.id === draft.id)) return `A collection with id ${draft.id} already exists.`;
    if (!draft.label.trim()) return "Label is required.";
    return null;
  };
  const save = async (): Promise<boolean> => {
    const problem = validate();
    if (problem) { setError(problem); return false; }
    setSaving(true); setError(null);
    try {
      const stored = await saveCollection({ ...draft, ...(draft.description ? {} : { description: undefined }) } as ScenarioCollection);
      markSaved(stored);
      if (isNew) navigate(href("collections", stored.id), { replace: true, force: true });
      return true;
    } catch (e) { setError(errorText(e)); return false; } finally { setSaving(false); }
  };
  const openScenario = async (...segments: string[]) => {
    if (isNew) { setError("Create the collection before adding scenarios."); return; }
    if (dirty) {
      if (!window.confirm("Save changes to this collection before opening the scenario?")) return;
      if (!await save()) return;
    }
    navigate(href("collections", draft.id, "scenarios", ...segments), { force: true });
  };
  const duplicate = (s: Scenario) => update(c => ({ ...c, scenarios: [...c.scenarios, { ...structuredClone(s), id: uniqueId(`${s.id}-copy`.slice(0, 58), c.scenarios.map(x => x.id)), label: `${s.label} (copy)` }] }));
  const remove = (s: Scenario) => { if (window.confirm(`Remove scenario "${s.label}" from this collection? Save to apply.`)) update(c => ({ ...c, scenarios: c.scenarios.filter(x => x !== s) })); };

  return (
    <EditorFrame crumbs={[{ label: "Collections", to: "/collections" }, { label: saved?.label ?? draft.label }]}
      title={draft.label || draft.id} subtitle={isNew ? "A new collection is stored when you create it." : `${draft.scenarios.length} scenarios · ${draft.id}.json`}
      dirty={dirty} saving={saving} isNew={isNew} error={error} onSave={() => void save()} onRevert={revert}
      onDelete={async () => { try { await deleteCollection(draft.id); navigate("/collections", { force: true }); } catch (e) { setError(errorText(e)); } }}
      deletePrompt={`Delete collection "${draft.label}" and its ${draft.scenarios.length} scenarios? Past runs keep their records.`}>
      <Section title="Collection">
        <FormGrid>
          <Field label="Id" hint={isNew ? "File name and URL segment. It cannot change after creation." : "Fixed after creation."}>
            <TextInput value={draft.id} readOnly={!isNew} onChange={v => update(c => ({ ...c, id: v }))} />
          </Field>
          <Field label="Label"><TextInput value={draft.label} onChange={v => update(c => ({ ...c, label: v }))} /></Field>
          <Field label="Description" wide><TextArea value={draft.description ?? ""} rows={3} onChange={v => update(c => ({ ...c, description: v }))} /></Field>
        </FormGrid>
      </Section>
      <Section title="Scenarios" description="Double-click a scenario to edit it. Duplicate and remove change this collection and apply when you save.">
        <DataGrid id={`collection:${draft.id}:scenarios`} label="Collection scenarios" rows={draft.scenarios} columns={scenarioColumns} rowKey={s => s.id}
          onOpen={s => void openScenario(s.id)} emptyMessage="No scenarios yet."
          actions={selected => <>
            <button type="button" className="primary" disabled={isNew} onClick={() => void openScenario("new")}>New scenario</button>
            <button type="button" disabled={!selected} onClick={() => selected && duplicate(selected)}>Duplicate</button>
            <button type="button" className="danger" disabled={!selected} onClick={() => selected && remove(selected)}>Remove</button>
          </>} />
      </Section>
    </EditorFrame>
  );
}