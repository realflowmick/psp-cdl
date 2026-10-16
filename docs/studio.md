# PSP Studio

PSP Studio is development tooling for watching the reference loops, the dispatch
gate and the evaluation engines do their work. It is not one of the seven
reference components in `project.json`, it asserts no security property, and a
green run in the studio is not evidence of anything beyond "the libraries
produced these events for this scenario on this machine". Implementation code
under `apps/` is Apache-2.0.

The studio has three parts:

| Package | Role |
| --- | --- |
| `@psp-cdl/studio-core` (`apps/studio-core`) | Browser-safe models: the run event envelope, scenario and collection definitions, the shared [collection schema](../apps/studio-core/schemas/scenario-collection.schema.json), and the observer severity map. |
| `@psp-cdl/studio-server` (`apps/studio-server`) | Loopback Node backend: JSON API, socket.io hub, in-process live-loop engine, Python engine adapters, workspace editor and an encrypted vault. |
| `@psp-cdl/studio-web` (`apps/studio-web`) | React browser app. Every kind of record (runs, run events, run turns, collections, scenarios, scenario turns and tools, workspace files, secrets) is listed in a grid and opens in its own editor or detail route. Built with Vite; tested with vitest, jsdom and Testing Library. |

## Running the server

```sh
npm run build
node apps/studio-server/dist/main.js --workspace examples/in-context --data .artifacts/studio --web apps/studio-web/dist
```

Open the printed URL for the browser app. For front-end work, `npm run dev --workspace @psp-cdl/studio-web` serves the app on port 4811 with the API and socket proxied to the backend.

