# SPDX-License-Identifier: Apache-2.0
import io
import json
import sys
import threading
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from mediation_fixtures import SUITE, run_mediation_case, MediationFixture, messages
from psp_cdl_mcpproxy import DispatchError
from psp_cdl_mcp_server.stdio import serve_stdio


class MediationTests(unittest.TestCase):
    def test_shared_wire_cases(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                result = run_mediation_case(case)
                for k,v in case["expected"].items(): self.assertEqual(result[k],v,result)
                self.assertNotIn("PRIVATE_",str(result))
                if result["code"] == "OK":
                    self.assertEqual(result["result"]["structuredContent"],{"message":"hello 🧪"})
                    self.assertEqual(result["result"]["_meta"]["psp-cdl/provenance"]["trustLevel"],5)

    def test_cancel_hung_peer_releases_owner(self):
        f, done = MediationFixture({"mode":"hang"}), threading.Event()
        def cancel():
            while not done.wait(0.01):
                if f.calls():
                    f.f.flags["cancelled"] = True
                    return
        worker = threading.Thread(target=cancel)
        try:
            worker.start()
            with self.assertRaises(DispatchError) as caught: f.gate.call_tool("test-owner",f.f.session["sessionId"],{"name":"echo.read","arguments":{"message":"test"}},f.f.options)
            self.assertEqual(caught.exception.code,"CANCELLED")
            self.assertEqual(f.calls(),1)
            self.assertEqual(f.f.update()["version"],2)
        finally:
            done.set()
            worker.join(5)
            f.close()

    def test_output_frame_bound_before_writing(self):
        class Huge:
            def handle(self,_): return {"value":"x"*1_048_576}
        output = io.BytesIO()
        with self.assertRaisesRegex(ValueError,"FRAME_TOO_LARGE"): serve_stdio(Huge(),io.BytesIO(b"{}\n"),output)
        self.assertEqual(output.getvalue(),b"")
