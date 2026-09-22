# SPDX-License-Identifier: Apache-2.0
from copy import deepcopy
import json
import unittest
from pathlib import Path

import psp_cdl_core as core
import psp_cdl_core.crypto as crypto
import psp_cdl_cdl as cdl
from psp_cdl_test_harness.profiles import profile_report, run_policy_vectors

ROOT = Path(__file__).resolve().parents[3]
def read(path):
    return json.loads((ROOT / "conformance" / path).read_text(encoding="utf-8"))
SIGNATURES = read("vectors/signatures/profile-2.0.json")
CODECS = read("vectors/codec/profile-1.0.json")
FIXTURE = SIGNATURES["vectors"][0]["envelope"]
SEED = bytes.fromhex(SIGNATURES["testKeys"]["ed25519"]["seedHex"])
PUBLIC = bytes.fromhex(SIGNATURES["testKeys"]["ed25519"]["publicKeyHex"])


def policy():
    return {"keys": [{"id": "public-test-ed25519", "algorithm": "ed25519", "material": PUBLIC, "status": "active", "trustLevels": [1, 2], "sectionTypes": ["system", "context"], "scope": {"tenant-id": "test-tenant-a"}, "allowUnscoped": False}], "now": 2_000_000_001, "context": {"tenant-id": "test-tenant-a", "node-id": "approve", "audience": "reference"}, "allowedAttributes": ["tenant-id", "node-id", "audience"]}


