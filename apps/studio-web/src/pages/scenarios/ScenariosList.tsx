// SPDX-License-Identifier: Apache-2.0
import type { Scenario, ScenarioCollection } from "@psp-cdl/studio-core";
import { DataGrid, type Column } from "../../components/DataGrid";
import { ListPage } from "../../components/Page";
import { useStudio } from "../../data";
import { formatTime } from "../../lib/format";
import { replaceScenario, scenarioDetail, uniqueId } from "../../lib/scenarioOps";
import { useSessionState } from "../../lib/session";
import { href, navigate } from "../../router";

interface Row { collection: ScenarioCollection; scenario: Scenario }
const key = (r: Row) => `${r.collection.id}/${r.scenario.id}`;
const columns: Column<Row>[] = [
  { key: "label", header: "Scenario", value: r => r.scenario.label },
  { key: "id", header: "Id", width: "180px", value: r => r.scenario.id },
  { key: "collection", header: "Collection", width: "180px", value: r => r.collection.label },
  { key: "kind", header: "Engine", width: "100px", value: r => r.scenario.kind },
  { key: "detail", header: "Configuration", width: "220px", value: r => scenarioDetail(r.scenario) },
  { key: "turns", header: "Turns", width: "70px", align: "right", value: r => r.scenario.kind === "live-loop" ? r.scenario.turns.length : null },
  { key: "tools", header: "Tools", width: "70px", align: "right", value: r => r.scenario.kind === "live-loop" ? r.scenario.tools.length : null }
];

export function ScenariosList() {
  const { collections, collectionsLoaded, saveCollection, report } = useStudio();
  const [collectionFilter, setCollectionFilter] = useSessionState("scenarios:collection", "all");
  const [kindFilter, setKindFilter] = useSessionState("scenarios:kind", "all");
  const rows: Row[] = collections.flatMap(collection => collection.scenarios.map(scenario => ({ collection, scenario })))
    .filter(r => (collectionFilter === "all" || r.collection.id === collectionFilter) && (kindFilter === "all" || r.scenario.kind === kindFilter));
  const target = collections.find(c => c.id === collectionFilter) ?? collections[0];
  const open = (r: Row) => navigate(href("collections", r.collection.id, "scenarios", r.scenario.id));
  const duplicate = async (r: Row) => {
    const id = uniqueId(`${r.scenario.id}-copy`.slice(0, 58), r.collection.scenarios.map(s => s.id));
    const copy = { ...structuredClone(r.scenario), id, label: `${r.scenario.label} (copy)` };
    try { await saveCollection(replaceScenario(r.collection, null, copy)); navigate(href("collections", r.collection.id, "scenarios", id)); } catch (e) { report(e); }
  };
  const remove = async (r: Row) => {
    if (!window.confirm(`Delete scenario "${r.scenario.label}" from ${r.collection.label}? Past runs keep their records.`)) return;
    try { await saveCollection({ ...r.collection, scenarios: r.collection.scenarios.filter(s => s.id !== r.scenario.id) }); } catch (e) { report(e); }
  };
  return (
    <ListPage title="Scenarios" subtitle="Every scenario in every collection. Double-click one to edit it.">
      <DataGrid id="scenarios" label="Scenarios" fill rows={rows} columns={columns} rowKey={key} loading={!collectionsLoaded} onOpen={open}
        initialSort={{ key: "collection", dir: "asc" }} emptyMessage="No scenarios. Create a collection first, then add scenarios to it."
        filters={<>
          <select aria-label="Collection filter" value={collectionFilter} onChange={e => setCollectionFilter(e.target.value)}>
            <option value="all">All collections</option>{collections.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select aria-label="Engine filter" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
            <option value="all">All engines</option>{["live-loop", "campaign", "joint", "study", "heldout"].map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </>}
        actions={selected => <>
          <button type="button" className="primary" disabled={!target} onClick={() => target && navigate(href("collections", target.id, "scenarios", "new"))} title={target ? `New scenario in ${target.label}` : "Create a collection first"}>New scenario</button>
          <button type="button" disabled={!selected} onClick={() => selected && navigate(`/runs/new?${new URLSearchParams({ collection: selected.collection.id, scenario: selected.scenario.id })}`)}>Run</button>
          <button type="button" disabled={!selected} onClick={() => selected && void duplicate(selected)}>Duplicate</button>
          <button type="button" className="danger" disabled={!selected} onClick={() => selected && void remove(selected)}>Delete</button>
        </>} />
    </ListPage>
  );
}

const collectionColumns: Column<ScenarioCollection>[] = [
  { key: "label", header: "Collection", value: c => c.label },
  { key: "id", header: "Id", width: "180px", value: c => c.id },
  { key: "scenarios", header: "Scenarios", width: "100px", align: "right", value: c => c.scenarios.length },
  { key: "kinds", header: "Engines", width: "220px", value: c => [...new Set(c.scenarios.map(s => s.kind))].join(", ") },
  { key: "updated", header: "Updated", width: "170px", value: c => c.updatedAt, render: c => formatTime(c.updatedAt) }
];

export function CollectionsList() {
  const { collections, collectionsLoaded, deleteCollection, report } = useStudio();
  const remove = async (c: ScenarioCollection) => {
    if (!window.confirm(`Delete collection "${c.label}" and its ${c.scenarios.length} scenarios? Past runs keep their records.`)) return;
    try { await deleteCollection(c.id); } catch (e) { report(e); }
  };
  return (
    <ListPage title="Collections" subtitle="Collections group scenarios and are stored as JSON files in the studio data directory.">
      <DataGrid id="collections" label="Collections" fill rows={collections} columns={collectionColumns} rowKey={c => c.id} loading={!collectionsLoaded}
        initialSort={{ key: "label", dir: "asc" }} onOpen={c => navigate(href("collections", c.id))}
        actions={selected => <>
          <button type="button" className="primary" onClick={() => navigate("/collections/new")}>New collection</button>
          <button type="button" className="danger" disabled={!selected} onClick={() => selected && void remove(selected)}>Delete</button>
        </>} />
    </ListPage>
  );
}