The server prints one JSON line with its URL. Flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port` | `4810` | TCP port; `0` picks a free one. |
| `--host` | `127.0.0.1` | Bind address. Non-loopback hosts are refused unless `--allow-remote` is passed, because the vault holds API keys. |
| `--workspace` | `examples/in-context` | Folder of `.psp` files the editor can read and write. |
| `--data` | `.artifacts/studio` | State directory: collections, runs, journals, the vault. Keep it under the ignored `.artifacts/` tree; the study engine refuses anything else. |
| `--inspect` | off | Allows runs to attach model-visible payloads (messages, candidates, tool data, state) to events. Inspect output contains user and application text; keep it local. |
| `--cors` | none | Comma-separated browser origins allowed to call the API and the socket. |
| `--uv` | `uv` | Path to the `uv` launcher used for the Python engines. |
| `--repo` | auto | Repository root, when the server runs from somewhere other than its package. |
| `--web` | none | Directory of the built browser app (`apps/studio-web/dist`); served at `/` with index fallback for client routes. |

`PSP_STUDIO_VAULT_PASSPHRASE` derives the vault key from a passphrase instead of
the generated `vault.key` file.

## Concepts

**Collections and scenarios.** A collection is a JSON document validated against
the shared schema. Each scenario names an engine through its `kind`:

- `live-loop` runs the TypeScript reference loops in-process: `buffered`,
  `durable`, `refreshing` or `context`. The scenario supplies the application
  text (a workspace file or inline source), synthetic read-only tools, a mock
  script or a live OpenAI or Anthropic provider, the node affinity, the CDL policy per phase,
  the turn messages, and the turn plan (`accumulate`, `replace` or
  `model-state`). The interpreter candidates from `specs/systemprompts` are
  prepended when `interpreter` is `psp-core-3.2-draft-0.1`.
- `campaign`, `joint`, `study` and `heldout` wrap the existing Python engines
  (`scripts/campaign.py`, `scripts/joint_interpreter.py`,
  `scripts/run-study.py`, `scripts/run-heldout.py`) as subprocesses and tail
  their journals.

**Prepare, then run.** `POST /api/runs/prepare` builds the whole harness (or
runs the engine's own prepare step) without executing anything and returns a
preview plus warnings. A live run (a real provider, or a live campaign or joint
run) also returns an `admissionDigest`; `POST /api/runs` must repeat it or the
engine refuses with `NOT_ADMITTED`. Offline and rehearsal runs need no digest.

**Runs and events.** Every run has a directory under `<data>/runs/<runId>` with
`run.json`, `events.jsonl` and the engine's own artifacts (the live loop's
SQLite state, a campaign's bundle and collection, and so on). Events carry a
strictly increasing `seq`, the engine, the observer source and type, a severity
for colouring, and the observer scope. Observer events are the
[PSP-OBSERVE-0.1](observer.md) events unchanged; `studio.*` events add turn
boundaries, session snapshots, audit callbacks, process output and status
changes. The journal file is the source of truth: a reconnecting client asks
for everything after the last `seq` it holds.

**Secrets.** `openai.apiKey`, `anthropic.apiKey` and the prompt `signing` key
live in `<data>/vault.json`, encrypted with AES-256-GCM under `vault.key` or a
passphrase. The API only ever returns hints and, for Ed25519, the public key.
Credentials reach engines as host configuration or subprocess environment and
never enter model-visible text or the event stream. Without a stored signing
key, prompts are signed with a per-run ephemeral HMAC key and `prepare` says
so.

## Browser app

A collapsible navigation menu sits on the left; the hamburger at the top left opens and closes it, and the choice is remembered per browser. Every list is a grid that sorts by column, filters across columns, pages large sets and remembers its sort, filter and selection when you come back. Click selects a row. Double-click, Enter or the Open button opens the record's route, so every record is linkable.

| Grid route | Opens |
| --- | --- |
| `/runs` | `/runs/:id` with Overview, Events and Turns tabs; events open `/runs/:id/events/:seq`, turns open `/runs/:id/turns/:n` |
| `/runs/new` | The launcher: prepare, admit, start |
| `/scenarios`, `/collections` | `/collections/:cid` and `/collections/:cid/scenarios/:sid` |
| Scenario Turns and Tools tabs | `/collections/:cid/scenarios/:sid/turns/:n` and `.../tools/:server.name` |
| `/psp` | `/psp/files/<path>`, the PSP diagram editor; `/psp/new` creates an application file |
| `/psp/assistant` | `/psp/assistant/:id`, one assistant request with its proposed change |
| `/pipelines` | `/pipelines/:id`, the pipeline editor (see [Pipelines](#pipelines)) |
| `/workspace` | `/workspace/files/<path>` |
| `/secrets` | `/secrets/:name` |

Editors track unsaved changes, ask before leaving with unsaved work, and save with Ctrl+S. Opening a scenario's turn or tool while the scenario has unsaved edits offers to save first, because child editors write the stored scenario. Moving or deleting a turn keeps its mock replies, the completion turn and turn-specific policy overrides aligned; renaming a tool updates the node agent list and the replies that call it. Policy overrides are edited inline on the Policy tab.

### PSP editor

The editor at `/psp/files/<path>` shows a workspace `.psp` file as nodes and transitions. It has three panels:

- **Node types (left).** Click a type, or drag it onto the diagram, to add a node: prompt, decision, composite, connector, checkpoint, loop, reset or nested application. Below the palette are an outline of the whole document and authoring checks.
- **Diagram (middle).** Drawing from a node's right handle to another node adds a transition. Dragging the end of a transition changes its target. A dashed card marks a transition target that does not exist in the scope.
- **Properties (right).** Each node type gets its own tabs:
  - General
  - Instructions: the system block, refresh directive and context blocks
  - Output (output schema)
  - The type's config block (Connector, Checkpoint, Loop or Reset)
  - Affinity: agents, models and capabilities
  - Routing: transition-source constraints and a grid of outgoing transitions
  - Children
  - Application-only tabs: Completion, Machine and Threat policy
  - Source: the node's markup

  A transition has a Transition tab (target, condition, priority, order) and a JSON tab. With nothing selected, the panel shows the node that contains the diagram.

**Nested nodes.** Composite, loop and application nodes contain child nodes. Open a container to edit its children as their own diagram; the toolbar breadcrumb leads back up. Transitions follow PSP 15: a scope's transitions name a `source_node`, and a node's own transitions without one leave from that node. A new transition joins the source node's own transitions when the node already declares them that way. Otherwise it goes to the scope's transitions.

**Conditions are authored, not evaluated.** Conditions stay free text, in natural language or as expressions. The editor never evaluates them or orders routes beyond showing their order of appearance and any priority.

**Saving.** Saving writes the PSP text through the reference codec. Content is kept as written. Tags are written on one line, with `type` first. Opening and saving a file without edits leaves it byte for byte. A Source view edits the whole file. While the markup does not parse, the editor stays in the Source view and shows the codec's error and position.

**Undo and layout.** Undo and redo cover every edit, with Ctrl+Z and Ctrl+Y. Node positions are kept in a sidecar file, `.studio/layouts/<path>.json`, never in the PSP text, so layout is not model-visible. The workspace grid hides dot folders, and `.studio/` is gitignored for workspaces inside the repository, such as the default `examples/in-context`.

### PSP assistant

**AI assistant** on the PSP applications page writes a new application, or changes an existing one, from a prompt.

- **Dialog.** You pick:
  - the file: a new path, or an existing `.psp` or `.pspx`;
  - the provider (Anthropic or OpenAI) and a model id;
  - attachments: images (PNG, JPEG, GIF, WebP), PDFs, or text documents. Each may be up to 10 MiB (text 1 MiB), at most 8 per request, 20 MiB in total.
- **Keys.** The provider key is the vault secret `anthropic.apiKey` or `openai.apiKey`. The server reads it and calls the provider. The key never reaches the browser and is never stored with a request.
- **What is sent.** The prompt, the attachments, and the current application go to the chosen provider. The dialog says so before you send.
- **Generation.** Requests run on the server in the background, so you can leave the page. The reply streams; its markup must parse with the reference codec. If it does not, the parse error goes back to the model once for a repair. A reply that still fails, is cut off at the output limit, or is refused by the provider is recorded as failed, with the reason.
- **Review.** Nothing changes on disk until you accept. A request's page shows the prompt and the model's own summary, with four views of the proposed change:
  - Changes: nodes and transitions added, removed or changed, by scope.
  - Source diff: a line diff.
  - JSON diff: the recorded jsondiffpatch delta over the parsed document tree.
  - Proposed source.
- **Accepting.** Accepting writes the file only if it is unchanged since the request: the file's SHA-256 must match. If the file changed, you're asked before it is overwritten. **Refine** sends a follow-up that starts from the proposal. **Reject** keeps the record and leaves the file alone.
- **History.** Every request is a JSON record under the workspace's `.studio/assistant/`, kept apart from the applications. A record holds:
  - the prompt;
  - attachment names, types, sizes and SHA-256 (not their contents);
  - the provider and model;
  - the text before the change and the proposal;
  - the jsondiffpatch delta, token usage and the outcome.

  **History** opens the grid of requests, for all files or one.

The assistant authors PSP text. It does not run applications, evaluate conditions, or sign anything. Signatures are added by the host at run time. Its instructions tell the model to treat attachment contents as data.

### PSPX files

A `.pspx` holds a PSP system prompt first and the application after it. That makes it one payload you can give a client that only takes pasted instructions, such as a Claude Desktop project. The layout is:

```text
<!-- PSPX/0.1 {"profile":"PSPX-0.1","interpreter":"psp-core-3.2-draft-0.1","application":"support.psp","exportedAt":"…","systemSha256":"…","applicationSha256":"…"} -->
<!-- pspx:system -->
…the PSP Core 3.2 and CDL 1.5 interpreter candidates, as the live loop prepends them…
<!-- pspx:application -->
${psp type=node node-type=application …}…${/psp}
```

- **Hashes.** Newlines are normalized to LF. The hashes cover each part's UTF-8 bytes and only detect edits; they are not signatures.
- **Installing in a desktop client.** Use the file as the project's instructions, not as a chat message. The interpreter does not treat pasted text as installed instructions.
- **Import.** Reads a `.psp` or `.pspx` from disk. A `.pspx` shows its interpreter, export time and whether each part still matches its hash. You can store it as a `.pspx` (written byte for byte) or as a `.psp` (the application alone).
- **Export.** Writes the selected file, or the editor's current text, as `.psp` or `.pspx`. You can download it, copy it, or save it to the workspace.
- **Editing.** The diagram editor opens a `.pspx` and edits its application part. Saving keeps the system prompt it had.
- **Assistant.** The assistant can create and change `.pspx` files too.

### Pipelines

A pipeline is a saved configuration of the services a PSP runs on: the Initiator that
starts a turn, LLMProxy (one component, drawn as a request half and a response half),
the Model, MCPProxy with its backend MCP server, and auxiliary taps such as a vector
store or a logger. A pipeline references a PSP, or none. It never contains or edits
the PSP. Signatures, covenants and the text belong to the PSP editor.

**Storage.** Configurations are rows in the `pipeline` table of `<data>/studio.sqlite`.
That database has numbered migrations recorded in `schema_migration`. Every row has a
UUID v7 id and a unique name (case-insensitive). Saves use optimistic concurrency: a
save carries the version it read, and a stale save gets `409 VERSION_CONFLICT`. The
`config_json` column holds `psp` and `components`; name and description have their
own columns. No table references a tenant.

**`.pspp` files.** Import and Export move one configuration as `<name>.pspp`: the
configuration JSON plus `"$format": "pspp/1"`, name and description. Nothing runs
from a file on disk.

- **Format.** The format is canonical: `psp` first, then components grouped as ring,
  terminals, loop and auxiliaries. Keys follow the kind's order and use a two-space
  indent. Row → export → import → row is byte-stable, and a graph edit changes only
  the lines it means to. [`examples/pipelines/evaluator-ring.pspp`](../examples/pipelines/evaluator-ring.pspp)
  is the handoff's worked example in this form.
- **Schema.** `pipeline.schema.json`
  ([`apps/studio-core/schemas`](../apps/studio-core/schemas/pipeline.schema.json), also
  served at `/api/pipelines/schema`) is generated from the per-kind zod schemas. Those
  same schemas drive the properties dialogs and the validator. Regenerate it with
  `node scripts/generate-pipeline-schema.mjs`; the studio-core tests fail when it is
  stale.

**Editor.** The grid at `/pipelines` has New, Edit, Duplicate, Delete, Import and
Export. Check several rows to export one file per row. The detail route has four parts:

- **Palette** (left): items grouped by role.
- **Canvas** (centre): the ring runs counter-clockwise. Card placement and handles come
  from each component's role, and no positions are stored.
- **Right panel**: the pipeline summary, validation with quick fixes, and the drop
  legend. With something selected it shows that item's details instead.
- **Initiator dock** (below the canvas).

Gestures:

- **Dropping from the palette.** A hover HUD names the outcome before release. A ring
  item splices into the nearest ring edge (within 24 px). A filter goes into the slot
  under the pointer in an LLMProxy half of its side. MCPProxy attaches to the Model.
  The PSP Document attaches on its slot. An auxiliary within 48 px of the response half
  becomes a tap. Anything else is a free node, which Validate flags.
- **Reordering filters.** Drag slots inside a half.
- **Properties.** Double-click a card or slot. Each kind's tabs follow the handoff;
  footers name what the dialog writes.
- **Document mode.** Monaco edits the same JSON with schema validation, completion,
  hover, problem markers and quick fixes. It keeps two-way sync with the canvas.
- **Validation.** The shared validator runs in the browser on every change. The server
  supplies the environment: pointer resolution, MCPProxy catalogs, keys and embedders.

**Runs.** `Run` starts a session on the saved row; unsaved edits are offered for saving
first. Each turn is one request through the ring and returns a run record with:

- the trace
- registrations, allowed and withheld
- the tool loop
- response-filter verdicts
- the reply and how it was delivered
- the taps
- the PSP Context

The dock is shaped by the trigger:

- **chat**: a composer.
- **file**: the watch queue and a drop zone that simulates a file landing.
- **email**: a paste-an-email composer.
- **webhook**: a request composer.
- **schedule**: the next fire time and Run now.

The studio has no folder watcher, mailbox reader, inbound webhook listener or
scheduler.

**What the configuration maps to.** The configuration tells the reference
implementations what to run. Several names in the design handoff have no reference
counterpart, and runs report those explicitly:

| Configuration | Reference behaviour |
| --- | --- |
| `psp` pointer, `signOnRetrieval` | `env:NAME` (the variable holds a workspace path), a workspace `.psp`/`.pspx`, or `prompt:<name>` (`prompts/<name>.md`). LLMProxy signs the text with the vault key, or a per-session key of the chosen algorithm, bound to the session (`promptContext`). A `.psp` gets the shipped interpreter prepended, as in the live loop; a `.pspx` keeps its own. |
| `psp-verify` | The loop's own `verifyEnvelope` at load, around every inference step and after every tool result. It cannot be switched off. |
| `agents-registration` | `McpDispatchGate` node affinity from the entry node's `agents` (`mcp://server/tool`). Without the slot, or without a PSP, the host names every backend tool. |
| `covenant-pruning` | Host-side: a registration is withheld when CDL `evaluatePolicy` returns `CAPABILITY_CONFLICT` or `PROCESSING_PROHIBITED` for one covenant (or data class) in context and the tool's capabilities. |
| Covenants in context | CDL `x-cdl-covenants` / `x-cdl-classes` on JSON CONTEXT payloads. PSP has no `covenants` section attribute, and CDL has no `no-email` (use `no-external-transmission`). |
| `covenant-gate` | The loop's release phase against the sink's capabilities (`chat`: can-display; `file`: can-write-filesystem, persists-data; `webhook`: can-transmit-externally). It runs before `authorizeFinal` whatever the slot order. |
| `exfil-guard` | `authorizeFinal` calls `ExfiltrationStore.assess` (PSP-EXFIL-0.1). `threshold` sets `strongDistance`; `block` picks the disposition that withholds. Without a vector store, or with an embedder this server cannot load (all-MiniLM-L6-v2 needs the pinned local ONNX model), only the lexical tier runs. PSP has no Prevent Exfilt attribute: LLMProxy registers the verified application text when a session starts and removes it when the session ends. |
| `data-use-check` | No reference implementation; reported as `unsupported`. |
| `lockdown: post-completion` | Runs `DurableLlmLoop` with `postCompletion: "lockdown"`; otherwise `BufferedLlmLoop`. |
| MCPProxy | `HttpMcpClient` with `serverInfo` pinned and a bearer token from `auth: env:NAME` (the reference client always sends one). The first run captures a catalog baseline in `<data>/mcpproxy-state.sqlite`, never in the configuration. At session start a different catalog refuses calls (or warns, with `drift: warn`), and a change mid-session fails with the client's `DISCOVERY_CHANGED`. Re-baselining is explicit and logged. The proxy does not inject covenants or augment results, and has no allowlist. |
| Tool admission | The reference gate dispatches read-only tools only. Read-only admission and capabilities come from the configuration's `tools` declarations, else the `readOnlyHint` and tool-level `x-cdl-capabilities` (CDL §5.1) recorded in the baseline. Side-effecting tools such as `send_mail` are reported as not read-only. A tool whose schema the gate refuses is excluded and reported, not fatal. |
| Model | `openai` uses the vault key through the reference live adapter. `anthropic` uses `anthropic.apiKey` through the studio's Messages adapter: the session start fails with `CREDENTIAL_MISSING` without a key, each session allows 256 calls and 2,000,000 tokens, and a failed call ends the turn with `PROVIDER_FAILED` and the provider's reason. `mock` replays `script`, or echoes. |
| Logger | JSON Lines under the pipeline's data folder. The input and reply are replaced by their SHA-256 while a covenant in context conflicts with `logs-data` (`no-log`). |
| OTel | No exporter; reported as `unsupported`. |

