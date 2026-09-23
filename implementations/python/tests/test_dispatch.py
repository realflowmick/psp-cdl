# SPDX-License-Identifier: Apache-2.0
import sys
import threading
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from dispatch_fixtures import SUITE, Fixture, run_case
from psp_cdl_mcpproxy import DispatchError, binding_digest
from psp_cdl_mcpproxy.schema import check_schema, matches
from psp_cdl_api_server.persistence import StoreError


class DispatchTests(unittest.TestCase):
    def test_transition_during_actual_tool_execution(self):
        f, entered, release, observed = Fixture(), threading.Event(), threading.Event(), []
        def held_tool():
            entered.set()
            if not release.wait(5): raise RuntimeError("test timed out")
        f.flags["onInvoke"] = held_tool
        def competing_writer():
            try:
                if not entered.wait(5): return
                try: f.update()
                except StoreError as exc: observed.append(exc.code)
                f.flags["cancelled"] = True
            finally: release.set()
        worker = threading.Thread(target=competing_writer)
        try:
            worker.start()
            with self.assertRaises(DispatchError) as caught: f.gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"test"}},f.options)
            self.assertEqual(caught.exception.code,"CANCELLED")
            worker.join(5)
            self.assertEqual(observed,["STATE_BUSY"])
            self.assertEqual(f.update()["version"],2)
            self.assertEqual(f.calls,1)
        finally:
            release.set()
            worker.join(5)
            f.close()

    def test_shared_dispatch_cases(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                result = run_case(case)
                for k,v in case["expected"].items(): self.assertEqual(result[k],v,result)
                if result["code"] == "OK" and not case.get("list"):
                    out = result["result"]
                    self.assertEqual(out["data"],case.get("expectedData",{"message":"hello 🧪"}))
                    self.assertEqual(out["provenance"]["trustLevel"],5)
                    self.assertEqual(out["provenance"]["outputDigest"],binding_digest(out["data"]))
                    self.assertEqual(out["provenance"]["inputDigest"],binding_digest(case.get("request",{}).get("arguments",{"message":"hello 🧪"})))
                self.assertNotIn("PRIVATE_",str(result))
                if "expectedNames" in case: self.assertEqual([t["name"] for t in result["result"]],case["expectedNames"])

    def test_shared_schema_cases(self):
        for case in SUITE["schemaCases"]:
            if case.get("unsupported"):
                with self.assertRaises(ValueError): check_schema(case["schema"])
            else:
                check_schema(case["schema"])
                self.assertEqual(matches(case["schema"],case["value"]),case["valid"])

    def test_concurrent_lease_and_error_release(self):
        f, entered, release = Fixture({"throwTool":True}), threading.Event(), threading.Event()
        def hold():
            entered.set()
            release.wait(5)
        worker = threading.Thread(target=lambda:f.coordinator.run(f.actor,hold))
        try:
            worker.start()
            self.assertTrue(entered.wait(5))
            with self.assertRaises(StoreError) as caught: f.update()
            self.assertEqual(caught.exception.code,"STATE_BUSY")
            with self.assertRaises(DispatchError) as caught: f.gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"test"}},f.options)
            self.assertEqual(caught.exception.code,"STATE_BUSY")
            release.set()
            worker.join(5)
            with self.assertRaises(DispatchError) as caught: f.gate.call_tool("test-owner",f.session["sessionId"],{"name":"echo.read","arguments":{"message":"test"}},f.options)
            self.assertEqual(caught.exception.code,"TOOL_FAILED")
            self.assertEqual(f.update()["version"],2)
        finally:
            release.set()
            worker.join(5)
            f.close()
