# SPDX-License-Identifier: Apache-2.0
"""Runs shared fixtures through the public libraries; no provider/tool calls."""
from copy import deepcopy
from typing import Any, Callable

import psp_cdl_core as core
import psp_cdl_core.crypto as crypto
import psp_cdl_cdl as cdl


def execute_policy_case(case: dict) -> Any:
    data = case["input"]
    def ok(**extra):
        return {"decision": "allow", "reasonCodes": [], **extra}
    try:
        match case["operation"]:
            case "normalize":
                return ok(tokens=cdl.normalize_declaration(data["kind"], data["declaration"]))
            case "inherit":
                state = cdl.inherit_policy(data["path"], data["grants"])
                return ok(classes=state["classes"], covenants=state["covenants"])
            case "aggregate":
                return ok(capabilities=cdl.aggregate_capabilities(data["sources"], data["complete"]))
            case "evaluate":
                return cdl.evaluate_policy(data)
            case "evaluate-batch":
                return cdl.evaluate_batch(data["resources"])
            case "enforcement":
                return cdl.check_enforcement(data["topology"], data["minimumTopology"], data["gates"])
            case "trust":
                return ok(trustLevel=core.authorize_trust_level(data.get("claimedLevel", 2), data["allowedLevels"]) if data["signed"] else core.source_trust_level(data["source"]))
            case "engine-isolation":
                core.require_engine_isolation()
            case _:
                raise core.PspError("UNSUPPORTED_OPERATION")
    except core.PspError as exc:
        return {"decision": "unsupported" if exc.code in ("UNSUPPORTED_TERM", "UNSUPPORTED_SCHEMA", "ENGINE_ISOLATION_UNSUPPORTED", "UNSUPPORTED_OPERATION") else "deny", "reasonCodes": [exc.code]}


def _check(case_id: str, expected: Any, operation: Callable) -> dict:
    try:
        actual = operation()
        return {"caseId": case_id, "status": "passed" if core.canonical_json(actual) == core.canonical_json(expected) else "failed", "actual": actual}
    except Exception as exc:
        return {"caseId": case_id, "status": "error", "actual": {"error": exc.code if isinstance(exc, core.PspError) else "INTERNAL_ERROR"}}


def _error_code(operation: Callable) -> str:
    try:
        operation()
        return "NO_ERROR"
    except core.PspError as exc:
        return exc.code


def _fixture_groups(suite: dict, fields: list[str]) -> None:
    if any(type(suite.get(f)) is not list for f in fields):
        raise core.PspError("INVALID_FIXTURE")
    ids = [c.get("id") if type(c) is dict else None for f in fields for c in suite[f]]
    if not ids or any(type(id) is not str or not id for id in ids) or len(set(ids)) != len(ids):
        raise core.PspError("INVALID_FIXTURE")


def run_policy_vectors(suite: dict) -> list[dict]:
    if suite.get("profile") != cdl.CDL_PROFILE or type(suite.get("cases")) is not list:
        raise core.PspError("UNSUPPORTED_PROFILE")
    _fixture_groups(suite, ["cases"])
    return [_check(c["id"], c["expected"], lambda c=c: execute_policy_case(c)) for c in suite["cases"]]


def run_codec_vectors(suite: dict) -> list[dict]:
    if suite.get("profile") != core.CODEC_PROFILE:
        raise core.PspError("UNSUPPORTED_PROFILE")
    _fixture_groups(suite, ["markupCases", "objectCases", "invalidMarkupCases", "invalidJsonCases", "cdlSchemas"])
    results = []
    for case in suite["markupCases"]:
        results.append(_check(case["id"] + ":parse", case["expected"], lambda: core.document_to_object(core.parse_markup(case["source"]), False)))
        results.append(_check(case["id"] + ":source-roundtrip", case["source"], lambda: core.serialize_markup(core.document_from_json(core.document_to_json(core.parse_markup(case["source"]))))))
        results.append(_check(case["id"] + ":canonical-roundtrip", case["expected"], lambda: core.document_to_object(core.parse_markup(core.serialize_markup(core.document_from_object(case["expected"]), "canonical")), False)))
    for case in suite["objectCases"]:
        def cycle():
            obj = core.document_from_json(core.document_to_json(core.document_from_object(case["object"]), False))
            return core.document_to_object(core.parse_markup(core.serialize_markup(obj, "canonical")), False)
        results.append(_check(case["id"], case["object"], cycle))
    for case in suite["invalidMarkupCases"]:
        results.append(_check(case["id"], case["error"], lambda: _error_code(lambda: core.parse_markup(case["source"])) ))
    for case in suite["invalidJsonCases"]:
        results.append(_check(case["id"], case["error"], lambda: _error_code(lambda: core.parse_json(case["source"])) ))
    for case in suite["cdlSchemas"]:
        results.append(_check(case["id"], case["schema"], lambda: cdl.parse_cdl_json(cdl.serialize_cdl_json(case["schema"]))))
    return results


