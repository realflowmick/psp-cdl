# SPDX-License-Identifier: Apache-2.0
"""Shared lifecycle expectations; no implementation is used as an oracle."""
import json
import sys
from pathlib import Path

def step(op, request, status=200, error=None, **extra):
    return {"operation":op,"request":request,"expect":{"status":status,**({"error":error} if error else {})},**extra}
listing={"after":None,"limit":10,"status":"all"}
cancel={"requestId":"cancel","sessionId":"@session","expectedVersion":1}
purge={"requestId":"purge","sessionId":"@session","expectedVersion":2}
checkpoint={"requestId":"cp","sessionId":"@session","expectedVersion":1,"expiresAt":1500}
update={"requestId":"save","sessionId":"@session","expectedVersion":1,"nodeId":"entry","nodeVersion":"1","status":"running","state":{"stage":"changed"}}
cases=[]
def case(name,steps): cases.append({"id":name,"steps":steps})
case("owner-list",[step("listSessions",listing,count=1)])
for token in ("test-other","test-tenant"):
    case(token+"-isolation",[step("listSessions",listing,token=token,count=0),step("cancelSession",cancel,404,"NOT_FOUND",token=token)])
case("list-boundaries",[step("listSessions",{**listing,"limit":n},400,"INVALID_COMMAND") for n in (0,51,1.5,True)])
case("strict-fields",[step("listSessions",{**listing,"tenantId":"tenant-a"},400,"INVALID_COMMAND"),step("cancelSession",{**cancel,"approved":True},400,"INVALID_COMMAND")])
case("scope-filter",[step("cancelSession",cancel,403,"FORBIDDEN",token="test-reader"),step("purgeSession",purge,403,"FORBIDDEN",token="test-reader")])
case("cancel-and-retry",[step("cancelSession",cancel,state="cancelled",version=2),step("cancelSession",cancel,state="cancelled",version=2),step("cancelSession",{**cancel,"requestId":"new","expectedVersion":2},409,"INVALID_TRANSITION"),step("cancelSession",{**cancel,"expectedVersion":2},409,"IDEMPOTENCY_CONFLICT")])
case("cancel-invalidates-handle",[{"issue":"@op"},step("cancelSession",cancel),step("evaluate",{"operation_id":"@op"},409,"INVALID_TRANSITION")])
case("cancel-invalidates-checkpoint",[step("createCheckpoint",checkpoint,capture="@cp"),step("cancelSession",{**cancel,"expectedVersion":2}),step("resumeCheckpoint",{"requestId":"resume","checkpointId":"@cp","state":{}},409,"STATE_CONFLICT"),step("createCheckpoint",checkpoint,409,"INVALID_TRANSITION")])
case("cancel-blocks-commit",[step("cancelSession",cancel),step("updateSession",update,409,"STATE_CONFLICT")])
case("completed-cannot-cancel",[step("updateSession",{**update,"status":"completed"}),step("cancelSession",{**cancel,"expectedVersion":2},409,"INVALID_TRANSITION")])
case("persistence-denies-cancel",[step("cancelSession",cancel,403,"PERSISTENCE_DENIED",flags={"persist":False},state="running",version=1)])
case("authorization-denies-cancel",[step("cancelSession",cancel,403,"AUTHORIZATION_DENIED",flags={"deny":True},state="running",version=1)])
case("revocation-during-authorization",[step("cancelSession",cancel,403,"AUTHORIZATION_DENIED",flags={"revokeOnAuthorize":True},version=1)])
case("detached-authorization",[step("cancelSession",cancel,flags={"mutateGuard":True},state="cancelled",version=2)])
case("active-purge-rejected",[step("purgeSession",{**purge,"expectedVersion":1},409,"INVALID_TRANSITION")])
case("retention-denies-purge",[step("cancelSession",cancel),step("purgeSession",purge,403,"RETENTION_DENIED",flags={"retention":False},state="cancelled",version=2)])
case("persistence-denies-tombstones",[step("cancelSession",cancel),step("purgeSession",purge,403,"PERSISTENCE_DENIED",flags={"persist":False},state="cancelled",version=2)])
case("payload-cleanup-and-replay",[step("cancelSession",cancel),step("purgeSession",purge,state="purged",version=3,cleaned=1,more=False),step("purgeSession",purge,state="purged",version=3),step("getSession",{"sessionId":"@session"},404,"NOT_FOUND"),step("listSessions",listing,count=0)])
case("completed-cleanup",[step("updateSession",{**update,"status":"completed"}),step("purgeSession",purge,more=True),step("purgeSession",{**purge,"requestId":"purge-2","expectedVersion":3},more=False)])
case("waiting-cleanup-at-expiry",[step("createCheckpoint",checkpoint,capture="@cp"),step("purgeSession",purge,flags={"now":2000},more=True),step("resumeCheckpoint",{"requestId":"resume","checkpointId":"@cp","state":{}},404,"NOT_FOUND")])
case("expiry-is-strict",[step("listSessions",{**listing,"status":"expired"},flags={"now":1999},count=0),step("listSessions",{**listing,"status":"expired"},flags={"now":2000},count=1),step("purgeSession",{**purge,"expectedVersion":1},state="purged")])
case("late-cancel",[step("cancelSession",cancel,flags={"now":2000},state="cancelled")])
case("update-wins-cancel-race",[step("cancelSession",cancel,409,"STATE_CONFLICT",flags={"winUpdate":True},state="running",version=2)])
case("resume-wins-cancel-race",[step("createCheckpoint",checkpoint,capture="@cp"),step("cancelSession",{**cancel,"expectedVersion":2},409,"STATE_CONFLICT",flags={"winResume":True},state="running",version=3)])
case("cdl-retention-conflict",[step("cancelSession",cancel),step("purgeSession",purge,403,"RETENTION_DENIED",flags={"retentionCdlConflict":True},state="cancelled",version=2)])
case("read-suppressed-after-concurrent-purge",[step("updateSession",{**update,"status":"completed"}),step("getSession",{"sessionId":"@session"},404,"NOT_FOUND",flags={"purgeOnRead":True},state="purged",version=3)])
path=Path(__file__).resolve().parents[1]/"conformance/vectors/workflows/lifecycle-0.1.json"
value=json.dumps({"profile":"PSP-LIFECYCLE-0.1","cases":cases},indent=2)+"\n"
if sys.argv[1:]==["--check"]: assert path.read_bytes()==value.encode()
else: path.write_text(value,encoding="utf-8",newline="\n")
print(f"{len(cases)} lifecycle cases.")
