# Isolated governed and adversarial MCP fixtures

These paired TypeScript/Python stdio MCP servers use fixed public synthetic
records, keys and credentials. Run after building/installing the workspace:

```sh
uv run --locked python scripts/check-evaluation-parity.py
```

The runner exercises both proxy languages against both fixture languages: 15
cases × four combinations. The shared [fixture contract and expectations](../conformance/vectors/evaluation/servers-0.1.json)
define schemas, record IDs, canary, attack text and modes. No provider or model
is called. Host policy applies the existing deterministic `no-training`
constraint; recipient capability conflicts are supplied by the trusted fixture
host. Server metadata never supplies approval or host authority.

Each endpoint advertises `read` and `export`. The gated path approves only the
read tool and exact schemas. The export tool writes a correlated event to a
local synthetic sink; it never sends data to an external destination. The
benign/public task succeeds. Governed dispatch denial produces no read/export
event; output denial permits the read but suppresses the canary. Forged hints,
provenance and capability metadata cannot create an export route. Unexpected
URL arguments fail before a tool call.

Modes include discovery drift, malformed structured data, a deliberately
oversized frame, a hung call, and validly signed malicious text. Host cancellation
is tested both before dispatch and after an observed read event. The latter
does not undo that read. The signed attack is inert content: the test verifies
its real signature and records zero exports; it makes no claim about how a
model would respond. A direct bypass control intentionally invokes `export`
outside the gate and observes the canary and export event. That negative control
must keep succeeding: removing mediation removes the demonstrated protection.

## Process and I/O boundary

The launcher uses fixed absolute runtime/script paths, no shell, dedicated
stdin/stdout pipes and an explicit environment containing only the synthetic
credential and Windows `SystemRoot` when needed. It opens no listener, including
on loopback. Tool arguments cannot select a process, path, endpoint or URL.
Startup probes confirm that fixture runtime network and child-process APIs
are disabled; probe events are required in every report. Python uses an audit
hook; Node disables its network/child APIs before serving. These are accident
prevention controls for repository-owned code, **not an OS sandbox for arbitrary
malicious code or native extensions**. Running third-party adversarial binaries
requires a separate OS/container network-deny sandbox and is unsupported here.

Normal framing uses the existing strict 1 MiB stdio adapter. The oversize mode
emits exactly 1 MiB + 1 byte to test rejection. The peer timeout is two seconds;
each server also has a 30-second lifetime ceiling. Requests are sequential,
records and arguments are finite, and the spy log allows at most 128 events.
All tool data stays in memory and the temporary event sink; no customer data or
ambient credential environment is read. Temp directories, child handles and
SQLite hosts are closed in `finally` paths, including cancellation and failure.
There are no child-process descendants, retries or background listeners.

Events carry sequence, case correlation ID, kind and record ID. Results report
actual reads/exports, released output and canary presence separately from error
codes. The entire report must match across language combinations. Refusal text,
signature validity and a build result are never substituted for observed effects.
HTTP/TLS boundary fixtures already live in `scripts/check-http-parity.py`; this
slice deliberately uses private pipes for evaluation endpoints. Topology A/B/C
studies, statistical effectiveness and independent grading remain #48/#49.