def run_signature_vectors(suite: dict) -> list[dict]:
    if suite.get("profile") != "PSP-SIGNATURE-2.0":
        raise core.PspError("UNSUPPORTED_PROFILE")
    _fixture_groups(suite, ["vectors", "mutations", "equivalents", "expirationCases", "invalidEncodings"])
    results = []
    def key(vector):
        return bytes.fromhex(suite["testKeys"]["ed25519"]["publicKeyHex"] if vector["envelope"]["signature"]["algorithm"] == "ed25519" else suite["testKeys"]["hmac"]["keyHex"])
    for vector in suite["vectors"]:
        envelope = vector["envelope"]
        results.append(_check(vector["id"] + ":bytes", vector["inputUtf8Hex"], lambda: core.signature_input(envelope).hex()))
        results.append(_check(vector["id"] + ":content", vector["canonicalContent"], lambda: core.protected_content(envelope)))
        results.append(_check(vector["id"] + ":verify", True, lambda: crypto.verify_signature(envelope, key(vector))))
        def sign():
            metadata = {k: v for k, v in envelope["signature"].items() if k != "value"}
            private_key = bytes.fromhex(suite["testKeys"]["ed25519"]["seedHex"]) if metadata["algorithm"] == "ed25519" else key(vector)
            return crypto.sign_envelope(envelope["data"], metadata, private_key)["signature"]["value"]
        results.append(_check(vector["id"] + ":sign", envelope["signature"]["value"], sign))
        def markup_cycle():
            document = {"kind": "document", "children": [core.envelope_to_section(envelope)]}
            restored = core.parse_markup(core.serialize_markup(document))
            return core.signature_input(core.section_to_envelope(restored["children"][0])).hex()
        results.append(_check(vector["id"] + ":markup-roundtrip", vector["inputUtf8Hex"], markup_cycle))
        results.append(_check(vector["id"] + ":alias-roundtrip", vector["inputUtf8Hex"], lambda: core.signature_input(core.parse_envelope(core.serialize_envelope(envelope, True))).hex()))
    for mutation in suite["mutations"]:
        def mutate():
            vector = next(v for v in suite["vectors"] if v["id"] == mutation["vector"])
            envelope = deepcopy(vector["envelope"])
            parent = envelope
            for part in mutation["path"][:-1]:
                parent = parent[part]
            parent[mutation["path"][-1]] = mutation["value"]
            try:
                return crypto.verify_signature(envelope, key(vector))
            except core.PspError:
                return False
        results.append(_check(mutation["id"], False, mutate))
    for case in suite["equivalents"]:
        results.append(_check(case["id"], True, lambda: crypto.verify_signature(case["envelope"], key(next(v for v in suite["vectors"] if v["id"] == case["vector"])))))
    for case in suite["expirationCases"]:
        results.append(_check(case["id"], case["expected"], lambda: core.validate_time(case.get("timestamp"), case.get("expires"), case.get("now"), case.get("skew", 0))))
    for case in suite["invalidEncodings"]:
        results.append(_check(case["id"], "INVALID_ENCODING", lambda: _error_code(lambda: core.decode_signature(case["value"], "ed25519"))))
    return results


def profile_report(policy: dict, codec: dict, signatures: dict) -> dict:
    results = run_policy_vectors(policy) + run_codec_vectors(codec) + run_signature_vectors(signatures)
    passed = sum(r["status"] == "passed" for r in results)
    return {"mode": "profile-conformance", "profiles": ["CDL-DETERMINISTIC-1.0", "PSP-TRUST-1.0", "PSP-CODEC-1.0", "PSP-SIGNATURE-2.0"], "status": "passed" if passed == len(results) else "failed", "executed": len(results), "passed": passed, "failed": len(results) - passed, "results": results}
