# SPDX-License-Identifier: Apache-2.0
import sys
import sqlite3
import unittest
from pathlib import Path
from threading import Event
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from scoped_fixtures import SUITE,Fixture,run_case,SYSTEM
from psp_cdl_api_server.persistence import WorkflowStore,StoreError
from psp_cdl_llmproxy import LoopError
from psp_cdl_mcpproxy import binding_digest,DispatchError

class ScopedTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual=run_case(case)
                for k,v in case["expected"].items():self.assertEqual(actual.get(k),v,actual)
                if "state" not in actual:continue
                self.assertEqual(actual["state"]["status"],"completed");self.assertEqual(actual["state"]["state"],{"answer":"Finished 🧪"})
                self.assertEqual(actual["state"]["llmCompletion"]["threatState"]["marker"],"HOST_THREAT_ONLY");self.assertEqual(actual["toolCalls"],1)
                self.assertEqual(actual["state"]["llmCompletion"]["scope"]["threatPolicy"],{"id":"restricted-threat","version":"2"} if case.get("settings",{}).get("explicitPolicy") else {"id":"application-threat","version":"1"})
                scores={"scoped-answer":9,"ingress-violation":17,"egress-violation":18,"deny-then-answer":19,"two-answers":11}
                if case["id"] in scores:self.assertEqual(actual["state"]["llmCompletion"]["threatState"]["score"],scores[case["id"]])
                if case["id"]=="ingress-violation":self.assertEqual(actual["promptBindings"],[])
                for r in actual["requests"][2:]:
                    self.assertEqual(r,{"messages":[{"role":"system","content":SYSTEM},{"role":"assistant","content":"Finished 🧪"},{"role":"user","content":"Explain the completed result."}],"tools":[]})
                    self.assertNotIn("HOST_THREAT_ONLY",str(r));self.assertNotIn("test-owner",str(r))
                for r in actual["receipts"]:
                    if r["scoped"]["outcome"]=="violation":
                        self.assertIsNone(r["output"]);self.assertEqual(r["scoped"]["signal"]["signal"],"post_completion_violation");self.assertEqual(r["scoped"]["signal"]["kind"],"hard")
                        self.assertEqual(set(r["scoped"]["signal"]),{"at","inputDigest","kind","phase","signal"})
                for b in actual["boundaries"]:self.assertEqual(b["binding"]["threatDigest"],binding_digest(b["data"]["threatState"]))
                for s in actual["steps"]:
                    if s["code"]!="OK":self.assertNotIn("value",s)

    def test_private_commands(self):
        f=Fixture()
        try:
            f.loop.run("test-owner",f.base.session["sessionId"],{"message":"Explain."},f.options);command=f.commands[-1]
            self.assertEqual(f.base.store.execute(f.base.actor,command)["scoped"]["turnCount"],1)
            legacy=WorkflowStore(f.base.backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,durable_turns=True)
            with self.assertRaises(StoreError) as error:legacy.execute(f.base.actor,command)
            self.assertEqual(error.exception.code,"INVALID_COMMAND")
            for c,code in [({**command,"state":{"reopened":True}},"INVALID_COMMAND"),({**command,"requestId":"next","expectedVersion":3,"scopeDigest":"0"*64},"STATE_CONFLICT")]:
                with self.assertRaises(StoreError) as error:f.base.store.execute(f.base.actor,c)
                self.assertEqual(error.exception.code,code)
            with self.assertRaises(DispatchError) as error:f.base.gate.list_tools("test-owner",f.base.session["sessionId"],f.options)
            self.assertEqual(error.exception.code,"INACTIVE_SESSION")
            for status in ("running","completed"):
                with self.assertRaises(StoreError) as error:f.base.store.execute(f.base.actor,{"action":"updateSession","requestId":"reopen","sessionId":f.base.session["sessionId"],"expectedVersion":3,"nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","status":status,"state":{}})
                self.assertEqual(error.exception.code,"INVALID_TRANSITION")
            for key in ("inputDigest","scopeDigest"):
                for digest in ("0"*63+"\n","0"*65,"A"*64):
                    with self.assertRaises(StoreError) as error:f.base.store.execute(f.base.actor,{**command,key:digest})
                    self.assertEqual(error.exception.code,"INVALID_COMMAND")
            next_session=f.base.store.execute(f.base.actor,{"action":"createSession","requestId":"seed-second","nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","expiresAt":2000,"state":{}});initial=f.commands[0]
            continuing={**initial,"requestId":"continue","sessionId":next_session["sessionId"],"complete":False,"scope":None,"threatState":None}
            self.assertEqual(f.base.store.execute(f.base.actor,continuing)["status"],"running")
            self.assertEqual(f.base.store.execute(f.base.actor,{**initial,"sessionId":next_session["sessionId"],"requestId":"complete-second","expectedVersion":2})["scoped"]["outcome"],"completion")
        finally:f.close()

    def test_sql_rollback(self):
        f=Fixture();db=sqlite3.connect(str(Path(f.base.directory.name)/"state.sqlite"),isolation_level=None)
        try:
            db.execute("CREATE TRIGGER fail_scoped BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;")
            f.flags["denyIngress"]=True
            with self.assertRaises(LoopError) as error:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"Outside scope."},f.options)
            self.assertEqual(error.exception.code,"HOST_ERROR")
            state=f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})
            self.assertEqual(state["version"],2);self.assertEqual(state["llmCompletion"]["threatState"]["score"],7);self.assertEqual(state["llmCompletion"]["violationCount"],0)
            with self.assertRaises(StoreError) as error:f.base.store.execute(f.base.actor,{"action":"getTurn","sessionId":f.base.session["sessionId"],"requestId":"scope-1"})
            self.assertEqual(error.exception.code,"NOT_FOUND")
            db.execute("DROP TRIGGER fail_scoped")
            with self.assertRaises(LoopError) as error:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"Outside scope."},f.options)
            self.assertEqual(error.exception.code,"PSP_POST_COMPLETION_VIOLATION")
            self.assertEqual(f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})["llmCompletion"]["threatState"]["score"],17)
        finally:db.close();f.close()

    def test_owner_reservation(self):
        ready,go=Event(),Event();shared=[]
        def run():
            f=Fixture();shared.append(f);boundary=f.scope_boundary
            def waiting(*args):
                ready.set()
                if not go.wait(10):raise AssertionError("test timeout")
                return boundary(*args)
            f.scope_boundary=waiting
            try:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"Explain."},f.options)
            finally:
                try:self.assertEqual(next(r for r in f.records() if r.get("status"))["version"],2)
                finally:f.close()
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(run)
            try:
                self.assertTrue(ready.wait(10));f=shared[0]
                with self.assertRaises(StoreError) as error:f.base.update()
                self.assertEqual(error.exception.code,"STATE_BUSY");f.base.flags["cancelled"]=True
            finally:go.set()
            with self.assertRaises(LoopError) as error:pending.result(timeout=10)
            self.assertEqual(error.exception.code,"CANCELLED")