class LibraryTests(unittest.TestCase):
    def test_output_budget_and_unsupported_profile(self):
        with self.assertRaises(core.PspError) as error:
            run_policy_vectors({"profile": "CDL-DETERMINISTIC-1.0", "cases": []})
        self.assertEqual(error.exception.code, "INVALID_FIXTURE")
        with self.assertRaises(core.PspError) as error:
            core.canonical_json("\x00" * 700_000)
        self.assertEqual(error.exception.code, "LIMIT_EXCEEDED")
        with self.assertRaises(core.PspError) as error:
            core.document_from_json('{"kind":"document","profile":"PSP-CODEC-9.0","children":[]}')
        self.assertEqual(error.exception.code, "UNSUPPORTED_PROFILE")
        self.assertEqual(core.validate_time(10**1000, 10**1001, 0), "invalid")

    def assert_code(self, code, function, *args):
        with self.assertRaises(core.PspError) as caught:
            function(*args)
        self.assertEqual(caught.exception.code, code)

    def test_all_shared_profile_vectors_execute(self):
        report = profile_report(read("vectors/policy/profile-1.0.json"), CODECS, SIGNATURES)
        self.assertGreater(report["executed"], 500)
        for result in report["results"]:
            with self.subTest(case=result["caseId"]):
                self.assertEqual(result["status"], "passed", result)

    def test_authority_scope_time_and_malformed_policy(self):
        self.assertEqual(crypto.verify_envelope(FIXTURE, policy()), FIXTURE)
        modifications = [
            ("UNKNOWN_KEY", ("keys",), []),
            ("REVOKED_KEY", ("keys", 0, "status"), "revoked"),
            ("KEY_ALGORITHM_MISMATCH", ("keys", 0, "algorithm"), "hmac-sha256"),
            ("UNAUTHORIZED_KEY", ("keys", 0, "trustLevels"), [5]),
            ("UNAUTHORIZED_KEY", ("keys", 0, "sectionTypes"), ["custom"]),
            ("SCOPE_MISMATCH", ("context", "tenant-id"), "tenant-b"),
            ("SCOPE_MISMATCH", ("context", "node-id"), "wrong"),
            ("UNSUPPORTED_ATTRIBUTE", ("allowedAttributes",), []),
            ("EXPIRED", ("now",), FIXTURE["signature"]["expires"]),
            ("NOT_YET_VALID", ("now",), FIXTURE["signature"]["timestamp"] - 0.5),
            ("INVALID_TIME", ("clockSkew",), None),
            ("INVALID_POLICY", ("keys", 0, "trustLevels"), [True]),
            ("INVALID_POLICY", ("keys",), [None]),
        ]
        for code, path, value in modifications:
            with self.subTest(code=code, path=path):
                config = policy()
                parent = config
                for key in path[:-1]:
                    parent = parent[key]
                parent[path[-1]] = value
                self.assert_code(code, crypto.verify_envelope, FIXTURE, config)
        config = policy()
        config["keys"].append(config["keys"][0])
        self.assert_code("INVALID_POLICY", crypto.verify_envelope, FIXTURE, config)
        config = policy()
        config["now"] = FIXTURE["signature"]["timestamp"] - 0.5
        config["clockSkew"] = 1
        self.assertTrue(crypto.verify_envelope(FIXTURE, config))
        config["now"] = FIXTURE["signature"]["expires"]
        config["clockSkew"] = 300
        self.assert_code("EXPIRED", crypto.verify_envelope, FIXTURE, config)

    def test_valid_signature_does_not_override_tenant_policy(self):
        metadata = deepcopy(FIXTURE["signature"])
        metadata.pop("value")
        metadata["attributes"]["tenant-id"] = "tenant-b"
        other = crypto.sign_envelope(FIXTURE["data"], metadata, SEED)
        self.assertTrue(crypto.verify_signature(other, PUBLIC))
        self.assert_code("SCOPE_MISMATCH", crypto.verify_envelope, other, policy())

    def test_nested_document_roundtrip_through_signed_envelope_and_markup(self):
        case = next(c for c in CODECS["markupCases"] if c["id"] == "nested-application")
        document = core.parse_markup(case["source"])
        metadata = {k: v for k, v in FIXTURE["signature"].items() if k not in ("value", "contentType")}
        signed = crypto.sign_document(document, metadata, SEED)
        markup = core.serialize_markup({"kind": "document", "children": [core.envelope_to_section(signed)]})
        decoded = core.section_to_envelope(core.parse_markup(markup)["children"][0])
        restored = core.envelope_to_document(crypto.verify_envelope(decoded, policy()))
        self.assertEqual(core.serialize_markup(restored), case["source"])
        self.assertEqual(core.document_to_object(restored, False), case["expected"])
        self.assert_code("NESTED_ENVELOPE_CONVERSION", core.section_to_envelope, document["children"][0])
        decoded["data"]["children"][0]["attributes"]["name"] = "tampered"
        self.assert_code("INVALID_SIGNATURE", crypto.verify_envelope, decoded, policy())

    def test_stale_source_does_not_replace_edited_tree(self):
        doc = core.parse_markup('${psp type=context id="before"}body${/psp}')
        doc["children"][0]["attributes"]["id"] = "after"
        output = core.serialize_markup(core.document_from_json(core.document_to_json(doc)))
        self.assertEqual(core.parse_markup(output)["children"][0]["attributes"]["id"], "after")
        doc["source"] = "${psp type=system}unclosed"
        self.assertEqual(core.parse_markup(core.serialize_markup(doc))["children"][0]["attributes"]["type"], "context")

    def test_json_admission_and_version_boundaries(self):
        cyclic = {}; cyclic["self"] = cyclic
        self.assert_code("CYCLIC_VALUE", core.canonical_json, cyclic)
        self.assert_code("INVALID_JSON_VALUE", core.canonical_json, {1: "integer key"})
        self.assert_code("INVALID_NUMBER", core.parse_json, "9" * 5000)
        self.assert_code("INVALID_UNICODE", core.parse_markup, "\ud800")
        for version in ("1.2.3\n", "01.2.3", "1.2.3-01", "V1.2.3"):
            self.assert_code("INVALID_VERSION", core.canonical_version, version)
        section = core.envelope_to_section(FIXTURE)
        section["attributes"]["timestamp"] = "02000000000"
        self.assert_code("INVALID_NUMBER", core.section_to_envelope, section)
        data = core.parse_json('{"__proto__":{"polluted":true}}')
        self.assertEqual(data["__proto__"], {"polluted": True})

    def test_cdl_declarations_roundtrip_and_packaged_table(self):
        self.assertEqual(cdl.policy_table(), read("policy/cdl-1.0.json"))
        copied = cdl.policy_table(); copied["rules"].clear()
        self.assertTrue(cdl.policy_table()["rules"])
        obj = {"description": "preserved", "type": "object", "x-cdl-classes": "PHI pii PHI", "x-cdl-covenants": [" NO-TRAINING ", ""], "x-cdl-capabilities": "processes-in-memory-only"}
        expected = cdl.parse_declarations(obj)
        for format in ("array", "string"):
            output = cdl.with_declarations(obj, expected, format)
            self.assertEqual(output["description"], "preserved")
            self.assertEqual(cdl.parse_declarations(cdl.parse_cdl_json(cdl.serialize_cdl_json(output))), expected)
        self.assertEqual(obj["x-cdl-classes"], "PHI pii PHI")

    def test_schema_policy_paths_and_negation(self):
        schema = CODECS["cdlSchemas"][0]["schema"]
        self.assertEqual(cdl.resolve_schema_policy(schema, "/items/0/name")["classes"], ["confidential", "pii"])
        self.assert_code("UNAUTHORIZED_NEGATION", cdl.resolve_schema_policy, schema, "/summary")
        grants = [{"sourceId": "schema#", "term": "no-persist", "atPath": "/properties/summary"}]
        self.assertEqual(cdl.resolve_schema_policy(schema, "/summary", grants)["covenants"], ["no-training"])
        self.assertEqual(cdl.resolve_schema_policy(schema, "/unlisted")["covenants"], ["no-persist", "no-training"])
        for keyword in ("$ref", "allOf", "oneOf", "prefixItems", "dependentSchemas"):
            self.assert_code("UNSUPPORTED_SCHEMA", cdl.resolve_schema_policy, {keyword: []}, "")

    def test_resolved_policy_preserves_ancestor_legal_basis(self):
        path = [{"id": "root", "path": "", "covenants": "lawful-basis-consent"}, {"id": "child", "path": "/properties/a", "covenants": "lawful-basis-contract"}]
        state = cdl.inherit_policy(path)
        facts = {"capabilities": ["verifies-contract-active"], "checks": {"lawful-basis-contract": "satisfied"}, "parameters": {}, "context": {}}
        self.assertEqual(cdl.evaluate_resolved_policy(state, {"root": facts, "child": facts}, facts), {"decision": "deny", "reasonCodes": ["LEGAL_BASIS_UNSATISFIED"]})
        self.assertEqual(cdl.evaluate_resolved_policy(state, {"child": facts}, facts), {"decision": "deny", "reasonCodes": ["MISSING_CONTEXT"]})
        replacement = cdl.inherit_policy([path[0], {**path[1], "covenants": "!lawful-basis-consent lawful-basis-contract"}], [{"sourceId": "root", "term": "lawful-basis-consent", "atPath": path[1]["path"]}])
        self.assertEqual(cdl.evaluate_resolved_policy(replacement, {"child": facts}, facts), {"decision": "allow", "reasonCodes": []})

    def test_per_origin_parameters_are_conjunctive(self):
        state = cdl.inherit_policy([{"id": "root", "path": "", "covenants": "role-restricted-display"}, {"id": "child", "path": "/properties/a", "covenants": "role-restricted-display"}])
        facts = {"capabilities": ["checks-operator-role"], "checks": {"role-restricted-display": "satisfied"}, "parameters": {"allowedRoles": ["nurse"]}, "context": {"roles": ["nurse"]}}
        root_facts = {**facts, "parameters": {"allowedRoles": ["physician"]}}
        self.assertEqual(cdl.evaluate_resolved_policy(state, {"root": root_facts, "child": facts}, facts), {"decision": "deny", "reasonCodes": ["ROLE_MISMATCH"]})


if __name__ == "__main__":
    unittest.main()
