# SPDX-License-Identifier: Apache-2.0
"""Explicit synthetic expectations for the draft workflow service contract (CC0 output)."""
import json
from pathlib import Path
import sys

PROFILE = "PSP-WORKFLOW-SERVICE-0.1"
cases = []
get = {"sessionId":"@session"}
update = {"requestId":"save", "sessionId":"@session", "expectedVersion":1, "nodeId":"next", "nodeVersion":"1", "status":"running", "state":{"stage":"saved", "hidden":"PRIVATE_STATE"}}
checkpoint = {"requestId":"pause", "sessionId":"@session", "expectedVersion":1, "expiresAt":1500}
resume = {"requestId":"resume", "checkpointId":"@checkpoint", "state":{"stage":"resumed"}}
create = {"requestId":"create", "nodeId":"entry", "nodeVersion":"1", "expiresAt":2000, "state":{"stage":"new"}}

def response(result): return {"profile":PROFILE, "result":result}
def session(version=1, stage="initial", status="running", id="@session"):
    return response({"sessionId":id,"version":version,"status":status,"view":{"stage":stage}})
def step(operation, request, body=None, status=200, version=1, state="initial", status_after="running", **options):
    return {"operation":operation,"request":request,**options}, {"status":status,"body":body,"version":version,"state":state,"statusAfter":status_after}
def error(operation, request, code, status=403, **options):
    return step(operation,request,{"error":{"code":code}},status,**options)
def case(id, *steps):
    cases.append({"id":id,"steps":[s[0] for s in steps],"expected":[s[1] for s in steps if s[1] is not None]})
def issue(): return ({"issue":"@operation"},None)
def evaluation(version=1, state="initial", status_after="running", **options):
    return step("evaluate",{"operation_id":"@operation"},{"profile":"PSP-SERVICE-0.1","operation_id":"@operation","policy_version":"policy-1","decision":"allow","reasonCodes":[]},version=version,state=state,status_after=status_after,**options)
def pause(**options):
    return step("createCheckpoint",checkpoint,response({"checkpointId":"@checkpoint","sessionId":"@session","sessionVersion":2,"expiresAt":1500}),version=2,status_after="waiting",capture="@checkpoint",**options)
def save(**options): return step("updateSession",update,session(2,"saved"),version=2,state="saved",**options)
def resumed(**options): return step("resumeCheckpoint",resume,session(3,"resumed"),version=3,state="resumed",**options)

case("projected-session",step("getSession",get,session()))
case("projected-node",step("getNode",{"nodeId":"entry","nodeVersion":"1"},response({"nodeId":"entry","nodeVersion":"1","view":{"stage":"entry"}})))
case("create-and-retry",step("createSession",create,session(1,"new",id="@created"),capture="@created"),step("createSession",create,session(1,"new",id="@created")))
case("wrong-owner",error("getSession",get,"NOT_FOUND",404,token="test-other"))
case("wrong-tenant",error("getSession",get,"NOT_FOUND",404,token="test-tenant"))
case("unauthenticated",error("getSession",get,"UNAUTHENTICATED",401,token="invalid"))
case("missing-scope",error("updateSession",update,"FORBIDDEN",token="test-reader"))
case("read-authority-denied",error("getSession",get,"AUTHORIZATION_DENIED",flags={"deny":True}))
for name, flags in [("denied",{"deny":True}),("throwing",{"throwAuthorize":True}),("truthy",{"truthy":True}),("revoked-during-authorization",{"revokeOnAuthorize":True}),("policy-changed-during-authorization",{"changePolicyOnAuthorize":True})]:
    case(name,error("updateSession",update,"AUTHORIZATION_DENIED",flags=flags))
case("persistence-denied",error("updateSession",update,"PERSISTENCE_DENIED",flags={"persist":False}))
for field,value in [("tenantId","other"),("policyVersion","attacker"),("approved",True),("action","putNode")]:
    case("forged-"+field,error("updateSession",{**update,field:value},"INVALID_REQUEST",400))
