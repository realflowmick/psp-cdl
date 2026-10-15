// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ASSISTANT_LIMITS, ASSISTANT_PROVIDERS, attachmentKind, type AssistantMode, type AssistantProvider } from "@psp-cdl/studio-core";
import { Field, FormGrid, Select, TextArea, TextInput } from "../../components/fields";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Page";
import { useStudio } from "../../data";
import { api, type AssistantProviderView, type AssistantView } from "../../lib/api";
import { readAsBase64 } from "../../lib/files";
import { errorText, formatBytes, formatTime } from "../../lib/format";
import { useLocalState } from "../../lib/session";
import { href, Link, navigate } from "../../router";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.psp,.pspx";
interface Engine { provider: AssistantProvider; models: Partial<Record<AssistantProvider, string>> }

function attachmentProblem(file: File): string | null {
  const kind = attachmentKind(file.name, file.type);
  if (!kind) return "Not an image, PDF or text document.";
  const limit = kind === "text" ? ASSISTANT_LIMITS.maxTextAttachmentBytes : ASSISTANT_LIMITS.maxAttachmentBytes;
  if (file.size === 0) return "The file is empty.";
  if (file.size > limit) return `Larger than ${formatBytes(limit)}.`;
  return null;
}

/**
 * Compose a prompt for the authoring assistant: what to create or change, which provider and model,
 * and any documents or images. The key itself stays in the studio vault.
 */
