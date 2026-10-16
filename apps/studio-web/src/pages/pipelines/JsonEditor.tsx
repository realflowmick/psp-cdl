// SPDX-License-Identifier: Apache-2.0
// Monaco for document mode, bundled locally: @monaco-editor/react would otherwise fetch Monaco from a CDN.
import { useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: (_id: string, label: string) => label === "json" ? new JsonWorker() : new EditorWorker() };
loader.config({ monaco });

export interface EditorMarker { start: number; end: number; severity: "error" | "warn" | "info"; message: string; fix?: { label: string; run(): void } }
export interface JsonEditorProps {
  value: string;
  onChange(text: string): void;
  /** pipeline.schema.json: validation, completion and hover. */
  schema: Record<string, unknown> | null;
  markers: readonly EditorMarker[];
  highlight: { start: number; end: number } | null;
  ariaLabel: string;
}

const SCHEMA_URI = "https://psp-cdl.dev/schemas/studio/pipeline-0.1.schema.json";
const MODEL_URI = "inmemory://pipeline/config.json";
let fixes: EditorMarker[] = [];
let actionsRegistered = false;
const FIX_COMMAND = "pipeline.applyFix";

export default function JsonEditor({ value, onChange, schema, markers, highlight, ariaLabel }: JsonEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const dark = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  useEffect(() => {
    if (!schema) return;
    monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: false, enableSchemaRequest: false, schemas: [{ uri: SCHEMA_URI, fileMatch: [MODEL_URI], schema }] });
  }, [schema]);

  useEffect(() => {
    if (actionsRegistered) return;
    actionsRegistered = true;
    monaco.editor.registerCommand(FIX_COMMAND, (_accessor, index: number) => fixes[index]?.fix?.run());
    // Quick fixes from the shared validator, offered as code actions on their markers.
    monaco.languages.registerCodeActionProvider("json", {
      provideCodeActions: (model, range) => {
        const actions = fixes.map((m, index) => ({ m, index })).filter(({ m }) => {
          if (!m.fix) return false;
          const start = model.getPositionAt(m.start), end = model.getPositionAt(m.end);
          return monaco.Range.areIntersectingOrTouching(range, new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column));
        }).map(({ m, index }) => ({ title: m.fix!.label, kind: "quickfix", command: { id: FIX_COMMAND, title: m.fix!.label, arguments: [index] } }));
        return { actions, dispose: () => {} };
      }
    });
  }, []);

  useEffect(() => {
    fixes = [...markers];
    const model = editorRef.current?.getModel();
    if (!model) return;
    const severity = { error: monaco.MarkerSeverity.Error, warn: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
    monaco.editor.setModelMarkers(model, "pipeline", markers.map(m => {
      const start = model.getPositionAt(m.start), end = model.getPositionAt(m.end);
      return { severity: severity[m.severity], message: m.message, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    }));
  }, [markers, value]);

  useEffect(() => {
    const editor = editorRef.current, model = editor?.getModel();
    if (!editor || !model) return;
    const ranges = highlight ? [(() => { const s = model.getPositionAt(highlight.start), e = model.getPositionAt(highlight.end); return new monaco.Range(s.lineNumber, 1, e.lineNumber, 1); })()] : [];
    decorations.current?.set(ranges.map(range => ({ range, options: { isWholeLine: true, className: "pl-doc-highlight" } })));
    if (ranges[0]) editor.revealRangeInCenterIfOutsideViewport(ranges[0]);
  }, [highlight, value]);

  const onMount: OnMount = editor => { editorRef.current = editor as unknown as monaco.editor.IStandaloneCodeEditor; decorations.current = editorRef.current.createDecorationsCollection(); };
  return (
    <div className="pl-monaco" aria-label={ariaLabel}>
      <Editor language="json" path={MODEL_URI} value={value} onChange={v => onChange(v ?? "")} onMount={onMount} theme={dark ? "vs-dark" : "vs"}
        options={{ minimap: { enabled: false }, tabSize: 2, scrollBeyondLastLine: false, fontSize: 12, automaticLayout: true, wordWrap: "on" }} />
    </div>
  );
}
