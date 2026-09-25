# SPDX-License-Identifier: Apache-2.0
import json
import sys
import subprocess
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

sys.path.insert(0, str(Path(__file__).resolve().parents[3]/"scripts"))
from provider_fixtures import SUITE, run_case
from psp_cdl_llmproxy import create_openai_chat_provider, ProviderError


class OpenAIChatTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual = run_case(case)
                for key, expected in case["expected"].items(): self.assertEqual(actual[key], expected, actual)
                for request in actual["requests"]:
                    self.assertIs(request["stream"], False)
                    self.assertIs(request["store"], False)
                    self.assertEqual(request["n"], 1)
                    self.assertEqual(request["model"], "gpt-4.1-mini-2025-04-14")
                    for private in ("SYNTHETIC_KEY", "test-owner", "tenant-a", "subject-a", "test-signing-key", "sessionVersion", "PRIVATE_"):
                        self.assertNotIn(private, json.dumps(request))
                self.assertNotIn("PRIVATE_", json.dumps(actual))
                if case["id"] == "single-tool": self.assertEqual(actual["outputs"], [{"type": "tool", "name": "echo.read", "arguments": {"message": "hello 🧪"}}])
                if case["id"] == "reconstructed-tool-history":
                    self.assertEqual(actual["requests"][0]["messages"][3]["tool_call_id"], actual["requests"][0]["messages"][2]["tool_calls"][0]["id"])

    def test_pending_cancel_and_busy(self):
        entered, cancelled, aborted = Event(), Event(), Event()
        def transport(_body, stop):
            entered.set()
            if not stop.wait(3): raise AssertionError("test timed out")
            aborted.set()
            raise RuntimeError("PRIVATE_ABORT")
        provider = create_openai_chat_provider({"mode": "offline", "complete": True, "sources": [], "now": lambda: 1000, "limits": SUITE["limits"], "transport": transport})
        options = {"deadline": 1800, "cancelled": cancelled.is_set}
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(provider["invoke"], SUITE["request"], options)
            try:
                self.assertTrue(entered.wait(3))
                with self.assertRaises(ProviderError) as busy: provider["invoke"](SUITE["request"], options)
                self.assertEqual(busy.exception.code, "PROVIDER_BUSY")
            finally: cancelled.set()
            with self.assertRaises(ProviderError) as error: pending.result(timeout=3)
            self.assertEqual(error.exception.code, "CANCELLED")
            self.assertIsNone(error.exception.__context__)
            self.assertTrue(aborted.wait(3))

    def test_monotonic_timeout(self):
        def transport(_body, stop):
            stop.wait(3)
            return None
        provider = create_openai_chat_provider({"mode": "offline", "complete": True, "sources": [], "now": lambda: 1000,
                                              "limits": {**SUITE["limits"], "timeoutMs": 25}, "transport": transport})
        with self.assertRaises(ProviderError) as error: provider["invoke"](SUITE["request"], {"deadline": 1800, "cancelled": lambda: False})
        self.assertEqual(error.exception.code, "DEADLINE_EXCEEDED")

    def test_unsettled_transport_keeps_pending_slot(self):
        release = Event()
        def transport(_body, _stop):
            release.wait(3)
            return None
        provider = create_openai_chat_provider({"mode": "offline", "complete": True, "sources": [], "now": lambda: 1000,
                                              "limits": {**SUITE["limits"], "timeoutMs": 25}, "transport": transport})
        options = {"deadline": 1800, "cancelled": lambda: False}
        try:
            with self.assertRaises(ProviderError) as error: provider["invoke"](SUITE["request"], options)
            self.assertEqual(error.exception.code, "DEADLINE_EXCEEDED")
            with self.assertRaises(ProviderError) as error: provider["invoke"](SUITE["request"], options)
            self.assertEqual(error.exception.code, "PROVIDER_BUSY")
        finally: release.set()

    def test_smoke_has_no_live_default(self):
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[3]/"scripts/smoke_openai.py")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "not_run")


if __name__ == "__main__": unittest.main()
