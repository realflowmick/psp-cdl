# SPDX-License-Identifier: Apache-2.0
"""Freeze the proposed API contract set and validate (never grant) adoption."""
import argparse
import hashlib
import json
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCUMENT = "RFC-PSP-API-1.0.0-candidate.1"
GROUPS = (
    ("security", "security-tools"),
    ("workflow", "workflow-tools"),
    ("lifecycle", "lifecycle-tools"),
    ("security-tools", "security-tools-extension"),
)
PROFILES = (
    "PSP-SERVICE-0.1", "PSP-WORKFLOW-SERVICE-0.1", "PSP-PERSISTENCE-0.1",
    "PSP-LIFECYCLE-0.1", "PSP-SECURITY-TOOLS-0.1", "PSP-SIGNATURE-2.0",
    "PSP-CODEC-1.0", "CDL-DETERMINISTIC-1.0", "PSP-TRUST-1.0",
)
SCOPES = {
    "verify": "security:verify", "evaluate": "policy:evaluate",
    "createSession": "sessions:write", "getSession": "sessions:read",
    "updateSession": "sessions:write", "listSessions": "sessions:read",
    "getNode": "nodes:read", "createCheckpoint": "checkpoints:write",
    "resumeCheckpoint": "checkpoints:resume", "cancelSession": "sessions:cancel",
    "purgeSession": "sessions:purge", "scan": "security:scan",
    "decrypt": "security:decrypt", "process": "security:process",
}
EVIDENCE = (
    ("service", "conformance/vectors/services/profile-0.1.json", "scripts/check-service-parity.py"),
    ("workflow", "conformance/vectors/workflows/service-0.1.json", "scripts/check-workflow-parity.py"),
    ("lifecycle", "conformance/vectors/workflows/lifecycle-0.1.json", "scripts/check-lifecycle-parity.py"),
    ("security-tools", "conformance/vectors/services/security-tools-0.1.json", "scripts/check-security-tools-parity.py"),
)


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256((ROOT / path).read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def instant(value):
    assert isinstance(value, str) and value.endswith("Z"), "UTC review timestamp required"
    return datetime.fromisoformat(value[:-1]+"+00:00")


def check_adoption(record, now=None):
    """Check the recorded gate; fields are not proof of a maintainer's authority."""
    now = now or datetime.now(timezone.utc)
    assert record["document"] == DOCUMENT
    assert record["status"] in ("draft", "public-review", "proposed-standard")
    assert type(record["accepted"]) is bool
    assert record["accepted"] == (record["status"] == "proposed-standard")
    review = record["review"]
    assert type(review["minimumCommentDays"]) is int and review["minimumCommentDays"] >= 14
    if record["status"] == "draft":
        assert all(review[k] is None for k in ("url", "openedAt", "lastSubstantiveChangeAt", "closesNoEarlierThan"))
    else:
        assert re.fullmatch(r"https://github\.com/realflowmick/psp-cdl/pull/[1-9][0-9]*", review["url"] or "")
        opened, changed, closes = (instant(review[k]) for k in ("openedAt", "lastSubstantiveChangeAt", "closesNoEarlierThan"))
        assert opened <= changed <= now, "Review cannot start before publication or in the future"
        assert closes >= changed + timedelta(days=review["minimumCommentDays"]), "Full comment window required after substantive changes"
    decision = record["maintainerDecision"]
    if not record["accepted"]:
        assert decision is None, "Acceptance needs an explicit proposed-standard transition"
    else:
        assert closes <= now, "Comment window has not elapsed"
        assert isinstance(decision, dict) and decision["by"] == "realflowmick"
        assert closes <= instant(decision["at"]) <= now
        assert isinstance(decision["rationale"], str) and decision["rationale"].strip()
        assert isinstance(decision["recordUrl"], str) and decision["recordUrl"].startswith(review["url"])
        assert type(decision["independentReview"]) is bool
        assert all(c.get("disposition") in ("accepted", "rejected-with-rationale", "deferred-with-rationale") and c.get("rationale") for c in record["comments"]), "Unresolved review comment"
        outcomes = {d["id"]: d["status"] for d in record["dispositions"]}
        assert all(outcomes[k] == "accepted" for k in ("PSP-E006", "DOC-E001", "API1-COMPATIBILITY", "FINAL-ADOPTION"))
    assert all(d["status"] in ("proposed", "accepted", "blocked", "still-draft") for d in record["dispositions"])
    if not record["accepted"]:
        assert not any(d["status"] == "accepted" for d in record["dispositions"]), "No implicit partial adoption"


def external_refs(value, filename):
    if isinstance(value, list):
        return [external_refs(v, filename) for v in value]
    if isinstance(value, dict):
        return {k: ("./"+filename+v if k == "$ref" and v.startswith("#/") else external_refs(v, filename)) for k, v in value.items()}
    return value


def resolve(value, source):
    if isinstance(value, list):
        return [resolve(v, source) for v in value]
    if isinstance(value, dict):
        if "$ref" in value:
            assert len(value) == 1, "Reference siblings need an explicit resolution rule"
            filename, pointer = value["$ref"].split("#", 1)
            target = (source.parent / filename).resolve() if filename else source
            assert target.is_relative_to(ROOT)
            node = json.loads(target.read_text(encoding="utf-8"))
            for token in pointer.lstrip("/").split("/"):
                node = node[token.replace("~1", "/").replace("~0", "~")]
            return resolve(node, target)
        return {k: resolve(v, source) for k, v in value.items()}
    return value


def anchor(heading):
    return re.sub(r"[^\w\s-]", "", heading.lstrip("# ").lower()).replace(" ", "-")


def generate():
    editorial = read("specs/errata/api-editorial-0.1.json")
    required = [t["name"] for t in editorial["requiredTools"]]
    assert len(required) == len(set(required)) == 11
    api = {"openapi": "3.1.0", "info": {"title": "PSP API adoption candidate (not adopted)", "version": "1.0.0-candidate.1"},
           "x-psp-document": DOCUMENT, "paths": {}, "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}}}
    catalog = {"document": DOCUMENT, "status": "candidate-not-adopted", "protocolVersion": "2025-11-25", "requiredTools": required, "tools": []}
    sources, operations = [], []
    for http_name, mcp_name in GROUPS:
        http_path, mcp_path = f"schemas/api/{http_name}-0.1.openapi.json", f"schemas/mcp/{mcp_name}-0.1.json"
        sources.extend((http_path, mcp_path))
        source, tools = read(http_path), read(mcp_path)
        assert tools["protocolVersion"] == catalog["protocolVersion"]
        names = {t["name"]: t for t in tools["tools"]}
        for path, item in source["paths"].items():
            assert path not in api["paths"]
            tool_name = "realflow."+path.removeprefix("/v1/").replace("/", ".")
            tool, op = names[tool_name], item["post"]
            for key, schema in (("inputSchema", op["requestBody"]["content"]["application/json"]["schema"]), ("outputSchema", op["responses"]["200"]["content"]["application/json"]["schema"])):
                assert resolve(schema, ROOT/http_path) == tool[key], f"HTTP/MCP schema drift: {tool_name} {key}"
            copied = external_refs(deepcopy(item), Path(http_path).name)
            copied["post"].update({"x-required-scope": SCOPES[op["operationId"]], "x-psp-required": tool_name in required, "x-mcp-tool": tool_name})
            api["paths"][path] = copied
            catalog["tools"].append(deepcopy(tool))
            operations.append({"name": tool_name, "path": path, "operationId": op["operationId"], "scope": SCOPES[op["operationId"]], "required": tool_name in required, "httpContract": http_path, "mcpContract": mcp_path})
    assert len(operations) == len({o["name"] for o in operations}) == 14
    assert {o["name"] for o in operations if o["required"]} == set(required)
    sources += [f"specs/profiles/{p}.md" for p in PROFILES]
    sources += ["specs/api/RFC-PSP-API-v1_0_0-candidate.md", "specs/errata/PSP-API-EDITORIAL-0.2.md", "specs/errata/api-editorial-0.1.json"]
    evidence = []
    for name, vector, runner in EVIDENCE:
        cases = read(vector)["httpCases" if name == "service" else "cases"]
        assert (ROOT / runner).is_file()
        evidence.append({"group": name, "vectors": vector, "caseCount": len(cases), "runner": runner, "claim": "scoped-implementation-evidence-not-normative-acceptance"})
    document = (ROOT / sources[-3]).read_text(encoding="utf-8")
    ids = re.findall(r"\*\*(API1-[A-Z]+-[0-9]{3})\.\*\*", document)
    assert len(ids) == len(set(ids)) == 20
    inventory = read("conformance/requirements.json")
    affected = [e["id"] for e in inventory["keywordAudit"] if e["disposition"] == "obligation-candidate" and e["path"].endswith("RFC-PSP-CORE-v3_2_0.md") and any("22.5" in heading or "21.5.4" in heading or "21.5.5" in heading for heading in e["heading"])]
    assert affected, "Core API requirements must remain traceable"
    index = {"schemaVersion": 1, "document": DOCUMENT, "status": "candidate-not-adopted", "digestForm": "sha256-utf8-lf",
             "sources": [{"path": p, "sha256": digest(p)} for p in sources], "operations": operations,
             "requirementIds": ids, "affectedCoreRequirementIds": affected,
             "baselineSources": [{**s, "digestForm": "sha256-raw-bytes"} for s in inventory["sources"]],
             "evidence": evidence, "absentReferences": editorial["references"],
             "editorialCorrections": [{**c, "sourceAnchor": anchor(c["old"]), "proposedAnchor": anchor(c["proposed"]), "targetEdition": None} for c in editorial["editorialCorrections"]]}
    return {"schemas/api/psp-api-1.0.0-candidate.openapi.json": api,
            "schemas/mcp/psp-api-1.0.0-candidate.json": catalog,
            "specs/api/contract-set-1.0.0.json": index}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    check_adoption(read("specs/api/adoption-1.0.0.json"))
    for path, data in generate().items():
        if args.check:
            assert read(path) == data, "Stale API candidate: "+path
        else:
            (ROOT/path).write_text(json.dumps(data, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
    print("Eleven required tools, three extensions, pinned contracts and adoption gate checked; acceptance is a separate maintainer decision.")
