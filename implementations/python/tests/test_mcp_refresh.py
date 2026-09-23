# SPDX-License-Identifier: Apache-2.0
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from mcp_refresh_fixtures import SUITE,run_case,TestPeer
from refresh_fixtures import Fixture
from psp_cdl_llmproxy import McpPromptRefresher

class McpRefreshTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual=run_case(case)
                for key,value in case["expected"].items():self.assertEqual(actual.get(key),value,actual)
                for call in actual["wire"]:self.assertEqual(set(call["arguments"]),{"current_version","session_id","trigger","turn_count"})

    def test_loop_still_verifies_remote_candidates(self):
        for case in SUITE["loopCases"]:
            with self.subTest(case=case["id"]):
                f=Fixture({"base":{"now":1100}});f.flags.update(case["flags"]);current={};issue=f.refresh
                peer=TestPeer(issue=lambda r:issue(current["p"],current["b"],r)).connect()
                try:
                    p=f.authenticate("test-owner")
                    client=McpPromptRefresher(peer,{"principal":p,"sessionId":f.base.session["sessionId"],"approvedCatalogDigest":peer.catalog_digest,"now":lambda:f.base.flags["now"],"cancelled":lambda:f.base.flags.get("cancelled") is True})
                    def refresh(p,b,r):current.update(p=p,b=b);return client.refresh(p,b,r)
                    f.refresh=refresh
                    actual="OK"
                    try:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
                    except Exception as exc:actual=getattr(exc,"code","UNEXPECTED_ERROR")
                    self.assertEqual(actual,case["code"]);self.assertEqual(peer.calls,1)
                    self.assertEqual(f.stats()["providerCalls"],case["providerCalls"])
                    self.assertNotIn("realflow.security.refresh",str(f.requests))
                finally:peer.close();f.close()
