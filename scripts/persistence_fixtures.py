# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path
from psp_cdl_api_server.persistence import WorkflowStore, StoreError
from psp_cdl_api_server.sqlite import SqliteBackend

FIXTURE = json.loads((Path(__file__).resolve().parents[1] / "conformance/vectors/persistence/profile-0.1.json").read_text(encoding="utf-8"))
SECRET = bytes([42]) * 32  # Public synthetic test secret only.


def resolve_refs(value, results):
    if type(value) is list:
        return [resolve_refs(v, results) for v in value]
    if type(value) is dict:
        if set(value) == {"$ref"}:
            out = results
            for part in value["$ref"].split("."):
                out = out[part]
            return out
        return {k: resolve_refs(v, results) for k, v in value.items()}
    return value


def run_fixture(path):
    now, allowed = FIXTURE["now"], True
    def open_store():
        backend = SqliteBackend(str(path), FIXTURE["epoch"], lambda: now)
        return backend, WorkflowStore(backend, resume_secret=SECRET, authorize_persistence=lambda *_: allowed)
    backend, store = open_store()
    results, report = {}, []
    try:
        for step in FIXTURE["steps"]:
            if step.get("control") == "restart":
                backend.close()
                backend, store = open_store()
                continue
            if step.get("control") == "clock":
                now = step["value"]
                continue
            allowed = step.get("allow", True)
            command, actor = resolve_refs(step["command"], results), step.get("actor", FIXTURE["actor"])
            if "error" in step:
                try:
                    store.execute(actor, command)
                except StoreError as exc:
                    assert exc.code == step["error"], (step["id"], exc.code)
                else:
                    raise AssertionError(step["id"] + ": expected failure")
            else:
                actual = store.execute(actor, command)
                expected = resolve_refs(step["expect"], results)
                if "$ref" in step["expect"]:
                    assert actual == expected, step["id"]
                else:
                    for k, v in expected.items():
                        assert actual[k] == v, (step["id"], k)
                results[step["id"]] = actual
            report.append(step["id"])
        return report
    finally:
        backend.close()
