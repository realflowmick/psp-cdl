# SPDX-License-Identifier: Apache-2.0
"""Public synthetic key and credentials. Never use them for real data."""
import json
from pathlib import Path
from copy import deepcopy
from dispatch_fixtures import Fixture as DispatchFixture
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_llmproxy import BufferedLlmLoop, prompt_context
from psp_cdl_mcpproxy import binding_digest
from psp_cdl_api_server.persistence import WorkflowStore, StoreError

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/loop-0.1.json").read_text(encoding="utf-8"))


class Fixture:
    def __init__(self, settings=None):
        self.flags = settings or {}
        self.base = DispatchFixture(self.flags.get("base"))
        self.requests, self.phases, self.busy, self.key_revoked = [], [], 0, False
        self.key = bytes([19])*32
        self.base.principal["scopes"] += [] if self.flags.get("noModelScope") else ["models:invoke"]
        self.options = {**self.base.options, "maxSteps":self.flags.get("maxSteps", 4)}
        provider = {"id":"mock", "revision":"model-1", "complete":not self.flags.get("incompleteProvider"), "sources":[{"id":"provider", "capabilities":["used-for-model-training"] if self.flags.get("providerTraining") else []}], "invoke":self.invoke}
        self.provider = provider
        try: self.loop = BufferedLlmLoop(self.base.store, self.base.gate, self, provider)
        except Exception:
            self.close()
            raise

    def authenticate(self, token): return self.base.authenticate(token)
    def now(self): return self.base.now()
    def snapshot(self, *_):
        return {**self.base.snapshot(), "providerId":"mock", "providerRevision":"model-2" if self.flags.get("wrongProvider") else "model-1", "releaseSources":[{"id":"display", "capabilities":["can-display-to-operator"]}]}
    def prompt(self, p, binding):
        f = self.flags
        attrs = prompt_context(binding)
        if f.get("wrongPromptScope"): attrs["session-id"] = "other"
        if f.get("refreshAttribute"): attrs["refresh-policy"] = "interval"
        e = sign_envelope("Use the synthetic read tool when needed.", {"algorithm":"hmac-sha256", "signatureVersion":"2.0", "secretId":"test-signing-key", "timestamp":900, "expires":1000 if f.get("expiredPrompt") else 1700, "version":"1.0.0", "sectionType":"system", "contentType":"text", "trustLevel":f.get("promptTrust", 2), "attributes":attrs}, self.key)
        if f.get("tamperedPrompt"): e["data"] = "forged system text"
        return e
    def verification(self, *_):
        return {"keys":[{"id":"test-signing-key", "algorithm":"hmac-sha256", "material":self.key, "status":"revoked" if self.flags.get("revokedPrompt") or self.key_revoked else "active", "trustLevels":[1, 2, 5], "sectionTypes":["system"], "scope":{}, "allowUnscoped":False}]}
    def policy(self, p, binding, data, phase):
        f = self.flags
        self.phases.append(phase)
        if f.get("throwPolicy"): raise RuntimeError("PRIVATE_POLICY_DETAIL")
        if f.get("driftPhase") == phase: self.base.flags["drift"] = True
        if f.get("cancelPhase") == phase: self.base.flags["cancelled"] = True
        if f.get("timeoutPhase") == phase: self.base.flags["now"] = 1800
        if f.get("racePhase") == phase:
            try: self.base.update()
            except StoreError as exc:
                if exc.code != "STATE_BUSY": raise
                self.busy += 1
        deny = f.get("denyPhase") == phase or f.get("denyNextInference") and phase == "inference" and len(self.requests) > 0
        resource = {"classes":[], "covenants":["unknown-term"] if f.get("unsupportedPolicy") else ["no-training"], "capabilities":["used-for-model-training"] if deny else [], "checks":{}, "parameters":{}, "context":{}}
        if f.get("displayDenied") and phase == "release": resource["covenants"] = ["no-display-to-operator"]
        digest = binding_digest(binding)
        if f.get("mutateHost"):
            p["subjectId"], binding["sessionId"], data["request"]["messages"][0]["content"] = "other", "other", "forged"
        return {"bindingDigest":"wrong" if f.get("wrongBinding") else digest, "resources":[] if f.get("emptyPolicy") else [resource]}
    def authorize_final(self, *_):
        if self.flags.get("driftFinal"): self.base.flags["drift"] = True
        return False if self.flags.get("finalDenied") else "yes" if self.flags.get("nonBooleanFinal") else True
    def invoke(self, request, options):
        self.requests.append(deepcopy(request))
        f = self.flags
        if f.get("onProvider"): f["onProvider"](request, options)
        if f.get("throwProvider"): raise RuntimeError("PRIVATE_PROVIDER_DETAIL")
        if f.get("providerCancel"): self.base.flags["cancelled"] = True
        if f.get("providerTimeout"): self.base.flags["now"] = 1800
        if f.get("providerExpiry"): self.base.flags["now"] = 1700
        if f.get("providerDrift"): self.base.flags["drift"] = True
        if f.get("providerRevoke"): self.base.flags["revoked"] = True
        if f.get("providerKeyRevoke"): self.key_revoked = True
        if f.get("bypassWrite"):
            store = WorkflowStore(self.base.backend, resume_secret=bytes([7])*32, authorize_persistence=lambda *_:True)
            store.execute(self.base.actor, {"action":"updateSession", "requestId":"bypass", "sessionId":self.base.session["sessionId"], "expectedVersion":1, "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "status":"running", "state":{"changed":True}})
        if f.get("mutateProvider"): request["messages"][0]["content"] = "forged"
        if f.get("hugeResponse"): return {"type":"final", "text":"x"*1_048_577}
        if f.get("stream"): return iter(["PRIVATE_CHUNK"])
        responses = f.get("responses", [{"type":"tool", "name":"echo.read", "arguments":{"message":"hello 🧪"}}, {"type":"final", "text":"Finished 🧪"}])
        return deepcopy(responses[min(len(self.requests)-1, len(responses)-1)])
    def stats(self): return {"providerCalls":len(self.requests), "toolCalls":self.base.calls, "busy":self.busy}
    def close(self): self.base.close()


def run_case(case):
    f = None
    try:
        f = Fixture(case.get("settings"))
        size = case.get("settings", {}).get("inputSize")
        value = {"message":"x"*size} if size else case.get("request", {"message":"Read synthetic data."})
        result = f.loop.run(case.get("settings", {}).get("token", "test-owner"), f.base.session["sessionId"], value, f.options)
        return {"code":"OK", **f.stats(), "released":1, "result":result, "requests":f.requests, "phases":f.phases}
    except Exception as exc:
        return {"code":getattr(exc, "code", "UNEXPECTED_ERROR"), **(f.stats() if f else {"providerCalls":0, "toolCalls":0, "busy":0}), "released":0, "requests":f.requests if f else [], "phases":f.phases if f else []}
    finally:
        if f: f.close()
