# SPDX-License-Identifier: Apache-2.0
"""Shared PSP-OBSERVE-0.1 event contract. Events are development telemetry, never authority or evidence."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
I = {"type":"integer", "minimum":0, "maximum":9007199254740991}
S = {"type":"string"}
B = {"type":"boolean"}
D = {"type":"string", "pattern":"^[a-f0-9]{64}$"}
def N(t): return {"anyOf":[t, {"type":"null"}]}
def A(item): return {"type":"array", "items":item}
PROMPT = {"digest":D, "textBytes":I, "version":S, "trustLevel":{"type":"integer", "minimum":0, "maximum":5}, "timestamp":I, "expires":I}
DECISION = {"phase":{"enum":["inference", "tool", "release", "dispatch", "recovery"]}, "decision":{"enum":["allow", "deny", "unsupported"]}, "reasonCodes":A(S), "resourceCount":I}
LOOP, GATE, BOTH = ["llmproxy"], ["mcpproxy"], ["llmproxy", "mcpproxy"]
# type -> (sources, data properties, optional keys)
EVENTS = {
    "turn.start":(LOOP, {"inputBytes":I, "maxSteps":I, "deadline":I, "providerId":S, "providerRevision":S}, ()),
    "session.loaded":(LOOP, {"sessionVersion":I, "nodeId":S, "nodeVersion":S, "policyVersion":S, "authorityRevision":S, "registryRevision":S, "expires":I, "stateBytes":I}, ()),
    "prompt.loaded":(LOOP, PROMPT, ()),
    "prompt.replaced":(LOOP, PROMPT, ()),
    "tools.listed":(LOOP, {"count":I, "names":A(S)}, ()),
    "step.start":(LOOP, {"step":I}, ()),
    "prompt.assembled":(LOOP, {"messageCount":I, "bytes":I, "toolCount":I, "promptDigest":D}, ()),
    "cdl.decision":(BOTH, DECISION, ()),
    "inference.start":(LOOP, {"bytes":I, "messageCount":I}, ()),
    "inference.end":(LOOP, {"ok":B}, ()),
    "model.candidate":(LOOP, {"type":{"enum":["tool", "final", "invalid"]}, "toolName":N(S), "textBytes":N(I)}, ()),
    "dispatch.requested":(LOOP, {"step":I, "toolName":S, "argumentBytes":I}, ()),
    "transcript.grew":(LOOP, {"messageCount":I, "bytes":I, "toolName":S, "dataBytes":I, "limit":I}, ()),
    "final.authorized":(LOOP, {"step":I, "outputDigest":D, "textBytes":I}, ()),
    "turn.buffered":(LOOP, {"steps":I, "outputDigest":D}, ()),
    "turn.failed":(LOOP, {"code":S}, ()),
    "lockdown":(LOOP, {"lockedAt":I, "policy":{"const":"lockdown"}}, ()),
    "turn.planned":(LOOP, {"stateBytes":I, "retainedBytes":I, "complete":B}, ()),
    "turn.committed":(LOOP, {"sessionVersion":I, "status":S, "stateBytes":I, "retainedBytes":I, "complete":B}, ()),
    "turn.released":(LOOP, {"sessionVersion":I}, ()),
    "turn.recovered":(LOOP, {"sessionVersion":I, "status":S}, ()),
    "durable.failed":(LOOP, {"code":S}, ()),
    "refresh.due":(LOOP, {"trigger":{"enum":["expiration", "interval"]}}, ()),
    "refresh.signal":(LOOP, {"signal":{"enum":["prompt_initialized", "prompt_bound", "prompt_refreshed", "prompt_refresh_failed", "prompt_refresh_rollback"]}, "trigger":S, "previousVersion":N(S), "version":S, "digest":D, "code":S}, ("version", "digest", "code")),
    "round.start":(LOOP, {"round":I, "historyMessages":I, "historyBytes":I, "viewBytes":I}, ()),
    "service.proposed":(LOOP, {"round":I, "operation":S, "argumentBytes":I}, ()),
    "service.result":(LOOP, {"round":I, "operation":S, "event":{"enum":["service-result", "service-denied"]}, "code":N(S), "resultBytes":N(I)}, ()),
    "checkpoint.waiting":(LOOP, {"round":I}, ()),
    "round.answer":(LOOP, {"rounds":I, "outputDigest":D}, ()),
    "context.failed":(LOOP, {"code":S}, ()),
    "dispatch.enter":(GATE, {"operation":{"enum":["listTools", "callTool"]}, "allowedCount":I, "registeredCount":I}, ()),
    "dispatch.start":(GATE, {"toolName":S, "toolUri":S, "toolRevision":S, "inputDigest":D, "argumentBytes":I}, ()),
    "dispatch.guard":(GATE, {"present":B, "ok":B}, ()),
    "tool.invoke.start":(GATE, {"toolName":S}, ()),
    "tool.invoke.end":(GATE, {"ok":B}, ()),
    "tool.output":(GATE, {"outputBytes":I, "outputDigest":D}, ()),
    "dispatch.released":(GATE, {"toolName":S, "outputDigest":D}, ()),
    "dispatch.failed":(GATE, {"operation":S, "code":S}, ()),
}
def event(type_, sources, props, optional):
    return {"type":"object", "additionalProperties":False, "required":["profile", "source", "type", "scope", "data"],
            "properties":{"profile":{"const":"PSP-OBSERVE-0.1"}, "source":{"enum":sources}, "type":{"const":type_}, "scope":{"$ref":"#/$defs/scope"},
                          "data":{"type":"object", "additionalProperties":False, "required":[k for k in props if k not in optional],
                                  "properties":{**props, "payload":{"type":"object", "$comment":"Present only at inspect level; model-visible material only."}}}}}
defs = {"scope":{"type":"object", "additionalProperties":False, "properties":{"sessionId":S, "requestId":S, "step":I, "round":I}},
        "event":{"oneOf":[{"$ref":"#/$defs/"+t} for t in EVENTS]}}
for t, (sources, props, optional) in EVENTS.items(): defs[t] = event(t, sources, props, optional)
schema = {"$schema":"https://json-schema.org/draft/2020-12/schema", "$id":"https://realflowcloud.org/psp/schemas/observer-0.1.json",
          "title":"PSP Observe 0.1 development events",
          "$comment":"CC0-1.0. Fire-and-forget telemetry emitted by the buffered loops and the dispatch gate. Events never carry credentials, principals, verification keys or policy resource contents; they are not audit evidence and assert no security property.",
          "$defs":defs, "$ref":"#/$defs/event"}
path = ROOT/"schemas/observer-0.1.schema.json"
content = json.dumps(schema, ensure_ascii=False, indent=2) + "\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8") != content: raise SystemExit("Observer schema is stale")
else: path.write_text(content, encoding="utf-8")
print(f"Observer event schema checked ({len(EVENTS)} event types)")