export function AssistantDialog({ onClose, path = null, base = null }: { onClose(): void; path?: string | null; base?: AssistantView | null }) {
  const { files } = useStudio();
  const apps = useMemo(() => files.map(f => f.path).filter(p => /\.pspx?$/i.test(p)).sort(), [files]);
  const [engine, setEngine] = useLocalState<Engine>("assistant-engine", { provider: "anthropic", models: {} });
  const [providers, setProviders] = useState<AssistantProviderView[] | null>(null);
  const [mode, setMode] = useState<AssistantMode>(base || path ? "modify" : "create");
  const [target, setTarget] = useState(base?.path ?? path ?? "");
  const [newPath, setNewPath] = useState("new-application.psp");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.assistantProviders().then(setProviders).catch(e => setError(errorText(e))); }, []);
  useEffect(() => { if (!target && apps[0]) setTarget(apps[0]); }, [apps, target]);

  const info = providers?.find(p => p.id === engine.provider) ?? { ...ASSISTANT_PROVIDERS[0]!, configured: false };
  const model = engine.models[engine.provider] ?? info.defaultModel;
  const file = mode === "create" ? newPath : target;
  const total = attachments.reduce((n, f) => n + f.size, 0);
  const problems = attachments.map(attachmentProblem);
  const blocked =
    !providers ? "Loading providers…"
    : !info.configured ? `Store ${info.secret} on the Secrets page to use ${info.label}.`
    : !prompt.trim() ? "Describe what you want."
    : !/\.pspx?$/i.test(file) ? "Choose a .psp or .pspx file."
    : mode === "create" && apps.includes(file) ? `${file} exists; choose Change an existing application.`
    : attachments.length > ASSISTANT_LIMITS.maxAttachments ? `Attach at most ${ASSISTANT_LIMITS.maxAttachments} files.`
    : total > ASSISTANT_LIMITS.maxTotalAttachmentBytes ? `Attachments may total at most ${formatBytes(ASSISTANT_LIMITS.maxTotalAttachmentBytes)}.`
    : problems.some(Boolean) ? "Remove the attachments that cannot be sent."
    : null;
  const add = (list: FileList | null) => { if (list) setAttachments(a => [...a, ...Array.from(list)]); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); add(e.dataTransfer.files); };
  const close = () => { if (!busy && (!prompt.trim() || window.confirm("Discard this prompt?"))) onClose(); };
  const submit = async () => {
    if (blocked) return;
    setBusy(true); setError(null);
    try {
      const encoded = await Promise.all(attachments.map(async f => ({ name: f.name, mediaType: f.type, data: await readAsBase64(f) })));
      const started = await api.startAssistant({ mode: base ? "modify" : mode, path: file, provider: engine.provider, model, prompt: prompt.trim(), attachments: encoded, ...(base ? { baseId: base.id } : {}) });
      onClose();
      navigate(href("psp", "assistant", started.id));
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };

  return (
    <Modal title={base ? "Refine the proposal" : "PSP assistant"} onClose={close} wide
      footer={<>
        <span className="muted small modal-note">The prompt, attachments and current application go to {info.label}. The key stays in the studio vault.</span>
        <button type="button" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="primary" disabled={!!blocked || busy} title={blocked ?? undefined} onClick={() => void submit()}>{busy ? "Sending…" : "Generate"}</button>
      </>}>
      {error && <Notice kind="error">{error}</Notice>}
      {base ? (
        <Notice kind="info">Refining the proposal from {formatTime(base.createdAt)} for <code>{base.path}</code>. The model starts from that proposal; accepting still checks the file on disk.</Notice>
      ) : (
        <fieldset className="choice">
          <legend>Application</legend>
          <label className="check"><input type="radio" name="assistant-mode" checked={mode === "create"} onChange={() => setMode("create")} /> Create a new application</label>
          {mode === "create" && <Field label="New file" hint="Use .pspx to store it with the interpreter system prompt."><TextInput value={newPath} onChange={setNewPath} /></Field>}
          <label className="check"><input type="radio" name="assistant-mode" checked={mode === "modify"} disabled={!apps.length} onChange={() => setMode("modify")} /> Change an existing application</label>
          {mode === "modify" && (
            <Field label="File"><Select value={target} options={apps.map(p => ({ value: p, label: p }))} onChange={setTarget} /></Field>
          )}
        </fieldset>
      )}
      <FormGrid>
        <Field label="Provider" hint={info.configured ? `Uses the stored ${info.secret}.` : <>No key stored. <Link to={`/secrets/${info.secret}`} onClick={onClose}>Store {info.secret}</Link></>}>
          <Select value={engine.provider} options={(providers ?? ASSISTANT_PROVIDERS.map(p => ({ ...p, configured: false }))).map(p => ({ value: p.id, label: `${p.label}${providers ? p.configured ? " · key stored" : " · no key" : ""}` }))}
            onChange={v => setEngine(e => ({ ...e, provider: v }))} />
        </Field>
        <Field label="Model" hint="Any model id the provider accepts.">
          <TextInput list="assistant-models" value={model} onChange={v => setEngine(en => ({ ...en, models: { ...en.models, [en.provider]: v } }))} />
        </Field>
      </FormGrid>
      <datalist id="assistant-models">{info.models.map(m => <option key={m} value={m} />)}</datalist>
      <Field label="Prompt" hint={mode === "create" && !base ? "For example: an intake application that collects a claim, checks eligibility, and routes uncertain cases to a human checkpoint." : "Describe the change. Everything you do not mention is kept."}>
        <TextArea rows={7} value={prompt} onChange={setPrompt} />
      </Field>
      <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        <label className="button-like">Attach files<input type="file" multiple accept={ACCEPT} aria-label="Attach files" onChange={e => { add(e.target.files); e.target.value = ""; }} /></label>
        <span className="muted small">or drop them here. Images, PDFs and text documents, up to {formatBytes(ASSISTANT_LIMITS.maxAttachmentBytes)} each. Contents are sent, not stored.</span>
      </div>
      {attachments.length > 0 && (
        <ul className="attachments" aria-label="Attachments">
          {attachments.map((f, i) => (
            <li key={`${f.name}:${i}`} className={problems[i] ? "invalid" : undefined}>
              <span>{f.name}</span><span className="muted small">{attachmentKind(f.name, f.type) ?? "unsupported"} · {formatBytes(f.size)}</span>
              {problems[i] && <span className="field-error">{problems[i]}</span>}
              <span className="spacer" />
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setAttachments(a => a.filter((_, k) => k !== i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {blocked && providers && <p className="muted small" role="status">{blocked}</p>}
    </Modal>
  );
}
