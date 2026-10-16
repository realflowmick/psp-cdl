# SPDX-License-Identifier: Apache-2.0
"""Observer wrapper over the existing synthetic fixtures. No credentials, no live providers."""
import json
from copy import deepcopy
from pathlib import Path
from llm_fixtures import run_case as run_loop
from durable_fixtures import run_case as run_durable
from refresh_fixtures import run_case as run_refresh
from context_service_fixtures import run_case as run_context
from dispatch_fixtures import run_case as run_gate

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/observer-0.1.json").read_text(encoding="utf-8"))
RUNNERS = {"buffered":run_loop, "durable":run_durable, "refresh":run_refresh, "context":run_context, "gate":run_gate}


def redact(event):
    """Prompt-derived digests bind the random session id; everything else is deterministic."""
    data = dict(event["data"])
    if "promptDigest" in data: data["promptDigest"] = "<prompt-digest>"
    if event["type"].startswith("prompt.") and "digest" in data: data["digest"] = "<prompt-digest>"
    return {**event, "data":data}


def run_case(c):
    events = []
    def observer(event):
        events.append(event)
        if c.get("observerThrows"): raise RuntimeError("PRIVATE_OBSERVER_DETAIL")
    observe = {"observer":observer, **({"level":c["level"]} if c.get("level") else {})}
    case = deepcopy(c["case"])
    if c["engine"] == "context": case["flags"] = {**case.get("flags", {}), "observe":observe}
    else:
        settings = case.get("settings", {})
        case["settings"] = {**settings, "observe":observe, "base":{**settings.get("base", {}), "observe":observe}}
    result = RUNNERS[c["engine"]](case)
    codes = result["codes"] if type(result.get("codes")) is list else [result["code"]]
    session_id = next((e["scope"]["sessionId"] for e in events if type(e["scope"].get("sessionId")) is str), None)
    value = {"codes":codes, "types":[e["source"]+":"+e["type"] for e in events], "events":[redact(e) for e in events]}
    text = json.dumps(value, ensure_ascii=False)
    return json.loads(text.replace(session_id, "<session>") if session_id else text)