## HTTP API

All bodies are JSON; errors are `{error:{code,message?}}`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/status` | Profile, registered engines, inspect switch, vault mode. |
| `GET /api/templates` | Starting points for new scenarios: the campaign config example, joint case ids, study conditions. |
| `GET /api/collections`, `GET /api/collections/:id` | List or fetch collections. |
| `PUT /api/collections/:id` | Create or replace a collection; the body is validated against the schema and cross-field rules. |
| `DELETE /api/collections/:id` | Remove a collection. |
| `GET /api/workspace/files` | List `.psp`, `.pspx`, `.md`, `.txt` and `.json` files under the workspace. |
| `GET` / `PUT /api/workspace/files/<path>` | Read or atomically replace one file; paths must stay inside the workspace. |
| `GET /api/secrets` | Configured secrets (hints only) and the signing key description. |
| `PUT` / `DELETE /api/secrets/:name` | Store or remove `openai.apiKey`, `anthropic.apiKey` or `signing`. |
| `POST /api/secrets/signing/generate` | Generate HMAC or Ed25519 signing material in the vault. |
| `POST /api/runs/prepare` | `{collectionId, scenarioId}` returns the preview, warnings and any admission digest. |
| `POST /api/runs` | `{collectionId, scenarioId, label?, inspect?, admissionDigest?}` starts a run and returns `202` with the record. |
| `GET /api/runs`, `GET /api/runs/:id` | Run records. |
| `GET /api/runs/:id/events?from=&limit=` | Journal replay. |
| `POST /api/runs/:id/cancel` | Request cancellation; the live loop stops between checks, a campaign gets a `CANCEL` file, other processes are killed. |
| `GET /api/assistant/providers` | Assistant providers, suggested models and whether each key is stored. |
| `GET /api/assistant/requests?path=` | Request history, newest first, without texts or deltas. |
| `POST /api/assistant/requests` | `{mode, path, provider, model, prompt, attachments?, baseId?}` starts a request and returns `202`; bodies up to 32 MiB. |
| `GET /api/assistant/requests/:id` | One request with its before text, proposal, delta and, while running, characters received. |
| `POST /api/assistant/requests/:id/accept` | `{force?}` writes the proposal; `409 FILE_CHANGED` when the file changed since the request. |
| `POST /api/assistant/requests/:id/reject`, `.../cancel` | Reject a proposal, or stop a running request. |
| `GET /api/pspx/interpreters` | System prompts a `.pspx` can carry. |
| `POST /api/pspx/pack` | `{application, name, interpreter?, system?}` returns the `.pspx` text and manifest. |
| `POST /api/pspx/unpack` | `{text}` returns the manifest, both parts, hash checks and warnings. |
| `GET /api/pipelines`, `POST /api/pipelines` | Grid rows; create from a configuration (`201`). |
| `GET` / `PUT` / `DELETE /api/pipelines/:id` | One row with its problems and live sessions; save `{config, version}` (`409 VERSION_CONFLICT` when stale); delete (`409 SESSION_LIVE` while a session runs). |
| `POST /api/pipelines/:id/duplicate`, `GET /api/pipelines/:id/export` | Copy as `<name> (copy)`; download `<name>.pspp`. |
| `POST /api/pipelines/import?onConflict=rename\|overwrite&name=` | A raw `.pspp` body or a multipart file part; `409 NAME_CONFLICT` unless the caller chose. Overwrite keeps the id. |
| `GET /api/pipelines/schema`, `POST /api/pipelines/validate` | `pipeline.schema.json`; `{config, id?}` returns problems with quick fixes and the environment they used. |
| `GET /api/pipelines/psp?ref=` | Read-only summary of a referenced PSP: sections, signature state, CDL declarations, nodes. |
| `POST /api/pipelines/:id/session`, `DELETE .../session/:sid` | Start a session on the saved row (`422` when validation has errors); end it. |
| `POST /api/pipelines/:id/session/:sid/turn` | One turn; `{text}`, `{file}`, `{email}` or `{webhook}` by trigger. Streams trace events, then the record, with `Accept: text/event-stream`. |
| `GET /api/pipelines/:id/session/:sid/context`, `GET /api/pipelines/:id/queue` | PSP Context; workspace files matching a file trigger's `watch` glob. |
| `GET /api/pipelines/vectors/:storeId?pipeline=` | Vector store status, read-only. |
| `GET /api/pipelines/mcp/:proxyId/drift?pipeline=&live=0`, `POST .../rebaseline?pipeline=` | Drift status (`live=0` reads stored state without connecting); explicit, logged re-baseline `{note}`. |

Socket.io listens on `/studio/socket`. A client emits `subscribe {runId, fromSeq}`
and receives `replay {runId, events, done}` chunks followed by live `event`
messages; `run` messages carry record updates for every run.

## What the studio does not do

- It does not interpret PSP. Node choices, transitions and conditions remain
  the model's work inside the signed prompt; the studio only shows what the
  loops and gate did with the result.
- It does not run live studies or live held-out execution. Those keep their
  reviewed CLI flows (`evaluation/STUDY-RUNNER.md`,
  `evaluation/HELDOUT-EXECUTOR.md`) and the engine reports `UNSUPPORTED_MODE`.
- Pipelines do not watch folders, read mailboxes, serve webhooks, run schedules,
  send email replies, extract text from PDFs or export OpenTelemetry. The dock
  simulates the triggers and the run record says what was not done.
- Pipeline runs report `data-use-check` as unsupported and cannot dispatch tools that
  are not read-only; neither exists in the reference.
- Live loops and pipelines call Anthropic through a studio adapter
  (`apps/studio-server/src/engines/live-loop/anthropic.ts`), not a reference
  LLMProxy adapter. It has no conformance profile or shared vectors, and its tests
  use a mocked `fetch`; it has not been exercised against the live API here. The
  campaign engine drives Anthropic models from Python. The authoring assistant
  calls Anthropic and OpenAI directly, only to write PSP text.
- The assistant's output is a proposal, not a reviewed or tested application;
  nothing it writes carries a security or conformance claim.
- Nothing here is a release artifact. Package publication stays disabled.

## Checks

```sh
npm run build
npm test --workspace @psp-cdl/studio-core --workspace @psp-cdl/studio-server --workspace @psp-cdl/studio-web
```

The server tests run every loop kind against mock providers, drive the Python
engine adapters through a fake launcher, and exercise the HTTP API and socket
replay end to end. The assistant tests stream scripted Anthropic and OpenAI
replies through a stubbed `fetch`, covering repair, truncation, cancellation, key
rejection, attachment limits, changed-file checks and PSPX packing. The web tests
cover the journal merge and subscription logic, the API client, the run viewer,
the launcher flow, the PSP editor, the assistant dialog and review, and import and
export, against a mocked server.

The pipeline tests cover:

- **Core:** canonical serialization and byte-stable `.pspp` round trips, the generated
  schema, ring topology, splicing, filter slots, the validator, registration previews
  through CDL `evaluatePolicy`, and cron.
- **Server:** migrations, entity routes with version conflicts, import and export, and
  pointer resolution. Sessions run on the reference loop against a loopback
  `McpHttpServer`, covering pruning, a real tool call, Exfil Guard withholding a
  verbatim SYSTEM dump, the release-phase gate on a file sink, drift refusal and a
  logged re-baseline, reply `none`, SSE, and the unsupported paths.
- **Web:** the grid, the canvas, drops with the HUD, dialogs, document-mode sync, the
  dock and save conflicts, against a mocked server.

None of the tests make network calls beyond loopback.
