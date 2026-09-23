# SPDX-License-Identifier: Apache-2.0
import sqlite3
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from threading import Event
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from durable_fixtures import SUITE, Fixture, run_case
from psp_cdl_llmproxy import LoopError
from psp_cdl_api_server.persistence import WorkflowStore, StoreError
from psp_cdl_api_server.sqlite import SqliteBackend


class DurableLoopTests(unittest.TestCase):
    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual=run_case(case)
                for key,value in case["expected"].items(): self.assertEqual(actual.get(key),value,actual)
                for step in actual.get("steps",[]):
                    if step["code"]!="OK": self.assertNotIn("value",step)
                    else:
                        self.assertEqual(step["value"]["text"],"Finished 🧪")
                        self.assertEqual(step["value"]["provenance"]["trustLevel"],5)
                        self.assertEqual(step["value"]["receipt"]["profile"],SUITE["profile"])
                for event in actual.get("events",[]):
                    if event["signal"]=="post_completion_override_attempt":
                        self.assertEqual(set(event),{"at","inputDigest","sessionId","signal"})
                        self.assertRegex(event["inputDigest"],r"^[a-f0-9]{64}$")
                if actual.get("version")==1: self.assertEqual(actual["state"],{"stage":"initial"})
                if actual.get("status")=="completed":
                    self.assertEqual(actual["completion"],{"profile":SUITE["profile"],"policy":"lockdown","requestId":"turn-2" if actual["version"]==3 else "turn-1","lockedAt":1000})

    def test_sql_failure_rolls_back_receipt_and_completion(self):
        f=Fixture()
        raw=sqlite3.connect(str(Path(f.base.directory.name)/"state.sqlite"),isolation_level=None)
        try:
            raw.execute("CREATE TRIGGER fail_turn BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;")
            with self.assertRaises(LoopError) as error: f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            self.assertEqual(error.exception.code,"HOST_ERROR")
            self.assertEqual(f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})["version"],1)
            with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{"action":"getTurn","sessionId":f.base.session["sessionId"],"requestId":"turn-1"})
            self.assertEqual(error.exception.code,"NOT_FOUND")
            raw.execute("DROP TRIGGER fail_turn")
            self.assertEqual(f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)["receipt"]["status"],"completed")
        finally:
            raw.close()
            f.close()

    def test_private_commands_opt_in_immutability_and_terminal_state(self):
        f=Fixture()
        try:
            f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            command=f.commands[0]
            get={"action":"getTurn","sessionId":f.base.session["sessionId"],"requestId":"turn-1"}
            self.assertEqual(f.base.store.execute(f.base.actor,command),f.base.store.execute(f.base.actor,get))
            invalid=[({**command,"state":{"changed":True}},"IDEMPOTENCY_CONFLICT"),({**command,"requestId":"new","expectedVersion":2},"INVALID_TRANSITION"),({"action":"createCheckpoint","sessionId":f.base.session["sessionId"],"requestId":"cp","expectedVersion":2,"expiresAt":1500},"INVALID_TRANSITION")]
            for value,code in invalid:
                with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,value)
                self.assertEqual(error.exception.code,code)
            legacy=WorkflowStore(f.base.backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True)
            for value in (command,get):
                with self.assertRaises(StoreError) as error: legacy.execute(f.base.actor,value)
                self.assertEqual(error.exception.code,"INVALID_COMMAND")
            with self.assertRaises(StoreError) as error:
                legacy.execute(f.base.actor,{"action":"updateSession","requestId":"reopen","sessionId":f.base.session["sessionId"],"expectedVersion":2,"nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","status":"running","state":{}})
            self.assertEqual(error.exception.code,"INVALID_TRANSITION")
            for changed in ({"text":"forged"},{"provenance":{**command["output"]["provenance"],"trustLevel":1}}):
                with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{**command,"output":{**command["output"],**changed}})
                self.assertEqual(error.exception.code,"INVALID_COMMAND")
            for input_digest in (command["inputDigest"]+"\n","A"*64,"0"*63):
                with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{**command,"inputDigest":input_digest})
                self.assertEqual(error.exception.code,"INVALID_COMMAND")
            f.base.flags["now"]=2000
            with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,get)
            self.assertEqual(error.exception.code,"EXPIRED")
        finally: f.close()

    def test_pending_transition_reservation_and_cancellation(self):
        entered,release=Event(),Event()
        shared=[]
        def authorize(*_):
            entered.set()
            if not release.wait(10): raise RuntimeError("test timed out")
            return True
        def run():
            f=Fixture()
            f.authorize_transition=authorize
            shared.append(f)
            try: f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            finally:
                try:
                    self.assertEqual(f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})["version"],1)
                    with self.assertRaises(StoreError) as error: f.base.store.execute(f.base.actor,{"action":"getTurn","sessionId":f.base.session["sessionId"],"requestId":"turn-1"})
                    self.assertEqual(error.exception.code,"NOT_FOUND")
                finally: f.close()
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending=executor.submit(run)
            try:
                self.assertTrue(entered.wait(10));f=shared[0]
                with self.assertRaises(StoreError) as error: f.base.update()
                self.assertEqual(error.exception.code,"STATE_BUSY")
                with self.assertRaises(LoopError) as error: f.loop.recover("test-owner",f.base.session["sessionId"],"turn-1",f.options)
                self.assertEqual(error.exception.code,"STATE_BUSY")
                backend=SqliteBackend(str(Path(f.base.directory.name)/"state.sqlite"),"epoch-1",lambda:1000)
                try:
                    store=WorkflowStore(backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,coordinator=f.base.coordinator)
                    store.execute({**f.base.actor,"subjectId":"other"},{"action":"createSession","requestId":"other","nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","expiresAt":1900,"state":{}})
                finally: backend.close()
                f.base.flags["cancelled"]=True
            finally: release.set()
            with self.assertRaises(LoopError) as error: pending.result(timeout=10)
            self.assertEqual(error.exception.code,"CANCELLED")


if __name__=="__main__": unittest.main()
