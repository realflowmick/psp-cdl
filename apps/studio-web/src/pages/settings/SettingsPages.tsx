// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from "react";
import { DataGrid, type Column } from "../../components/DataGrid";
import { Field, FormGrid, Select, TextInput } from "../../components/fields";
import { KeyValue, ListPage, Loading, Notice, NotFound, PageHeader, Section, StatusBadge } from "../../components/Page";
import { useStudio } from "../../data";
import { api, type SecretSummary, type SigningInfo } from "../../lib/api";
import { errorText, formatTime } from "../../lib/format";
import { href, navigate, useLeaveGuard } from "../../router";

export const SECRET_PURPOSE: Record<string, string> = {
  "openai.apiKey": "OpenAI API key for live-loop scenarios with the OpenAI provider and for live joint or study runs.",
  "anthropic.apiKey": "Anthropic API key for live campaign roles that use Anthropic models.",
  signing: "Key that signs the system prompt for live-loop runs. Without it each run signs with an ephemeral HMAC key."
};

function useSecrets() {
  const { report } = useStudio();
  const [state, setState] = useState<{ mode: string; secrets: SecretSummary[]; signing: SigningInfo } | null>(null);
  const refresh = useCallback(() => api.secrets().then(setState).catch(report), [report]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, refresh };
}

const columns: Column<SecretSummary>[] = [
  { key: "name", header: "Secret", width: "180px", value: s => s.name, render: s => <code>{s.name}</code> },
  { key: "status", header: "Status", width: "130px", value: s => s.configured ? "configured" : "not set", render: s => <StatusBadge status={s.configured ? "configured" : "not set"} /> },
  { key: "hint", header: "Hint", width: "200px", value: s => s.hint ?? "" },
  { key: "purpose", header: "Used for", value: s => SECRET_PURPOSE[s.name] ?? "" },
  { key: "updated", header: "Updated", width: "170px", value: s => s.updatedAt ?? "", render: s => formatTime(s.updatedAt) }
];

export function SecretsList() {
  const { state, refresh } = useSecrets();
  return (
    <ListPage title="Secrets" subtitle={<>Stored encrypted in the studio vault ({state?.mode ?? "…"} mode). Values are never shown again; only a hint. Double-click a secret to set or replace it.</>}>
      <DataGrid id="secrets" label="Secrets" fill rows={state?.secrets ?? []} columns={columns} rowKey={s => s.name} loading={!state}
        onOpen={s => navigate(href("secrets", s.name))} actions={() => <button type="button" onClick={() => void refresh()}>Refresh</button>} />
    </ListPage>
  );
}

export function SecretEditor({ name }: { name: string }) {
  const { state, refresh } = useSecrets();
  const [value, setValue] = useState("");
  const [algorithm, setAlgorithm] = useState<"hmac-sha256" | "ed25519">("ed25519");
  const [keyId, setKeyId] = useState("studio-signing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useLeaveGuard(value !== "", "The secret you typed has not been saved. Leave anyway?");
  if (!state) return <Loading />;
  const secret = state.secrets.find(s => s.name === name);
  if (!secret) return <NotFound what="Secret" back={{ label: "secrets", to: "/secrets" }} />;
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); setMessage(done); setValue(""); await refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const remove = () => { if (window.confirm(`Delete ${name} from the vault?`)) void act(() => api.deleteSecret(name), `${name} deleted.`); };
  const signing = name === "signing";
  return (
    <div className="page editor">
      <PageHeader crumbs={[{ label: "Secrets", to: "/secrets" }, { label: name }]} title={<code>{name}</code>}
        badge={<StatusBadge status={secret.configured ? "configured" : "not set"} />} subtitle={SECRET_PURPOSE[name]}
        actions={<button type="button" className="danger" disabled={!secret.configured || busy} onClick={remove}>Delete</button>} />
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="info">{message}</Notice>}
      <Section title="Stored value">
        <KeyValue items={signing ? [
          ["Algorithm", state.signing.algorithm], ["Key id", state.signing.keyId],
          ["Public key", state.signing.publicKey ? <code className="digest">{state.signing.publicKey}</code> : state.signing.algorithm === "hmac-sha256" ? "HMAC keys have no public half" : null],
          ["Updated", formatTime(secret.updatedAt)]
        ] : [["Hint", secret.hint], ["Updated", formatTime(secret.updatedAt)]]} />
      </Section>
      {signing ? (
        <Section title={secret.configured ? "Replace signing key" : "Generate signing key"} description="Fresh 32-byte material is generated on the server. The private material never leaves the vault.">
          <FormGrid>
            <Field label="Algorithm"><Select value={algorithm} options={[{ value: "ed25519", label: "Ed25519" }, { value: "hmac-sha256", label: "HMAC-SHA256" }]} onChange={v => setAlgorithm(v as "hmac-sha256" | "ed25519")} /></Field>
            <Field label="Key id"><TextInput value={keyId} onChange={setKeyId} /></Field>
          </FormGrid>
          <div className="row"><button type="button" className="primary" disabled={busy || !keyId}
            onClick={() => { if (!secret.configured || window.confirm("Replace the current signing key? Prompts signed with it stop verifying.")) void act(() => api.generateSigning(algorithm, keyId), "Signing key generated."); }}>
            {secret.configured ? "Replace key" : "Generate key"}</button></div>
        </Section>
      ) : (
        <Section title={secret.configured ? "Replace value" : "Set value"} description="The value is encrypted at rest and reaches engines only as host configuration, never as model-visible text.">
          <FormGrid><Field label="Value"><TextInput type="password" value={value} onChange={setValue} placeholder="paste the key" /></Field></FormGrid>
          <div className="row"><button type="button" className="primary" disabled={busy || !value} onClick={() => void act(() => api.setSecret(name, value), `${name} saved.`)}>Save</button></div>
        </Section>
      )}
    </div>
  );
}

export function ServerPage() {
  const { status, connected } = useStudio();
  if (!status) return <Loading />;
  return (
    <div className="page detail">
      <PageHeader title="Server" subtitle={status.notice} />
      <Section title="Studio server">
        <KeyValue items={[
          ["Profile", status.profile], ["Version", status.version], ["Socket", connected ? "connected" : "disconnected"],
          ["Workspace", <code>{status.workspace}</code>], ["Inspect payloads", status.inspectAllowed ? "allowed (--inspect)" : "off"],
          ["Vault", status.vault.mode], ["Signing key", status.vault.signing.configured ? `${status.vault.signing.algorithm} · ${status.vault.signing.keyId}` : "ephemeral per run"],
          ["Active runs", String(status.activeRuns)]
        ]} />
      </Section>
      <Section title="Engines">
        <KeyValue items={status.supportedEngines.map(e => [e, status.engines.includes(e) ? "registered" : "not registered"] as [string, string])} />
      </Section>
    </div>
  );
}
