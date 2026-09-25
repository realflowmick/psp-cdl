# SPDX-License-Identifier: Apache-2.0
"""Independent Python adapter for the offline Topology B fixture matrix."""
import json
import os
import sys
import tempfile
from pathlib import Path
from llm_fixtures import Fixture
from psp_cdl_llmproxy import BufferedLlmLoop, prompt_context
from psp_cdl_mcpproxy import McpDispatchGate, binding_digest
from psp_cdl_mcpproxy.mcp import StdioMcpClient
from psp_cdl_core.crypto import sign_envelope

ROOT = Path(__file__).resolve().parents[1]
SUITE = json.loads((ROOT / "conformance/vectors/topologies/matrix-0.1.json").read_text(encoding="utf-8"))
SERVER = json.loads((ROOT / "conformance/vectors/evaluation/servers-0.1.json").read_text(encoding="utf-8"))


def run_case(case, executable, script):
    with tempfile.TemporaryDirectory(prefix="psp-topology-") as directory:
        spy = Path(directory) / "events.jsonl"
        def events(complete=False):
            source = spy.read_text(encoding="utf-8") if spy.exists() else ""
            if complete and source and not source.endswith("\n"):
                raise RuntimeError("TRUNCATED_EVENT_LOG")
            return [json.loads(line) for line in source.split("\n")[:-1] if line]
        peer = f = None
        try:
            data = case["input"]
            perturbation = data["perturbation"]
            tool_name = data["requestedAgent"].removeprefix("mcp://").replace("/", ".")
            f = Fixture({"base":{"agents":",".join(data["agents"])},
                "providerCancel":perturbation == "cancel-before-dispatch", "bypassWrite":perturbation == "stale-state",
                "displayDenied":perturbation == "display-denial",
                "responses":[{"type":"tool","name":tool_name,"arguments":{"recordId":data["recordId"]}}, {"type":"final","text":"unused"}]})
            peer = StdioMcpClient.connect({"executable":executable,"args":[script,"benign",str(spy),case["id"]],
                "env":{**({"SystemRoot":os.environ["SystemRoot"]} if "SystemRoot" in os.environ else {}),"PSP_FIXTURE_CREDENTIAL":"synthetic-fixture-credential"},
                "serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":2000})
            def approval(name):
                return {"name":name,"revision":"1","readOnly":name == "read","complete":True,
                    "sources":[{"id":"host-fixture-registry","capabilities":data["capabilities"]}],
                    "inputSchema":SERVER["inputSchema"],"outputSchema":SERVER["outputSchema"]}
            registrations = peer.registrations("reference",[approval("read")] + ([approval("export")] if case["kind"] == "bypass" else []),f.base.now)
            read = registrations[0]
            aliases = [{**read,"name":name} for name in ("allowed","other")]
            policy = f.base.policy
            def dispatch_policy(*args):
                result = policy(*args)
                result["resources"][0]["covenants"] = data["covenants"]
                return result
            f.base.policy = dispatch_policy
            if data.get("kid"):
                f.prompt = lambda _p,b:sign_envelope("Use the synthetic read tool when needed.",
                    {"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":data["kid"],"timestamp":900,"expires":1700,"version":"1.0.0",
                     "sectionType":"system","contentType":"text","trustLevel":2,"attributes":prompt_context(b)},bytes([19])*32)
                f.verification = lambda *_:{"keys":data["trustedKeys"]}
            invoke = f.provider["invoke"]
            def provider_invoke(request, options):
                response = invoke(request, options)
                if response["type"] == "final":
                    message = next(m for m in reversed(request["messages"]) if m["role"] == "tool")
                    return {"type":"final","text":message["data"]["message"]}
                return response
            provider = {**f.provider,"invoke":provider_invoke}
            gate = McpDispatchGate(f.base.store,f.base,"registry-1",aliases)
            loop = BufferedLlmLoop(f.base.store,gate,f,provider)
            options = {**f.options,"cancelled":lambda:bool(f.base.flags.get("cancelled")) or
                perturbation == "cancel-after-read" and any(e["kind"] == "read" for e in events())}
            codes, outputs = [], []
            def attempt():
                try:
                    result = loop.run(data["token"],f.base.session["sessionId"],{"message":SUITE["configuration"]["userMessage"]},options)
                    if result["provenance"]["trustLevel"] != 5 or result["provenance"]["outputDigest"] != binding_digest({"text":result["text"]}):
                        raise RuntimeError("INVALID_PROVENANCE")
                    codes.append("OK")
                    outputs.append(result["text"])
                except Exception as exc:
                    if not hasattr(exc,"code"): raise
                    codes.append(exc.code)
            if case["kind"] == "bypass":
                output = registrations[1]["invoke"]({"recordId":data["recordId"]},options)
                codes.append("OK")
                outputs.append(output["message"])
            elif perturbation == "replay-old-prompt":
                captured = None
                prompt = f.prompt
                def capture(*args):
                    nonlocal captured
                    captured = prompt(*args)
                    return captured
                f.prompt = capture
                attempt()
                f.prompt = lambda *_:captured
                f.base.update()
                attempt()
            else:
                attempt()
            state = f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})
            peer.close()
            peer = None
            observed = events(True)
            if not observed or observed[0]["kind"] != "isolation-probes-blocked" or any(e["sequence"] != i+1 or e["correlation"] != case["id"] for i,e in enumerate(observed)):
                raise RuntimeError("INVALID_EVENT_LOG")
            private_values = ["test-owner","test-tenant","tenant-a","subject-a","test-signing-key","synthetic-fixture-credential",f.base.session["sessionId"],"sessionVersion"]
            return {"codes":codes,"providerCalls":len(f.requests),"events":[{"kind":e["kind"],"recordId":e["recordId"]} for e in observed],"outputs":outputs,
                "providerToolMessages":[m["data"]["message"] for r in f.requests for m in r["messages"] if m["role"] == "tool"],
                "sessionVersion":state["version"],"authorityLeak":any(v in json.dumps(f.requests) for v in private_values)}
        finally:
            try:
                if peer: peer.close()
            finally:
                if f: f.close()


if __name__ == "__main__":
    report = []
    for case in SUITE["cases"]:
        if case["kind"] == "blocked": continue
        try: report.append({"id":case["id"],"observation":run_case(case,*sys.argv[1:])})
        except Exception: report.append({"id":case["id"],"error":"ADAPTER_ERROR"})
    print(json.dumps(report))
