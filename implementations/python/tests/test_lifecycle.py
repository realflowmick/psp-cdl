# SPDX-License-Identifier: Apache-2.0
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from lifecycle_fixtures import SUITE, Fixture, run_case
from psp_cdl_api_server.persistence import StoreError

class LifecycleTests(unittest.TestCase):
    def test_shared_cases(self):
        for case in SUITE["cases"]:
            for mode in ("http","mcp"):
                with self.subTest(case=case["id"],mode=mode):run_case(case,mode)
    def test_pagination(self):
        f=Fixture()
        try:
            for i in range(5):f.service.invoke("createSession",{"requestId":"extra-"+str(i),"nodeId":"entry","nodeVersion":"1","expiresAt":2000,"state":{"stage":"synthetic"}},"test-owner")
            seen,after=set(),None
            while True:
                result=f.service.invoke("listSessions",{"after":after,"limit":2,"status":"all"},"test-owner")["result"]
                for r in result["sessions"]:
                    self.assertNotIn(r["sessionId"],seen);seen.add(r["sessionId"])
                    self.assertEqual(set(r),{"expiresAt","sessionId","status","updatedAt","version"})
                after=result["after"]
                if after is None:break
            self.assertEqual(len(seen),6)
        finally:f.close()
    def test_cleanup_and_replay(self):
        f=Fixture()
        try:
            sid=f.refs["@session"]
            f.service.invoke("cancelSession",{"requestId":"cancel","sessionId":sid,"expectedVersion":1},"test-owner")
            r=f.service.invoke("purgeSession",{"requestId":"purge","sessionId":sid,"expectedVersion":2},"test-owner")
            self.assertFalse(r["result"]["more"])
            self.assertNotIn("state",f.backend.read(f.actor["tenantId"],{"kind":"session","id":sid})["body"])
            self.assertIsNone(f.backend.cleanup_candidate(f.actor,sid)["record"])
            with self.assertRaises(StoreError) as caught:f.store.execute(f.actor,{"action":"createSession","requestId":"seed","nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","expiresAt":2000,"state":{"stage":"initial","hidden":"PRIVATE_STATE"}})
            self.assertEqual(caught.exception.code,"RECEIPT_RETIRED")
        finally:f.close()
