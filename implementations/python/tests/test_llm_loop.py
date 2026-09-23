# SPDX-License-Identifier: Apache-2.0
import sys
import unittest
from pathlib import Path
from threading import Event
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[3]/"scripts"))
from llm_fixtures import SUITE, Fixture, run_case
from psp_cdl_llmproxy import LoopError
from psp_cdl_api_server.persistence import StoreError
from psp_cdl_api_server.persistence import WorkflowStore
from psp_cdl_api_server.sqlite import SqliteBackend


class LlmLoopTests(unittest.TestCase):
    def test_shared_boundaries_and_provider_visibility(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual = run_case(case)
                for key, value in case["expected"].items(): self.assertEqual(actual[key], value, actual)
                for request in actual["requests"]:
                    self.assertEqual(set(request), {"messages", "tools"})
                    self.assertEqual(request["messages"][0], {"role":"system", "content":"Use the synthetic read tool when needed."})
                    self.assertEqual(request["messages"][1]["role"], "user")
                    for private_value in ("test-owner", "tenant-a", "subject-a", "test-signing-key", "sessionVersion", "PRIVATE_"):
                        self.assertNotIn(private_value, str(request))
                if not actual["released"]: self.assertNotIn("result", actual)

    def test_pending_provider_reservation_and_late_cancellation(self):
        entered, release = Event(), Event()
        def provider(*_):
            entered.set()
            if not release.wait(10): raise RuntimeError("test timed out")
        shared = []
        def run():
            # SQLite connections stay on their creating worker thread.
            f = Fixture({"responses":[{"type":"final", "text":"must not release"}], "onProvider":provider})
            shared.append(f)
            try: return f.loop.run("test-owner", f.base.session["sessionId"], {"message":"hello"}, f.options)
            finally: f.close()
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(run)
            try:
                self.assertTrue(entered.wait(10))
                f = shared[0]
                with self.assertRaises(LoopError) as error:
                    f.loop.run("test-owner", f.base.session["sessionId"], {"message":"competing"}, f.options)
                self.assertEqual(error.exception.code, "STATE_BUSY")
                with self.assertRaises(StoreError) as error: f.base.update()
                self.assertEqual(error.exception.code, "STATE_BUSY")
                backend = SqliteBackend(str(Path(f.base.directory.name)/"state.sqlite"), "epoch-1", lambda:1000)
                try:
                    store = WorkflowStore(backend, resume_secret=bytes([7])*32, authorize_persistence=lambda *_:True, coordinator=f.base.coordinator)
                    store.execute({**f.base.actor, "subjectId":"other"}, {"action":"createSession", "requestId":"other-create", "nodeId":"entry", "nodeVersion":"1", "policyVersion":"policy-1", "expiresAt":1900, "state":{}})
                finally: backend.close()
                f.base.flags["cancelled"] = True
            finally: release.set()
            with self.assertRaises(LoopError) as error: pending.result(timeout=10)
            self.assertEqual(error.exception.code, "CANCELLED")


if __name__ == "__main__": unittest.main()
