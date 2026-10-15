# SPDX-License-Identifier: Apache-2.0
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/"scripts"))
from observer_fixtures import SUITE, run_case
from llm_fixtures import Fixture as LlmFixture, run_case as run_loop
from dispatch_fixtures import Fixture as GateFixture, run_case as run_gate
from psp_cdl_llmproxy import LoopError, OBSERVE_PROFILE
from psp_cdl_mcpproxy import DispatchError, make_emitter, byte_length, text_bytes, scope_of

SCHEMA = json.loads((ROOT/"schemas/observer-0.1.schema.json").read_text(encoding="utf-8"))
PRIVATE = ("test-owner", "tenant-a", "subject-a", "test-signing-key", "PRIVATE_")


def check_event(test, event):
    """Structural check against the shared schema without a JSON Schema dependency."""
    test.assertEqual(set(event), {"profile", "source", "type", "scope", "data"})
    definition = SCHEMA["$defs"][event["type"]]
    test.assertEqual(event["profile"], OBSERVE_PROFILE)
    test.assertIn(event["source"], definition["properties"]["source"]["enum"])
    data = definition["properties"]["data"]
    test.assertTrue(set(data["required"]) <= set(event["data"]) <= set(data["properties"]), (event["type"], event["data"]))
    test.assertTrue(set(event["scope"]) <= set(SCHEMA["$defs"]["scope"]["properties"]))
    for key, value in event["data"].items():
        if key in ("digest", "promptDigest", "outputDigest", "inputDigest") and value != "<prompt-digest>": test.assertRegex(value, r"^[a-f0-9]{64}$")


class ObserverTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual = run_case(case)
                self.assertEqual(actual["codes"], case["expected"]["codes"])
                self.assertEqual(actual["types"], case["expected"]["types"])
                for event in actual["events"]:
                    check_event(self, event)
                    text = json.dumps(event)
                    for value in PRIVATE: self.assertNotIn(value, text)
                    if case.get("level") != "inspect": self.assertNotIn("payload", event["data"])
                if case.get("level") == "inspect": self.assertTrue(any("payload" in e["data"] for e in actual["events"]))

    def test_invalid_options_are_rejected(self):
        for observe in ({}, {"observer":"x"}, {"observer":lambda e:None, "level":"verbose"}, {"observer":lambda e:None, "extra":1}, "x", []):
            with self.assertRaises(LoopError) as error: LlmFixture({"observe":observe})
            self.assertEqual(error.exception.code, "INVALID_CONFIGURATION")
            with self.assertRaises(DispatchError) as error: GateFixture({"observe":observe})
            self.assertEqual(error.exception.code, "INVALID_CONFIGURATION")

    def test_observer_failures_never_change_outcomes(self):
        def raising(event): raise RuntimeError("PRIVATE_OBSERVER_DETAIL")
        def mutating(event):
            event["data"]["code"] = "forged"
            event["scope"]["sessionId"] = "forged"
        plain = run_loop({"settings":{}})
        for observer in (raising, mutating):
            self.assertEqual(run_loop({"settings":{"observe":{"observer":observer}}}), plain)
        self.assertEqual(run_gate({"settings":{"observe":{"observer":raising}}}), run_gate({"settings":{}}))

    def test_events_are_detached_copies(self):
        events = []
        def observer(event):
            events.append(event)
            event["data"]["messageCount"] = -1
        result = run_loop({"settings":{"observe":{"observer":observer, "level":"inspect"}}})
        self.assertEqual(result["code"], "OK")
        assembled = [e for e in events if e["type"] == "prompt.assembled"]
        self.assertTrue(assembled)
        for e in assembled:
            self.assertEqual(e["data"]["messageCount"], -1)
            self.assertEqual(e["data"]["payload"]["messages"][0]["role"], "system")
        self.assertEqual(result["requests"][0]["messages"][0]["role"], "system")

    def test_emitter_helpers(self):
        self.assertEqual(byte_length({"b":1, "a":"x"}), 15)
        self.assertEqual(text_bytes("🧪"), 4)
        self.assertEqual(scope_of({"sessionId":"s", "requestId":7, "step":2, "round":"x", "tenantId":"t"}), {"sessionId":"s", "step":2})
        seen = []
        def fail(code): raise ValueError(code)
        emit = make_emitter("mcpproxy", {"observer":seen.append}, fail)
        emit("dispatch.enter", {"sessionId":"s"}, {"operation":"listTools", "allowedCount":0, "registeredCount":0}, lambda:{"secret":True})
        self.assertEqual(seen, [{"profile":OBSERVE_PROFILE, "source":"mcpproxy", "type":"dispatch.enter", "scope":{"sessionId":"s"}, "data":{"operation":"listTools", "allowedCount":0, "registeredCount":0}}])
        with self.assertRaises(ValueError): make_emitter("mcpproxy", {"observer":1}, fail)
        make_emitter("mcpproxy", None, fail)("x", {}, {})


if __name__ == "__main__": unittest.main()
