# SPDX-License-Identifier: Apache-2.0
import sqlite3
import sys
import unittest
from pathlib import Path
from threading import Event
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from refresh_fixtures import SUITE, Fixture, run_case
from psp_cdl_llmproxy import LoopError, compare_prompt_versions
from psp_cdl_api_server.persistence import WorkflowStore, StoreError, valid_prompt_state
from psp_cdl_api_server.sqlite import SqliteBackend

def get(f):return {"action":"getPromptState","sessionId":f.base.session["sessionId"]}

class RefreshTests(unittest.TestCase):
    def assert_code(self,code,callback):
        with self.assertRaises((LoopError,StoreError)) as error:callback()
        self.assertEqual(error.exception.code,code)

    def test_shared_vectors(self):
        for case in SUITE["cases"]:
            with self.subTest(case=case["id"]):
                actual=run_case(case)
                for key,value in case["expected"].items():self.assertEqual(actual.get(key),value,actual)
                if actual.get("prompt"):self.assertTrue(valid_prompt_state(actual["prompt"]["state"]))
                for step in actual.get("steps",[]):
                    if step["code"]!="OK":self.assertNotIn("value",step)
                for request in actual.get("requests",[]):
                    for secret in ("test-owner","test-signing-key","PRIVATE_","authorityRevision","sessionVersion"):self.assertNotIn(secret,str(request))
                    self.assertEqual(sum(m["role"]=="system" for m in request["messages"]),1)
                for event in actual.get("events",[]):
                    for secret in ("PRIVATE_","System one.","System refreshed.","Read synthetic data."):self.assertNotIn(secret,str(event))
                    if "digest" in event:self.assertRegex(event["digest"],r"^[a-f0-9]{64}$")
                if case["id"] in ("refresh-between-inferences","grace-during-tool"):
                    first,second=actual["requests"]
                    self.assertEqual(first["messages"][0]["content"],"System one.")
                    self.assertEqual(second["messages"][0]["content"],"System refreshed.")
                    self.assertEqual(second["messages"][1:2],first["messages"][1:])
                    self.assertEqual(second["messages"][-1]["role"],"tool")

    def test_semver_precedence(self):
        for a,b,result in SUITE["versions"]:self.assertEqual(compare_prompt_versions(a,b),result)
        for value in ("1.0","01.0.0","1.0.0-01","1.0.0\n"):
            with self.assertRaises(ValueError):compare_prompt_versions(value,"1.0.0")

    def test_sql_failure_rolls_back_counter_state_and_answer(self):
        f=Fixture()
        raw=sqlite3.connect(str(Path(f.base.directory.name)/"state.sqlite"),isolation_level=None)
        try:
            raw.execute("CREATE TRIGGER fail_turn BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' AND json_extract(NEW.body,'$.profile')='PSP-LLM-DURABLE-0.1' BEGIN SELECT RAISE(ABORT,'synthetic'); END;")
            invoke=lambda:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            self.assert_code("HOST_ERROR",invoke)
            before=f.base.store.execute(f.base.actor,get(f))
            self.assertEqual(before["state"]["turnCount"],0);self.assertEqual(before["sessionVersion"],1)
            self.assertEqual(f.base.store.execute(f.base.actor,{"action":"getSession","sessionId":f.base.session["sessionId"]})["version"],1)
            self.assert_code("NOT_FOUND",lambda:f.base.store.execute(f.base.actor,{"action":"getTurn","sessionId":f.base.session["sessionId"],"requestId":"turn-1"}))
            raw.execute("DROP TRIGGER fail_turn")
            invoke()
            after=f.base.store.execute(f.base.actor,get(f))
            self.assertEqual(after["state"]["turnCount"],1);self.assertEqual(after["sessionVersion"],2)
            self.assertEqual(after["revision"],before["revision"]+1)
            f.base.store.execute(f.base.actor,f.commands[-1])
            self.assertEqual(f.base.store.execute(f.base.actor,get(f)),after)
        finally:raw.close();f.close()

    def test_store_opt_in_isolation_validation_and_legacy_transitions(self):
        f=Fixture()
        try:
            f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            current=f.base.store.execute(f.base.actor,get(f))
            command={"action":"putPromptState","sessionId":f.base.session["sessionId"],"expectedVersion":2,"refreshRevision":current["revision"],"state":{**current["state"],"turnCount":0,"refreshCount":1,"timestamp":1001}}
            legacy=WorkflowStore(f.base.backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,durable_turns=True)
            for c in (get(f),command,f.commands[0]):self.assert_code("INVALID_COMMAND",lambda:legacy.execute(f.base.actor,c))
            for actor in ({**f.base.actor,"subjectId":"other"},{**f.base.actor,"tenantId":"other"}):self.assert_code("NOT_FOUND",lambda:f.base.store.execute(actor,get(f)))
            for changed in ({"version":"v1.0.0"},{"digest":"a"*64+"\n"},{"interval":True},{"grace":-1},{"turnCount":9007199254740992},{"policies":["expiration","expiration"]},{"policies":["interval"],"interval":0},{"unexpected":True}):
                state={**command["state"],**changed}
                self.assertFalse(valid_prompt_state(state))
                # JSON bounds reject unsafe integers before command validation.
                code="INVALID_STATE" if changed.get("turnCount")==9007199254740992 else "INVALID_COMMAND"
                self.assert_code(code,lambda:f.base.store.execute(f.base.actor,{**command,"state":state}))
            self.assert_code("PROMPT_ROLLBACK",lambda:f.base.store.execute(f.base.actor,{**command,"state":{**command["state"],"version":"0.9.0"}}))
            self.assert_code("INVALID_COMMAND",lambda:f.base.store.execute(f.base.actor,{**command,"state":{**command["state"],"expires":1001}}))
            f.base.store.execute(f.base.actor,{"action":"updateSession","requestId":"legacy","sessionId":f.base.session["sessionId"],"expectedVersion":2,"nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","status":"running","state":{}})
            self.assert_code("STALE_PROMPT",lambda:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},{**f.options,"requestId":"turn-3","expectedVersion":3}))
            self.assert_code("STATE_CONFLICT",lambda:f.base.store.execute(f.base.actor,{**command,"expectedVersion":3}))
        finally:f.close()

    def test_reservations_are_owner_bound_unforgeable_scoped_and_expire(self):
        f=Fixture();borrowed=[]
        try:
            f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            current=f.base.store.execute(f.base.actor,get(f))
            command={"action":"putPromptState","sessionId":f.base.session["sessionId"],"expectedVersion":2,"refreshRevision":current["revision"],"state":{**current["state"],"turnCount":0,"refreshCount":1,"timestamp":1001}}
            def work(reservation):
                borrowed.append(reservation)
                self.assert_code("STATE_BUSY",lambda:f.base.store.execute(f.base.actor,command))
                self.assert_code("INVALID_RESERVATION",lambda:f.base.store.execute(f.base.actor,command,reservation=object()))
                self.assert_code("INVALID_RESERVATION",lambda:f.base.store.execute({**f.base.actor,"subjectId":"other"},command,reservation=reservation))
                self.assert_code("INVALID_RESERVATION",lambda:f.base.store.execute(f.base.actor,f.commands[0],reservation=reservation))
                f.base.store.execute(f.base.actor,command,lambda _:True,reservation)
            f.base.coordinator.run_reserved(f.base.actor,work)
            self.assert_code("INVALID_RESERVATION",lambda:f.base.store.execute(f.base.actor,command,reservation=borrowed[0]))
            self.assertEqual(f.base.store.execute(f.base.actor,get(f))["state"]["refreshCount"],1)
        finally:f.close()

    def test_pending_refresh_reserves_owner_and_rechecks_cancellation(self):
        entered,release=Event(),Event();shared=[]
        def wait(*_):
            entered.set()
            if not release.wait(10):raise RuntimeError("test timeout")
        def run():
            f=Fixture({"base":{"now":1100}});f.flags["onRefresh"]=wait;shared.append(f)
            try:f.loop.run("test-owner",f.base.session["sessionId"],{"message":"hello"},f.options)
            finally:
                try:
                    self.assertEqual(f.base.store.execute(f.base.actor,get(f))["state"]["version"],"1.0.0")
                    self.assertEqual(f.stats()["providerCalls"],0)
                finally:f.close()
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending=executor.submit(run)
            try:
                self.assertTrue(entered.wait(10));f=shared[0]
                self.assert_code("STATE_BUSY",f.base.update)
                backend=SqliteBackend(str(Path(f.base.directory.name)/"state.sqlite"),"epoch-1",lambda:1100)
                try:
                    store=WorkflowStore(backend,resume_secret=bytes([7])*32,authorize_persistence=lambda *_:True,coordinator=f.base.coordinator)
                    store.execute({**f.base.actor,"subjectId":"other"},{"action":"createSession","requestId":"other","nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","expiresAt":1900,"state":{}})
                finally:backend.close()
                f.base.flags["cancelled"]=True
            finally:release.set()
            self.assert_code("CANCELLED",lambda:pending.result(timeout=10))

if __name__=="__main__":unittest.main()
