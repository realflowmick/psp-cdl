# SPDX-License-Identifier: Apache-2.0
"""Draft shared expectations, authored before scoped boundary implementation."""
import json
import sys
from pathlib import Path
cases=[]
def case(name,flags=None,codes=None,version=2,providers=2,turns=0,violations=0,**extra):
    cases.append({"id":name,"flags":flags or {},**extra,"expected":{"codes":codes or ["OK"],"version":version,"providerCalls":providers,"turnCount":turns,"violationCount":violations}})
case("scoped-answer",version=3,providers=3,turns=1)
case("explicit-threat-policy",version=3,providers=3,turns=1,settings={"explicitPolicy":True})
case("ingress-violation",{"denyIngress":True},["PSP_POST_COMPLETION_VIOLATION"],version=3,turns=1,violations=1)
case("egress-violation",{"denyEgress":True},["PSP_POST_COMPLETION_VIOLATION"],version=3,providers=3,turns=1,violations=1)
case("deny-then-answer",codes=["PSP_POST_COMPLETION_VIOLATION","OK"],version=4,providers=3,turns=2,violations=1,steps=[{"flags":{"denyIngress":True}},{"flags":{"denyIngress":False},"options":{"requestId":"scope-2","expectedVersion":3}}])
case("two-answers",codes=["OK","OK"],version=4,providers=4,turns=2,steps=[{}, {"options":{"requestId":"scope-2","expectedVersion":3}}])
case("answer-recovery",codes=["OK","OK"],version=3,providers=3,turns=1,steps=[{}, {"action":"recover"}])
case("violation-recovery",{"denyIngress":True},["PSP_POST_COMPLETION_VIOLATION","PSP_POST_COMPLETION_VIOLATION"],version=3,turns=1,violations=1,steps=[{}, {"action":"recover"}])
case("no-implicit-replay",codes=["OK","TURN_ALREADY_COMMITTED"],version=3,providers=3,turns=1,steps=[{},{}])
case("different-input-retry",codes=["OK","IDEMPOTENCY_CONFLICT"],version=3,providers=3,turns=1,steps=[{}, {"request":{"message":"different"}}])
for flag,code,providers in [("wrongScopedText","PROMPT_REJECTED",2),("workflowPrompt","PROMPT_REJECTED",2),("wrongScopedBinding","PROMPT_REJECTED",2),("tamperedScoped","PROMPT_REJECTED",2),("expiredScoped","PROMPT_REJECTED",2),("revokedPrompt","PROMPT_REJECTED",2),("throwScopedPrompt","HOST_ERROR",2),("wrongBoundaryBinding","INVALID_SCOPE_DECISION",2),("badBoundary","INVALID_SCOPE_DECISION",2),("unknownBoundary","UNSUPPORTED_SCOPE",2),("throwBoundary","HOST_ERROR",2),("boundaryCancel","CANCELLED",2),("boundaryRevoke","UNAUTHENTICATED",2),("boundaryDrift","STALE_AUTHORITY",2),("boundaryExpiry","PROMPT_REJECTED",2),("denyInference","POLICY_DENIED",2),("denyRelease","OUTPUT_DENIED",3),("scopedTool","TOOL_NOT_ALLOWED",3),("scopedStream","INVALID_RESPONSE",3),("badScopedPlan","INVALID_PLAN",3),("throwScopedPlan","HOST_ERROR",3),("denyTransition","TRANSITION_DENIED",3),("denyStorage","PERSISTENCE_DENIED",3),("failBeforeCommit","HOST_ERROR",3),("changedScope","SCOPED_STATE_MISMATCH",2)]:
    case(flag,{flag:True},[code],providers=providers)
for flag,code in [("failAfterCommit","HOST_ERROR"),("cancelAfterCommit","CANCELLED"),("driftAfterCommit","STALE_AUTHORITY"),("denyAfterCommit","OUTPUT_DENIED")]:
    case(flag,{flag:True},[code,"OK"],version=3,providers=3,turns=1,steps=[{}, {"action":"recover","flags":{flag:False},"baseFlags":{"cancelled":False,"drift":False}}])
case("mutable-callback-inputs",{"mutateBoundary":True,"mutateScopedPlan":True,"mutateTransition":True},version=3,providers=3,turns=1)
for name,token,code in [("invalid-credential","bad","UNAUTHENTICATED"),("cross-owner","test-other","NOT_FOUND"),("cross-tenant","test-tenant","NOT_FOUND")]:case(name,codes=[code],steps=[{"token":token}])
case("stale-request",codes=["STALE_SESSION"],steps=[{"options":{"expectedVersion":1}}])
case("model-cannot-select-policy",codes=["INVALID_REQUEST"],steps=[{"request":{"message":"hello","postCompletion":"unmanaged"}}])
case("recovery-policy-denies",codes=["OK","OUTPUT_DENIED"],version=3,providers=3,turns=1,steps=[{}, {"action":"recover","flags":{"denyRecoveryPolicy":True}}])
case("recovery-approval-denies",codes=["OK","RECOVERY_DENIED"],version=3,providers=3,turns=1,steps=[{}, {"action":"recover","flags":{"denyRecovery":True}}])
for name,settings,code in [("store-opt-in",{"disabledScoped":True},"INVALID_CONFIGURATION"),("missing-system",{"emptySystem":True},"UNSUPPORTED_POST_COMPLETION"),("missing-threat-state",{"badApplicationThreat":True},"INVALID_SCOPED_STATE")]:
    cases.append({"id":name,"settings":settings,"expected":{"code":code}})
case("denial-storage-fails",{"denyIngress":True,"denyStorage":True},["PERSISTENCE_DENIED"])
case("denial-approval-fails",{"denyIngress":True,"denyTransition":True},["TRANSITION_DENIED"])
case("no-write-scope",{"noWriteScope":True},["FORBIDDEN"])
case("no-model-scope",{"noModelScope":True},["FORBIDDEN"])
case("provider-cancel",{"providerCancel":True},["CANCELLED"],providers=3)
case("provider-authority-change",{"providerDrift":True},["STALE_AUTHORITY"],providers=3)
case("provider-key-revocation",{"providerKeyRevoke":True},["PROMPT_REJECTED"],providers=3)
suite={"profile":"PSP-LLM-SCOPED-0.1","status":"draft","cases":cases}
path=Path(__file__).resolve().parents[1]/"conformance/vectors/llm/scoped-0.1.json"
text=json.dumps(suite,indent=2,ensure_ascii=False)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=text:raise SystemExit("Scoped vectors differ")
else:path.write_text(text,encoding="utf-8")
