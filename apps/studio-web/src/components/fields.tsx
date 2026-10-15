// SPDX-License-Identifier: Apache-2.0
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { stableStringify } from "../lib/format";

const FieldId = createContext<string | undefined>(undefined);
const useFieldId = () => useContext(FieldId);

/** Label, control and hint. The label is bound to the control by id. */
export function Field({ label, hint, error, wide, children }: { label: string; hint?: ReactNode; error?: string | null; wide?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className={`field${wide ? " wide" : ""}${error ? " invalid" : ""}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="field-control"><FieldId.Provider value={id}>{children}</FieldId.Provider></div>
      {error ? <div className="field-error" role="alert">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}
export function FormGrid({ children }: { children: ReactNode }) { return <div className="form-grid">{children}</div>; }

export function TextInput({ value, onChange, placeholder, readOnly, type = "text", ariaLabel, list }: { value: string; onChange(value: string): void; placeholder?: string; readOnly?: boolean; type?: "text" | "password"; ariaLabel?: string; /** Id of a datalist with suggestions. */ list?: string }) {
  return <input id={useFieldId()} aria-label={ariaLabel} type={type} value={value} placeholder={placeholder} readOnly={readOnly} list={list} autoComplete="off" onChange={e => onChange(e.target.value)} />;
}
export function TextArea({ value, onChange, rows = 4, code, placeholder, readOnly }: { value: string; onChange(value: string): void; rows?: number; code?: boolean; placeholder?: string; readOnly?: boolean }) {
  return <textarea id={useFieldId()} className={code ? "code" : undefined} rows={rows} value={value} placeholder={placeholder} readOnly={readOnly} spellCheck={!code} onChange={e => onChange(e.target.value)} />;
}
export function Select<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange(value: T): void; options: readonly { value: T; label: string }[]; ariaLabel?: string }) {
  return <select id={useFieldId()} aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange(checked: boolean): void; label: ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}</label>;
}

/** Integer input that tolerates intermediate text; blank means "not set". */
export function NumberInput({ value, onChange, min, max, ariaLabel }: { value: number | undefined; onChange(value: number | undefined): void; min?: number; max?: number; ariaLabel?: string }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => { const parsed = text.trim() === "" ? undefined : Number(text); if (parsed !== value) setText(value === undefined ? "" : String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input id={useFieldId()} aria-label={ariaLabel} type="number" inputMode="numeric" value={text} min={min} max={max} onChange={e => {
    setText(e.target.value);
    const raw = e.target.value.trim();
    if (raw === "") return onChange(undefined);
    const n = Number(raw);
    if (Number.isSafeInteger(n)) onChange(n);
  }} />;
}

/** Comma or whitespace separated identifiers, such as CDL terms or case ids. */
export function TokenInput({ value, onChange, placeholder, ariaLabel }: { value: readonly string[]; onChange(value: string[]): void; placeholder?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value.join(", "));
  const parse = (raw: string) => raw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  useEffect(() => { if (parse(text).join(",") !== value.join(",")) setText(value.join(", ")); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input id={useFieldId()} aria-label={ariaLabel} type="text" value={text} placeholder={placeholder ?? "term, term"} autoComplete="off" onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} />;
}

/** JSON text that only reaches the draft when it parses; the parse error shows inline. */
export function JsonInput({ value, onChange, rows = 8, onValidity, ariaLabel }: { value: unknown; onChange(value: unknown): void; rows?: number; onValidity?: (valid: boolean) => void; ariaLabel?: string }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  const emitted = useRef(stableStringify(value));
  useEffect(() => {
    const incoming = stableStringify(value);
    if (incoming !== emitted.current) { emitted.current = incoming; setText(JSON.stringify(value, null, 2)); setError(null); onValidity?.(true); }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <textarea id={useFieldId()} aria-label={ariaLabel} className="code" rows={rows} value={text} spellCheck={false} onChange={e => {
        setText(e.target.value);
        try {
          const parsed: unknown = JSON.parse(e.target.value);
          setError(null); onValidity?.(true);
          emitted.current = stableStringify(parsed);
          onChange(parsed);
        } catch (err) { setError((err as Error).message); onValidity?.(false); }
      }} />
      {error && <div className="field-error" role="alert">Invalid JSON: {error}</div>}
    </>
  );
}