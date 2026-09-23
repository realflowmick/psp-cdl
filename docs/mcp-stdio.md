# MCP stdio mediation

The proxy now connects an authenticated local MCP caller to an explicitly approved downstream process through `McpDispatchGate`. Both language implementations use the existing MCP 2025-11-25 dispatcher and framing. See the [draft profile](../specs/profiles/PSP-MCP-STDIO-0.1.md) for the exact supported subset.

The host controls the executable, environment, credentials, session and registry. Model requests contain only a namespaced tool name and arguments. Each call still passes node affinity, input schema, CDL and output-release checks. Discovered read-only hints or capability claims cannot supply host approval.

```ts
import { StdioMcpClient, createMcpProxy, serveStdio } from "@psp-cdl/mcpproxy/mcp";
import { McpDispatchGate } from "@psp-cdl/mcpproxy";
const peer = await StdioMcpClient.connect({
  executable: absoluteExecutable, args: trustedArgs, env: explicitEnvironment,
  serverInfo: { name: expectedName, version: expectedVersion }, timeoutMs: 5000
});
try {
  const registrations = peer.registrations("documents", approvedTools, () => host.now());
  const gate = new McpDispatchGate(coordinatedStore, host, "registry-1", registrations);
  const proxy = createMcpProxy(gate, credential, trustedSessionId,
    () => ({ deadline: host.now() + 30, cancelled: () => abortSignal.aborted }));
  await serveStdio(proxy);
} finally { await peer.close(); }
```

```python
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import StdioMcpClient, create_mcp_proxy, serve_stdio
peer = StdioMcpClient.connect({
    "executable": absolute_executable, "args": trusted_args, "env": explicit_environment,
    "serverInfo": {"name": expected_name, "version": expected_version}, "timeoutMs": 5000
})
try:
    registrations = peer.registrations("documents", approved_tools, host.now)
    gate = McpDispatchGate(coordinated_store, host, "registry-1", registrations)
    proxy = create_mcp_proxy(gate, credential, trusted_session_id,
        lambda: {"deadline": host.now() + 30, "cancelled": cancelled_event.is_set})
    serve_stdio(proxy)
finally:
    peer.close()
```

The examples assume the host clock uses seconds. Each approval contains `name`, `revision`, boolean `readOnly`, complete `sources`/`complete`, `inputSchema` and `outputSchema` from the [gate contract](mcp-dispatch.md). The adapter supplies `server` and `invoke`. Schema mismatches reject registration. The caller owns cleanup if approval or gate construction fails. The environment is explicit and not inherited; include only variables the approved executable needs (for example `SystemRoot` on Windows), with private credentials delivered by the host. Never construct executable paths or arguments from model output.

`peer.catalogDigest` / `peer.catalog_digest` exposes the pinned discovery fingerprint for host records. Every invocation rechecks full discovery before calling and after receiving output. Observed drift or a protocol failure closes the connection; re-establishment is an explicit host decision. Endpoint identity comes from the launcher and dedicated pipes, not the server's self-reported name. Polling does not make a remote revision atomic: the host must keep approved endpoint behavior stable for that connection.

The proxy returns checked data as MCP `structuredContent`, matching its advertised output schema. It regenerates text from that object and adds local level-5 provenance under `_meta["psp-cdl/provenance"]`. Downstream text must agree with structured data; downstream metadata and raw errors are never relayed. Responses are fully buffered, and the serialized frame must fit 1 MiB.

Timeouts and host cancellation close the owned direct child. The sequential upstream dispatcher cannot service an MCP cancellation notification while it is waiting for a tool; use host cancellation controls and the finite downstream timeout. A sent call cannot be undone. No shell, inherited credential environment, automatic retries or reconnects are used.

Run [the paired demonstration](../examples/mediation/README.md) or `python scripts/check-mediation-parity.py` after building. The tests include real three-process mixed-language chains and actual tool-spy counts. Streamable HTTP/OAuth, remote TLS identity, streaming, hot registry changes, mutating tools and distributed dispatch remain later work. This reference layer requires no SaaS account or paid provider.
