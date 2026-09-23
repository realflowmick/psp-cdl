# SPDX-License-Identifier: Apache-2.0
"""Recovery-only synthetic host. Prompt/provider/tool use is a test failure."""
import json
import sys
from psp_cdl_api_server.persistence import WorkflowStore, OwnerCoordinator
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_llmproxy import DurableLlmLoop, LoopError
from psp_cdl_mcpproxy import McpDispatchGate, binding_digest

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
options=json.load(sys.stdin)
events=[]
def unexpected(*_): raise AssertionError("Unexpected inference/dispatch during recovery or lockdown")
class Host:
    def authenticate(self,_): return {**options["actor"],"scopes":["sessions:read","sessions:write","models:invoke"]}
    def now(self): return 100
    def snapshot(self,p,s): return {"revision":"a1","policyVersion":s["policyVersion"],"registryRevision":"r1","providerId":"mock","providerRevision":"model-1","expires":190,"releaseSources":[],"releaseComplete":True}
    prompt=verification=policy=authorize_final=plan_turn=authorize_transition=unexpected
    def audit(self,p,event):
        events.append(event)
        return True
    def authorize_recovery(self,*_): return True
    def recovery_policy(self,p,b,r): return {"bindingDigest":binding_digest(b),"resources":[{"classes":[],"covenants":r["retained"]["covenants"],"capabilities":[],"checks":{},"parameters":{},"context":{}}]}
host=Host()
backend=SqliteBackend(sys.argv[1],"peer-epoch",host.now)
try:
    store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True)
    gate=McpDispatchGate(store,host,"r1",[])
    loop=DurableLlmLoop(store,gate,host,{"id":"mock","revision":"model-1","complete":True,"sources":[],"invoke":unexpected},{"postCompletion":"lockdown"})
    recovered=loop.recover("synthetic",options["sessionId"],options["requestId"],{"deadline":180,"cancelled":lambda:False})
    denied=None
    try: loop.run("synthetic",options["sessionId"],{"message":"Try to continue."},{"deadline":180,"cancelled":lambda:False,"maxSteps":1,"requestId":"new","expectedVersion":2})
    except LoopError as exc: denied={"code":exc.code,"response":getattr(exc,"response",None)}
    print(json.dumps({"recovered":recovered,"denied":denied,"events":events},ensure_ascii=False))
finally: backend.close()
