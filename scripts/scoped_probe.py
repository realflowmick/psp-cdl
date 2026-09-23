# SPDX-License-Identifier: Apache-2.0
"""Fresh-process continuation/recovery host; workflow callbacks are forbidden."""
import json
import sys
from psp_cdl_api_server.persistence import WorkflowStore,OwnerCoordinator
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_llmproxy import ScopedLlmLoop,scoped_prompt_context,LoopError
from psp_cdl_mcpproxy import McpDispatchGate,binding_digest
from psp_cdl_core.crypto import sign_envelope
sys.stdin.reconfigure(encoding="utf-8");sys.stdout.reconfigure(encoding="utf-8")
options=json.load(sys.stdin);calls=[];boundaries=[];system="Discuss only the completed synthetic results."
resource={"classes":[],"covenants":["no-training"],"capabilities":[],"checks":{},"parameters":{},"context":{}}
def unexpected(*_):raise AssertionError("Unexpected workflow callback after completion")
class Host:
    def authenticate(self,_):return {**options["actor"],"scopes":["sessions:read","sessions:write","models:invoke"]}
    def now(self):return 100
    def snapshot(self,p,s):return {"revision":"a1","policyVersion":s["policyVersion"],"registryRevision":"r1","providerId":"mock","providerRevision":"model-1","expires":190,"releaseSources":[],"releaseComplete":True}
    prompt=plan_turn=application_threat=unexpected
    def verification(self,*_):return {"keys":[{"id":"test","algorithm":"hmac-sha256","material":bytes([19])*32,"status":"active","trustLevels":[2],"sectionTypes":["system"],"scope":{},"allowUnscoped":False}]}
    def scoped_prompt(self,p,b):return sign_envelope(system,{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"test","timestamp":0,"expires":180,"version":"1.0.0","sectionType":"system","contentType":"text","trustLevel":2,"attributes":scoped_prompt_context(b)},bytes([19])*32)
    def scope_boundary(self,p,b,d):
        boundaries.append(b["phase"]);denied=b["phase"]=="ingress" and d["request"]["message"]!="Explain."
        return {"bindingDigest":binding_digest(b),"decision":"deny" if denied else "allow","threatState":{**d["threatState"],"score":d["threatState"]["score"]+(10 if denied else 1)}}
    def policy(self,p,b,*_):return {"bindingDigest":binding_digest(b),"resources":[resource]}
    def authorize_final(self,*_):return True
    def authorize_transition(self,*_):return True
    def audit(self,*_):return True
    def plan_scoped_turn(self,p,b,d):return {"retained":d["retained"]}
    def authorize_recovery(self,*_):return not options.get("denyRecovery")
    def recovery_policy(self,p,b,r):return {"bindingDigest":binding_digest(b),"resources":[{**resource,"covenants":r["retained"]["covenants"]}]}
def invoke(r,_):calls.append(r);return {"type":"final","text":"Peer scoped answer"}
host=Host();backend=SqliteBackend(sys.argv[1],"peer-epoch",host.now)
try:
    store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True,scoped_turns=True)
    gate=McpDispatchGate(store,host,"r1",[])
    loop=ScopedLlmLoop(store,gate,host,{"id":"mock","revision":"model-1","complete":True,"sources":[],"invoke":invoke},{"postCompletion":"scoped","scope":{"id":"results","version":"1","system":system,"threatPolicy":None}})
    controls={"deadline":180,"cancelled":lambda:False,"maxSteps":1,"requestId":options["requestId"],"expectedVersion":options.get("expectedVersion",1)}
    try:result={"code":"OK","value":loop.recover("synthetic",options["sessionId"],options["requestId"],controls) if options.get("mode")=="recover" else loop.run("synthetic",options["sessionId"],{"message":options.get("message","Explain.")},controls)}
    except LoopError as exc:result={"code":exc.code}
    print(json.dumps({"result":result,"calls":calls,"boundaries":boundaries,"state":store.execute(options["actor"],{"action":"getSession","sessionId":options["sessionId"]})},ensure_ascii=False))
finally:backend.close()