case("bad-session-id",error("getSession",{"sessionId":"bad"},"INVALID_REQUEST",400))
case("stale-version",error("updateSession",{**update,"expectedVersion":9},"STATE_CONFLICT",409))
case("absent-node",error("updateSession",{**update,"nodeId":"missing"},"NOT_FOUND",404))
case("guard-copies-detached",save(flags={"mutateGuard":True}))
case("competing-write",error("updateSession",update,"STATE_CONFLICT",409,version=2,state="racer",flags={"raceOnAuthorize":True}))
case("update-and-retry",save(),save())
case("retry-authority-rechecked",save(),error("updateSession",update,"AUTHORIZATION_DENIED",version=2,state="saved",flags={"denyReplay":True}))
case("request-id-conflict",save(),error("updateSession",{**update,"state":{"stage":"different"}},"IDEMPOTENCY_CONFLICT",409,version=2,state="saved"))
case("checkpoint-resume",pause(),resumed(),resumed(),error("resumeCheckpoint",{**resume,"requestId":"another"},"CHECKPOINT_CONSUMED",409,version=3,state="resumed"))
case("checkpoint-retry",pause(),pause())
case("checkpoint-delivery-retry",error("createCheckpoint",checkpoint,"CHECKPOINT_DELIVERY_FAILED",503,version=2,status_after="waiting",flags={"deliverFail":True}),pause(flags={"deliverFail":False}))
case("resume-needs-host-approval",pause(),error("resumeCheckpoint",{**resume,"state":{"approved":True,"stage":"resumed"}},"AUTHORIZATION_DENIED",version=2,status_after="waiting",flags={"allowResume":False}))
case("resume-token-not-a-wire-argument",pause(),error("resumeCheckpoint",{**resume,"resumeToken":"forged"},"INVALID_REQUEST",400,version=2,status_after="waiting"))
case("expired-checkpoint",pause(),error("resumeCheckpoint",resume,"EXPIRED",409,version=2,status_after="waiting",flags={"now":1500}))
case("expired-session",error("getSession",get,"EXPIRED",409,flags={"now":2000}))
case("stale-policy-checkpoint",error("createCheckpoint",checkpoint,"AUTHORIZATION_DENIED",flags={"policy":"policy-2"}))
case("terminal-session",step("updateSession",{**update,"status":"completed"},session(2,"saved","completed"),version=2,state="saved",status_after="completed"),error("updateSession",{**update,"requestId":"after","expectedVersion":2},"INVALID_TRANSITION",409,version=2,state="saved",status_after="completed"))
case("live-operation",issue(),evaluation())
case("operation-wrong-owner",issue(),error("evaluate",{"operation_id":"@operation"},"NOT_FOUND",404,token="test-other"))
case("operation-invalidated-by-update",issue(),save(),error("evaluate",{"operation_id":"@operation"},"STALE_OPERATION",409,version=2,state="saved"))
case("operation-invalidated-by-checkpoint",issue(),pause(),error("evaluate",{"operation_id":"@operation"},"STALE_OPERATION",409,version=2,status_after="waiting"))
case("operation-invalidated-by-policy",issue(),error("evaluate",{"operation_id":"@operation"},"STALE_OPERATION",409,flags={"policy":"policy-2"}))
case("operation-expiry",issue(),error("evaluate",{"operation_id":"@operation"},"STALE_OPERATION",409,flags={"now":1800}))

output = json.dumps({"profile":PROFILE,"license":"CC0-1.0","cases":cases},indent=2)+"\n"
path = Path(__file__).resolve().parents[1]/"conformance/vectors/workflows/service-0.1.json"
if sys.argv[1:] == ["--check"]:
    assert path.read_bytes() == output.encode("utf-8")
elif not sys.argv[1:]:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(output,encoding="utf-8",newline="\n")
else:
    raise SystemExit("Use --check or no arguments.")
print(str(len(cases))+" workflow scenarios agree.")
