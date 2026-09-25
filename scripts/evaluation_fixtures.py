# SPDX-License-Identifier: Apache-2.0
import json
import os
import tempfile
from pathlib import Path
from dispatch_fixtures import Fixture
from psp_cdl_mcpproxy import McpDispatchGate
from psp_cdl_mcpproxy.mcp import StdioMcpClient
from psp_cdl_core import parse_envelope
from psp_cdl_core.crypto import verify_signature

ROOT = Path(__file__).resolve().parents[1]
SUITE = json.loads((ROOT / "conformance/vectors/evaluation/servers-0.1.json").read_text(encoding="utf-8"))
SIGNATURES = json.loads((ROOT / "conformance/vectors/signatures/profile-2.0.json").read_text(encoding="utf-8"))


def run_case(case, executable, script):
    with tempfile.TemporaryDirectory(prefix="psp-evaluation-") as directory:
        spy = Path(directory) / "events.jsonl"
        def events():
            return [json.loads(line) for line in spy.read_text(encoding="utf-8").split("\n")[:-1] if line] if spy.exists() else []
        peer = f = None
        code, data, signature_verified = "OK", None, False
        try:
            f = Fixture(case.get("settings"))
            peer = StdioMcpClient.connect({"executable":executable,"args":[script,case["mode"],str(spy),case["id"]],
                "env":{**({"SystemRoot":os.environ["SystemRoot"]} if "SystemRoot" in os.environ else {}),"PSP_FIXTURE_CREDENTIAL":"synthetic-fixture-credential"},
                "serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"},"timeoutMs":2000})
            def approval(name):
                return {"name":name,"revision":"1","readOnly":name == "read","sources":[{"id":"host-fixture-registry","capabilities":[]}],"complete":True,"inputSchema":SUITE["inputSchema"],"outputSchema":SUITE["outputSchema"]}
            registrations = peer.registrations("echo", [approval("read")] + ([approval("export")] if case.get("bypass") else []), f.now)
            options = {"deadline":1800,"cancelled":lambda:bool(f.flags.get("cancelled")) or bool(case.get("cancelOnRead") and any(e["kind"] == "read" for e in events()))}
            args = {"recordId":case["recordId"], **case.get("extraArguments", {})}
            if case.get("bypass"):
                data = next(r for r in registrations if r["name"] == "export")["invoke"](args, options)
            else:
                gate = McpDispatchGate(f.store, f, "registry-1", registrations)
                result = gate.call_tool("test-owner", f.session["sessionId"], {"name":"echo." + case.get("tool", "read"),"arguments":args}, options)
                assert result["provenance"]["trustLevel"] == 5 and '"approved": true' not in json.dumps(result), "FORGED_PROVENANCE_RELEASED"
                data = result["data"]
            if case["mode"] == "signed-malicious":
                signature_verified = verify_signature(parse_envelope(data["message"]), bytes.fromhex(SIGNATURES["testKeys"]["ed25519"]["publicKeyHex"]))
        except Exception as error:
            if not hasattr(error, "code"): raise
            code = error.code
        finally:
            if peer: peer.close()
            if f: f.close()
        observed = events()
        assert observed and observed[0]["kind"] == "isolation-probes-blocked", "ISOLATION_NOT_OBSERVED"
        return {"id":case["id"],"code":code,"events":observed,"reads":sum(e["kind"] == "read" for e in observed),
                "exports":sum(e["kind"] == "export" for e in observed),"released":int(data is not None),
                "canaryReleased":SUITE["records"]["restricted"] in json.dumps(data),"signatureVerified":signature_verified}
