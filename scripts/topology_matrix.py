# SPDX-License-Identifier: Apache-2.0
"""Manifest assembly and strict grading, separate from the process adapters."""
import hashlib
import json
from collections import Counter

LANGUAGES = ("typescript", "python")
STATUSES = ("passed", "failed", "blocked", "unsupported", "skipped", "error")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def index_observations(entries, cases):
    """A truncated, duplicated or extra adapter response is never partial success."""
    ids = {case["id"] for case in cases if case["kind"] != "blocked"}
    if not isinstance(entries, list) or len(entries) != len(ids):
        return None
    result = {}
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("id") not in ids or entry["id"] in result:
            return None
        if set(entry) not in ({"id", "observation"}, {"id", "error"}):
            return None
        if "error" in entry and entry["error"] != "ADAPTER_ERROR":
            return None
        result[entry["id"]] = entry
    return result


def grade(case, entry):
    if entry is None or "error" in entry:
        return "error", "Adapter execution or observation validation failed.", None
    observed = entry["observation"]
    # JSON types are significant (Python True == 1 must not create a pass).
    equal = json.dumps(observed, sort_keys=True, separators=(",", ":")) == json.dumps(case["expected"], sort_keys=True, separators=(",", ":"))
    return ("passed" if equal else "failed"), ("Exact observed decisions, effects and output match." if equal else "Observed decisions, effects or output differ from the shared expectation."), observed


def assemble(suite, provenance, observations, unavailable=None, selected=None):
    unavailable = unavailable or {}
    if selected is None:
        selected = {(host,peer) for host in LANGUAGES for peer in LANGUAGES}
    cells = []
    for topology in ("A", "B", "C"):
        for host in LANGUAGES:
            for peer in LANGUAGES:
                pair = (host,peer)
                for case in suite["cases"]:
                    observation = None
                    if case["kind"] == "blocked":
                        status, reason = "blocked", case["reason"]
                    elif topology == "A":
                        status, reason = "unsupported", "No semantic model adapter or effectiveness run; a scripted provider cannot measure Topology A."
                    elif topology == "C":
                        status, reason = "unsupported", "No complete-chain adapter with a separate MCP proxy and server-side covenant enforcement."
                    elif pair not in selected:
                        status, reason = "skipped", "Language combination omitted by the operator."
                    elif pair in unavailable:
                        status, reason = "unsupported", unavailable[pair]
                    else:
                        entries = observations.get(pair)
                        status, reason, observation = grade(case, entries.get(case["id"]) if entries else None)
                    variant = "bypass-control" if case["kind"] == "bypass" else "mediated"
                    cells.append({"topology":topology,"peerImplementation":peer,"variant":variant,"seed":case["seed"],
                        "enforcementPoints":(["host-inference","host-dispatch","host-output"] if topology == "B" and variant == "mediated" and observation is not None else []),
                        "result":{"caseId":case["id"],"implementation":host,"commit":provenance["commit"],"profile":suite["profile"],"status":status,
                            "evidence":[reason,"conformance/vectors/topologies/matrix-0.1.json#"+case["id"]]},"observation":observation})
    counts = Counter(cell["result"]["status"] for cell in cells)
    expected_runs = 4 * sum(case["kind"] != "blocked" for case in suite["cases"])
    return {"schemaVersion":1,"profile":suite["profile"],"scope":"offline-topology-b-fixtures","fullConformance":False,
        **provenance,"configuration":suite["configuration"],"summary":{status:counts[status] for status in STATUSES},
        "scopePassed":expected_runs > 0 and counts["passed"] == expected_runs and not any(counts[s] for s in ("failed","error","skipped")),
        "cells":cells}


def exit_code(report, check=False):
    if report["summary"]["failed"] or report["summary"]["error"]:
        return 1
    if check and report["scopePassed"]:
        return 0
    return 2 if any(report["summary"][s] for s in ("blocked","unsupported","skipped")) else 0
