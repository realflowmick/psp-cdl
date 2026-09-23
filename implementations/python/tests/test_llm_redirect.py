# SPDX-License-Identifier: Apache-2.0
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from redirect_fixtures import SUITE,Fixture,run_case
from psp_cdl_api_server.persistence import WorkflowStore,StoreError
from psp_cdl_llmproxy import LoopError
from psp_cdl_mcpproxy import binding_digest
from threading import Event
from concurrent.futures import ThreadPoolExecutor

class RedirectTests(unittest.TestCase):
    def test_target_expiry_at_transaction(self):
        f=Fixture();commit=f.base.backend.commit
        def expiring(*args):
            if any(w["body"].get("result",{}).get("redirect") for w in args[2]): f.base.flags["now"]=1600
            return commit(*args)
        f.base.backend.commit=expiring
        try:
            with self.assertRaises(LoopError) as error: f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            self.assertEqual(error.exception.code,"EXPIRED")
            self.assertEqual(len(f.sessions()),1);self.assertEqual(f.sessions()[0]["version"],1)
        finally: f.close()

    def test_pending_policy_reserves_owner(self):
        ready,go=Event(),Event();shared=[]
        def run():
            # SQLite connections belong to the thread that performs the turn.
            f=Fixture();shared.append(f);policy=f.redirect_policy
            def waiting(*args):
                ready.set()
                if not go.wait(10): raise AssertionError("test timeout")
                return policy(*args)
            f.redirect_policy=waiting
            try: f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            finally:
                try:
                    self.assertEqual(len(f.sessions()),1);self.assertEqual(f.sessions()[0]["version"],1)
                finally: f.close()
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(run)
            try:
                self.assertTrue(ready.wait(10));f=shared[0]
                with self.assertRaises(StoreError) as error: f.base.update()
                self.assertEqual(error.exception.code,"STATE_BUSY")
                f.base.flags["cancelled"]=True
            finally: go.set()
            with self.assertRaises(LoopError) as error: pending.result(timeout=10)
            self.assertEqual(error.exception.code,"CANCELLED")

    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual=run_case(case)
                for key,value in case["expected"].items(): self.assertEqual(actual.get(key),value,actual)
                for step in actual.get("steps",[]):
                    if step["code"]!="OK": self.assertNotIn("value",step)
                    else: self.assertEqual(step["value"]["text"],"Finished 🧪")
                if actual.get("targets")==1:
                    target=actual["targetSessions"][0]
                    self.assertEqual(target["version"],1);self.assertEqual(target["status"],"running")
                    for key in ("subjectId","tenantId"): self.assertEqual(target[key],actual["source"][key])
                    self.assertEqual(set(target["state"]),{"input","retained"})
                    self.assertEqual(target["state"]["input"]["text"],"Finished 🧪")
                    self.assertEqual(target["state"]["retained"],{"covenants":["no-training"]})
                    self.assertNotIn("SOURCE_ONLY",str(target));self.assertEqual(actual["source"]["llmCompletion"]["policy"],"redirect")
                self.assertNotIn("target-policy",str(actual.get("requests",[])))
                self.assertNotIn("test-owner",str(actual.get("requests",[])))

    def test_sql_rollback(self):
        f=Fixture();db=sqlite3.connect(str(Path(f.base.directory.name)/"state.sqlite"),isolation_level=None)
        try:
            db.execute("CREATE TRIGGER fail_turn BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;")
            with self.assertRaises(LoopError) as error: f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            self.assertEqual(error.exception.code,"HOST_ERROR")
            self.assertEqual(len(f.sessions()),1);self.assertEqual(f.sessions()[0]["version"],1)
            with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{"action":"getTurn","sessionId":f.base.session["sessionId"],"requestId":"turn-1"})
            self.assertEqual(error.exception.code,"NOT_FOUND")
            db.execute("DROP TRIGGER fail_turn")
            out=f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            self.assertEqual(len(f.sessions()),2)
            self.assertEqual(out["redirect"]["sessionId"],next(s for s in f.sessions() if s["sessionId"]!=f.base.session["sessionId"])["sessionId"])
            self.assertEqual(f.policies[-1]["binding"]["commandDigest"],binding_digest(f.commands[-1]))
        finally: db.close();f.close()

    def test_store_boundary(self):
        f=Fixture()
        try:
            out=f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options);command=f.commands[0]
            receipt=f.base.store.execute(f.base.actor,command)
            self.assertEqual(receipt["redirect"],out["redirect"]);self.assertEqual(len(f.sessions()),2)
            legacy=WorkflowStore(f.base.backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,durable_turns=True)
            with self.assertRaises(StoreError) as error: legacy.execute(f.base.actor,command)
            self.assertEqual(error.exception.code,"INVALID_COMMAND")
            for redirect in (None,{**command["redirect"],"subjectId":"other"},{**command["redirect"],"target":"mcp://evil@host/applications/support"},{**command["redirect"],"nodeId":"entry"},{**command["redirect"],"expiresAt":True}):
                with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{**command,"redirect":redirect})
                self.assertEqual(error.exception.code,"INVALID_COMMAND")
            with self.assertRaises(StoreError) as error: f.base.store.execute({**f.base.actor,"subjectId":"other"},{"action":"getSession","sessionId":out["redirect"]["sessionId"]})
            self.assertEqual(error.exception.code,"NOT_FOUND")
            with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{**command,"redirect":{**command["redirect"],"policyVersion":"changed"}})
            self.assertEqual(error.exception.code,"IDEMPOTENCY_CONFLICT")
            with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{"action":"updateSession","requestId":"reopen","sessionId":f.base.session["sessionId"],"expectedVersion":2,"nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","status":"running","state":{}})
            self.assertEqual(error.exception.code,"INVALID_TRANSITION")
        finally: f.close()
