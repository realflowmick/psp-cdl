# SPDX-License-Identifier: Apache-2.0
"""Synthetic process-restart host; no real provider or customer data."""
import json
import sys
from types import SimpleNamespace
from psp_cdl_api_server.persistence import WorkflowStore, OwnerCoordinator
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_llmproxy import RefreshingLlmLoop, prompt_context
from psp_cdl_mcpproxy import McpDispatchGate, binding_digest

sys.stdin.reconfigure(encoding="utf-8");sys.stdout.reconfigure(encoding="utf-8")
options=json.load(sys.stdin)
requests,refreshes,events=[],[],[]
key=bytes([19])*32
def sign(b,version,timestamp,expires):
    return sign_envelope("System "+version,{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"test-signing-key","timestamp":timestamp,"expires":expires,"version":version,"sectionType":"system","contentType":"text","attributes":{**prompt_context(b),"refresh-policy":"interval|expiration","refresh-interval":"1","refresh-grace":"10"}},key)
class Host:
    def authenticate(self,t):return {**options["actor"],"scopes":["sessions:read","sessions:write","models:invoke","tools:list","tools:call"]} if t=="synthetic" else None
    def now(self):return options["now"]
    def snapshot(self,p,s):return {"revision":"a1","policyVersion":s["policyVersion"],"registryRevision":"r1","providerId":"mock","providerRevision":"model-1","expires":190,"releaseSources":[],"releaseComplete":True}
    def prompt(self,p,b):return sign(b,b.get("refresh",{}).get("current_version") or "1.0.0",90,150)
    def verification(self,*_):return {"keys":[{"id":"test-signing-key","algorithm":"hmac-sha256","material":key,"status":"active","trustLevels":[2],"sectionTypes":["system"],"scope":{},"allowUnscoped":False}]}
    def policy(self,p,b,*_):return {"bindingDigest":binding_digest(b),"resources":[{"classes":[],"covenants":["no-training"],"capabilities":[],"checks":{},"parameters":{},"context":{}}]}
    def authorize_final(self,*_):return True
    def plan_turn(self,*_):return {"state":{"done":False},"retained":{"covenants":["no-training"]},"complete":False}
    def authorize_transition(self,*_):return True
    def audit(self,*_):return True
    def authorize_recovery(self,*_):return True
    recovery_policy=policy
    def refresh(self,p,b,r):
        refreshes.append(r)
        return sign(b,options.get("nextVersion","1.0.1"),options["now"],options["now"]+50)
    def authorize_refresh(self,*_):return True
    def audit_refresh(self,p,e):events.append(e);return True
def invoke(r,_):requests.append(r);return {"type":"final","text":"Finished 🧪"}
host=Host();backend=SqliteBackend(sys.argv[1],"peer-epoch",host.now)
try:
    store=WorkflowStore(backend,resume_secret=bytes([42])*32,authorize_persistence=lambda *_:True,coordinator=OwnerCoordinator(),durable_turns=True,prompt_refresh=True)
    gate_host=SimpleNamespace(authenticate=host.authenticate,now=host.now,policy=host.policy,snapshot=lambda p,s:{k:v for k,v in host.snapshot(p,s).items() if k not in ("providerId","providerRevision")})
    gate=McpDispatchGate(store,gate_host,"r1",[])
    loop=RefreshingLlmLoop(store,gate,host,{"id":"mock","revision":"model-1","complete":True,"sources":[],"invoke":invoke},{"postCompletion":"lockdown"})
    controls={"deadline":190,"cancelled":lambda:False,"maxSteps":1,"requestId":options["requestId"],"expectedVersion":options["expectedVersion"]}
    result=loop.recover("synthetic",options["sessionId"],options["requestId"],controls) if options.get("recover") else loop.run("synthetic",options["sessionId"],{"message":"Continue."},controls)
    prompt=store.execute(options["actor"],{"action":"getPromptState","sessionId":options["sessionId"]})
    print(json.dumps({"result":result,"prompt":prompt,"requests":requests,"refreshes":refreshes,"events":events},ensure_ascii=False))
finally:backend.close()
