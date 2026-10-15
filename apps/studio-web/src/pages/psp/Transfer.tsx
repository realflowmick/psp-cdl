// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { isPspxPath, isPspxText, PSPX_INTERPRETERS } from "@psp-cdl/studio-core";
import { Field, FormGrid, Select, TextInput } from "../../components/fields";
import { Modal } from "../../components/Modal";
import { KeyValue, Notice } from "../../components/Page";
import { useStudio } from "../../data";
import { api, type PspxUnpacked } from "../../lib/api";
import { baseName, copyText, download, readAsText, withExtension } from "../../lib/files";
import { errorText, formatBytes, formatTime } from "../../lib/format";
import { navigate } from "../../router";
import { childNodes, parsePsp } from "../../psp/model";
import { pspHref } from "../scenarios/ScenarioForms";

type Format = "psp" | "pspx";
const formatOptions = [
  { value: "psp" as Format, label: ".psp: the application only" },
  { value: "pspx" as Format, label: ".pspx: the interpreter system prompt first, then the application" }
];
const nodeCount = (text: string) => { const r = parsePsp(text); return r.ok ? `${childNodes(r.doc, []).length} top-level node(s), parses` : `does not parse (${r.error} at line ${r.line})`; };

/** Brings a .psp or .pspx file from disk into the workspace, as either format. */
export function ImportDialog({ onClose }: { onClose(): void }) {
  const { files, refreshFiles } = useStudio();
  const [source, setSource] = useState<{ name: string; text: string; pspx: PspxUnpacked | null } | null>(null);
  const [format, setFormat] = useState<Format>("psp");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const text = await readAsText(file);
      const pspx = isPspxText(text) ? await api.pspxUnpack(text) : null;
      setSource({ name: file.name, text, pspx });
      const kept: Format = pspx ? "pspx" : "psp";
      setFormat(kept);
      setPath(withExtension(baseName(file.name), kept === "pspx" ? ".pspx" : ".psp"));
    } catch (e) { setError(errorText(e)); setSource(null); }
  };
  const application = source ? source.pspx?.application ?? source.text : "";
  const exists = files.some(f => f.path === path);
  const problem = !source ? "Choose a file." : !/\.pspx?$/i.test(path) ? "The path must end in .psp or .pspx." : isPspxPath(path) !== (format === "pspx") ? `Use the .${format} extension for this format.` : null;
  const save = async () => {
    if (problem || !source) return;
    if (exists && !window.confirm(`${path} exists. Replace it?`)) return;
    setBusy(true); setError(null);
    try {
      // A .pspx kept as .pspx is written byte for byte; otherwise the application is (re)packed.
      const text = format === "psp" ? application
        : source.pspx ? source.text
        : (await api.pspxPack({ application, name: path })).text;
      await api.writeFile(path, text);
      await refreshFiles();
      onClose();
      navigate(pspHref(path));
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="Import a PSP application" onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" disabled={!!problem || busy} onClick={() => void save()}>{busy ? "Importing…" : "Import"}</button></>}>
      {error && <Notice kind="error">{error}</Notice>}
      <Field label="File" hint="A .psp application, or a .pspx that carries its system prompt.">
        <input type="file" accept=".psp,.pspx,.txt,.md" aria-label="File to import" onChange={e => void pick(e.target.files?.[0])} />
      </Field>
      {source && (
        <>
          <KeyValue items={[
            ["Read", `${source.name} · ${formatBytes(new TextEncoder().encode(source.text).length)}`],
            ["Format", source.pspx ? "PSPX" : "PSP"],
            ...(source.pspx ? [
              ["Interpreter", source.pspx.manifest.interpreter],
              ["Exported", formatTime(source.pspx.manifest.exportedAt)],
              ["System prompt", `${formatBytes(new TextEncoder().encode(source.pspx.system).length)} · ${source.pspx.verified.system ? "matches its recorded hash" : "differs from its recorded hash"}`]
            ] as [string, string][] : []),
            ["Application", `${nodeCount(application)}${source.pspx && !source.pspx.verified.application ? " · differs from its recorded hash" : ""}`]
          ]} />
          {source.pspx?.warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
          <FormGrid>
            <Field label="Save as"><Select value={format} options={formatOptions} onChange={v => { setFormat(v); setPath(p => withExtension(p, v === "pspx" ? ".pspx" : ".psp")); }} /></Field>
            <Field label="Workspace path" hint={exists ? "A file with this path exists and will be replaced." : "Relative to the workspace folder."}><TextInput value={path} onChange={setPath} /></Field>
          </FormGrid>
          {problem && <p className="field-error">{problem}</p>}
        </>
      )}
    </Modal>
  );
}

/**
 * Writes an application out as .psp or .pspx: download it, copy it (for pasting into a desktop
 * client's project instructions), or save it beside the original in the workspace.
 */
export function ExportDialog({ path, onClose, application = null, system = null, interpreter = null }: {
  path: string; onClose(): void;
  /** Current text, for exporting unsaved editor content; read from the file when null. */
  application?: string | null;
  /** System prompt kept from a .pspx; the shipped interpreter is used when null. */
  system?: string | null;
  interpreter?: string | null;
}) {
  const { files, refreshFiles } = useStudio();
  const [loaded, setLoaded] = useState<{ application: string; system: string | null; interpreter: string | null } | null>(application !== null ? { application, system, interpreter } : null);
  const [format, setFormat] = useState<Format>("pspx");
  const [chosen, setChosen] = useState(PSPX_INTERPRETERS[0]!.id);
  const [target, setTarget] = useState(withExtension(path, ".pspx"));
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (loaded) return;
    api.readFile(path).then(async f => {
      if (isPspxPath(path)) { const u = await api.pspxUnpack(f.text); setLoaded({ application: u.application, system: u.system, interpreter: u.manifest.interpreter }); }
      else setLoaded({ application: f.text, system: null, interpreter: null });
    }).catch(e => setError(errorText(e)));
  }, [path, loaded]);
  const keep = loaded?.system !== null && loaded?.system !== undefined && chosen === "keep";
  useEffect(() => { if (loaded?.system) setChosen("keep"); }, [loaded?.system]);
  useEffect(() => {
    if (!loaded) return;
    setOutput(null);
    if (format === "psp") { setOutput(loaded.application); return; }
    let cancelled = false;
    api.pspxPack(keep ? { application: loaded.application, name: path, system: loaded.system!, interpreter: loaded.interpreter ?? "custom" } : { application: loaded.application, name: path, interpreter: chosen })
      .then(r => { if (!cancelled) setOutput(r.text); }).catch(e => setError(errorText(e)));
    return () => { cancelled = true; };
  }, [loaded, format, chosen, keep, path]);
  const name = withExtension(baseName(path), format === "pspx" ? ".pspx" : ".psp");
  const run = async (work: () => Promise<string>) => {
    setBusy(true); setError(null); setMessage(null);
    try { setMessage(await work()); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const saveTo = () => run(async () => {
    if (!/\.pspx?$/i.test(target) || isPspxPath(target) !== (format === "pspx")) throw new Error(`Save a .${format} export to a path ending in .${format}.`);
    if (target === path && application === null) throw new Error("Choose a different path from the file being exported.");
    if (files.some(f => f.path === target) && !window.confirm(`${target} exists. Replace it?`)) return "Not saved.";
    await api.writeFile(target, output!);
    await refreshFiles();
    return `Saved ${target}.`;
  });
  const interpreterOptions = [...(loaded?.system ? [{ value: "keep", label: `Keep this file's system prompt (${loaded.interpreter ?? "custom"})` }] : []), ...PSPX_INTERPRETERS.map(i => ({ value: i.id, label: i.label }))];
  return (
    <Modal title={`Export ${baseName(path)}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>Close</button>
        <button type="button" disabled={!output || busy} onClick={() => void run(async () => { await copyText(output!); return "Copied to the clipboard."; })}>Copy</button>
        <button type="button" disabled={!output || busy} onClick={() => { download(name, output!); setMessage(`Downloaded ${name}.`); }}>Download</button>
      </>}>
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="info">{message}</Notice>}
      <FormGrid>
        <Field label="Format"><Select value={format} options={formatOptions} onChange={v => { setFormat(v); setTarget(withExtension(target, v === "pspx" ? ".pspx" : ".psp")); }} /></Field>
        {format === "pspx" && <Field label="System prompt"><Select value={chosen} options={interpreterOptions} onChange={setChosen} /></Field>}
      </FormGrid>
      {format === "pspx" && (
        <p className="muted small">A .pspx starts with the interpreter system prompt and ends with the application, so a client that takes pasted instructions, such as a desktop chat project, receives both. Install it as the project's instructions rather than pasting it into a conversation; the interpreter does not treat pasted text as installed instructions.</p>
      )}
      <p className="muted small" role="status">{output === null ? "Preparing…" : `${name} · ${formatBytes(new TextEncoder().encode(output).length)}`}</p>
      <div className="row">
        <Field label="Save to workspace as"><TextInput value={target} onChange={setTarget} /></Field>
        <button type="button" disabled={!output || busy} onClick={() => void saveTo()}>Save to workspace</button>
      </div>
    </Modal>
  );
}
