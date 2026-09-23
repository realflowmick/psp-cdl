# SPDX-License-Identifier: Apache-2.0
"""Trusted-host workflow state; independent of HTTP/MCP and database engines."""
import base64
import hashlib
import hmac
import re
import uuid
import threading
from typing import Protocol

from psp_cdl_core import canonical_json, validate_json
from .service import identifier
from .prompt_state import PROMPT_REFRESH_PROFILE, valid_prompt_state, compare_prompt_versions
from .redirect_state import REDIRECT_PROFILE, valid_redirect, valid_redirect_target
from .scoped_state import SCOPED_PROFILE, valid_scope, valid_scoped_completion, valid_scoped_output, valid_digest, scoped_digest

PERSISTENCE_PROFILE = "PSP-PERSISTENCE-0.1"
MAX_STATE_BYTES = 1_048_576
MAX_INTEGER = 9_007_199_254_740_991


class StoreError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class AtomicBackend(Protocol):
    epoch: str
    def now(self) -> int: ...
    def read(self, tenant_id: str, key: dict) -> dict | None: ...
    def commit(self, tenant_id: str, checks: list[dict], writes: list[dict], expires_at: int) -> bool: ...


def integer(value):
    return type(value) in (int, float) and 0 <= value <= MAX_INTEGER and int(value) == value


def positive(value):
    return integer(value) and value > 0


def bounded(value):
    try:
        copy = validate_json(value)
        if len(canonical_json(copy).encode("utf-8")) > MAX_STATE_BYTES:
            raise StoreError("INVALID_STATE")
        return copy
    except Exception:
        raise StoreError("INVALID_STATE") from None


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def key(kind, record_id):
    return {"kind": kind, "id": record_id}


def node_key(node_id, version):
    return key("node", digest(canonical_json([node_id, version])))


def comparison(record):
    return {**key(record["kind"], record["id"]), "revision": record["revision"]}


def absent(record_key):
    return {**record_key, "revision": None}


def row(record_key, body, revision=1):
    return {**record_key, "revision": revision, "body": body}


def validate_batch(tenant_id, checks, writes, expires_at):
    bounded([checks, writes])
    if not identifier(tenant_id) or not integer(expires_at) or type(checks) is not list or type(writes) is not list or not 1 <= len(checks) <= 16 or not 1 <= len(writes) <= 16:
        raise StoreError("INVALID_STATE")
    seen = {}
    for c in checks:
        if type(c) is not dict or set(c) != {"kind", "id", "revision"} or c.get("kind") not in ("node", "session", "checkpoint", "receipt") or not identifier(c.get("id")) or (c.get("revision") is not None and not positive(c["revision"])):
            raise StoreError("INVALID_STATE")
        k = (c["kind"], c["id"])
        if k in seen:
            raise StoreError("INVALID_STATE")
        seen[k] = c["revision"]
    written = set()
    for w in writes:
        if type(w) is not dict or set(w) != {"kind", "id", "revision", "body"} or type(w.get("kind")) is not str or type(w.get("id")) is not str:
            raise StoreError("INVALID_STATE")
        k = (w["kind"], w["id"])
        if k in written or k not in seen or not positive(w.get("revision")) or w["revision"] != (seen[k] or 0) + 1 or type(w.get("body")) is not dict:
            raise StoreError("INVALID_STATE")
        written.add(k)


class OwnerCoordinator:
    """Optional single-process, fail-fast exclusion shared by all writers and gates."""
    def __init__(self):
        self._busy = {}
        self._lock = threading.Lock()

    def run(self, actor, work):
        return self.run_reserved(actor, lambda _:work())

    def owns(self, actor, reservation):
        with self._lock: return reservation is not None and self._busy.get((actor["tenantId"],actor["subjectId"])) is reservation

    def run_reserved(self, actor, work):
        if type(actor) is not dict or not identifier(actor.get("tenantId")) or not identifier(actor.get("subjectId")):
            raise StoreError("INVALID_STATE")
        key = (actor["tenantId"], actor["subjectId"])
        with self._lock:
            if key in self._busy:
                raise StoreError("STATE_BUSY")
            reservation=object()
            self._busy[key]=reservation
        try:
            return work(reservation)
        finally:
            with self._lock:
                del self._busy[key]


class WorkflowStore:
    """Authenticate and authorize transitions in the trusted host before calling."""
    def __init__(self, backend: AtomicBackend, *, resume_secret: bytes, authorize_persistence, coordinator=None, durable_turns=False, prompt_refresh=False, redirect_turns=False, scoped_turns=False):
        if not identifier(backend.epoch) or type(resume_secret) is not bytes or len(resume_secret) < 32 or not callable(authorize_persistence):
            raise StoreError("INVALID_CONFIGURATION")
        self.backend = backend
        self._secret = resume_secret
        self._authorize = authorize_persistence
        if coordinator is not None and not isinstance(coordinator, OwnerCoordinator):
            raise StoreError("INVALID_CONFIGURATION")
        self._coordinator = coordinator
        if type(durable_turns) is not bool: raise StoreError("INVALID_CONFIGURATION")
        self.durable_turns = durable_turns
        if type(prompt_refresh) is not bool or prompt_refresh and not durable_turns: raise StoreError("INVALID_CONFIGURATION")
        self.prompt_refresh=prompt_refresh
        if type(redirect_turns) is not bool or redirect_turns and (not durable_turns or prompt_refresh): raise StoreError("INVALID_CONFIGURATION")
        self.redirect_turns=redirect_turns
        if type(scoped_turns) is not bool or scoped_turns and (not durable_turns or prompt_refresh or redirect_turns):raise StoreError("INVALID_CONFIGURATION")
        self.scoped_turns=scoped_turns

    @property
    def coordinator(self):
        return self._coordinator

    @property
    def epoch(self):
        return self.backend.epoch

    def _now(self):
        now = self.backend.now()
        if not integer(now):
            raise StoreError("INVALID_CLOCK")
        return now

    def _token(self, actor, checkpoint_id):
        message = canonical_json([PERSISTENCE_PROFILE, self.backend.epoch, actor["tenantId"], actor["subjectId"], checkpoint_id]).encode("utf-8")
        mac = base64.urlsafe_b64encode(hmac.digest(self._secret, message, "sha256")).decode("ascii").rstrip("=")
        return checkpoint_id + "." + mac

    def _owned(self, actor, kind, record_id):
        r = self.backend.read(actor["tenantId"], key(kind, record_id))
        if r is None or r["body"].get("subjectId") != actor["subjectId"] or r["body"].get("tenantId") != actor["tenantId"]:
            raise StoreError("NOT_FOUND")
        return r

    def _live(self, record, now):
        expiry = record["body"].get("expiresAt")
        if not integer(expiry):
            raise StoreError("STORE_CORRUPT")
        if now >= expiry:
            raise StoreError("EXPIRED")

    def _node(self, actor, node_id, version):
        r = self.backend.read(actor["tenantId"], node_key(node_id, version))
        if r is None:
            raise StoreError("NOT_FOUND")
        return r

    def _result(self, actor, result):
        out = bounded(result)
        if out.get("checkpointId"):
            cp = self._owned(actor, "checkpoint", out["checkpointId"])
            token = self._token(actor, out["checkpointId"])
            if digest(token) != cp["body"]["tokenHash"]:
                raise StoreError("CHECKPOINT_KEY_CHANGED")
            out["resumeToken"] = token
        return out

    def execute(self, actor_value, command_value, guard=None, reservation=None):
        # A competing commit can occur after the receipt miss but before a state read.
        actor, command = bounded(actor_value), bounded(command_value)
        if reservation is not None:
            if type(actor) is not dict or type(command) is not dict or command.get("action")!="putPromptState" or self.coordinator is None or not self.coordinator.owns(actor,reservation): raise StoreError("INVALID_RESERVATION")
            original=guard
            def guard(context):
                if not self.coordinator.owns(actor,reservation): raise StoreError("INVALID_RESERVATION")
                ok=original(context) if original else True
                return ok is True and self.coordinator.owns(actor,reservation)
        work = lambda: self._execute_retry(actor, command, guard)
        if self.coordinator is not None and reservation is None and type(command) is dict and command.get("action") not in ("getSession", "getNode", "getTurn", "getPromptState"):
            return self.coordinator.run(actor, work)
        return work()

    def _execute_retry(self, actor, command, guard):
        try:
            return self._execute_once(actor, command, guard)
        except StoreError as exc:
            if exc.code in ("STATE_CONFLICT", "CHECKPOINT_CONSUMED", "INVALID_TRANSITION"):
                return self._execute_once(actor, command, guard)
            raise

    def _execute_once(self, actor_value, command_value, guard=None):
        actor, c = bounded(actor_value), bounded(command_value)

        def access(result, current=None, replay=False):
            if guard is not None:
                try:
                    allowed = guard({"command": bounded(c), "current": None if current is None else bounded(current), "result": bounded(result), "replay": replay})
                except Exception:
                    raise StoreError("AUTHORIZATION_DENIED") from None
                if allowed is not True:
                    raise StoreError("AUTHORIZATION_DENIED")
            return bounded(result)
        if type(actor) is not dict or set(actor) != {"tenantId", "subjectId"} or not identifier(actor["tenantId"]) or not identifier(actor["subjectId"]) or type(c) is not dict:
            raise StoreError("INVALID_STATE")
        fields = {
            "putNode": ["nodeId", "nodeVersion", "definition"], "getNode": ["nodeId", "nodeVersion"],
            "createSession": ["requestId", "nodeId", "nodeVersion", "policyVersion", "expiresAt", "state"],
            "getSession": ["sessionId"],
            "updateSession": ["requestId", "sessionId", "expectedVersion", "nodeId", "nodeVersion", "policyVersion", "status", "state"],
            "createCheckpoint": ["requestId", "sessionId", "expectedVersion", "expiresAt"],
            "resumeCheckpoint": ["requestId", "checkpointId", "resumeToken", "state"],
        }
        if self.durable_turns:
            fields.update(getTurn=["sessionId", "requestId"], commitTurn=["requestId", "sessionId", "expectedVersion", "nodeId", "nodeVersion", "policyVersion", "state", "inputDigest", "output", "retained", "complete", "postCompletion"])
        if self.prompt_refresh: fields.update(getPromptState=["sessionId"],putPromptState=["sessionId","expectedVersion","refreshRevision","state"],commitRefreshedTurn=[*fields["commitTurn"],"refreshRevision"])
        if self.redirect_turns: fields["commitRedirectTurn"]=[*fields["commitTurn"],"redirect"]
        if self.scoped_turns:fields.update(commitScopedWorkflowTurn=[*fields["commitTurn"],"scope","threatState"],commitScopedTurn=["requestId","sessionId","expectedVersion","nodeId","nodeVersion","policyVersion","inputDigest","scopeDigest","threatState","retained","output","violationPhase"])
        action = c.get("action")
        names = fields.get(action) if type(action) is str else None
        if names is None or set(c) != {"action", *names}:
            raise StoreError("INVALID_COMMAND")
        for name in ("requestId", "nodeId", "nodeVersion", "policyVersion"):
            if name in c and not identifier(c[name]):
                raise StoreError("INVALID_COMMAND")
        for name in ("sessionId", "checkpointId"):
            if name in c and (type(c[name]) is not str or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", c[name])):
                raise StoreError("INVALID_COMMAND")
        if ("state" in c and type(c["state"]) is not dict) or ("definition" in c and type(c["definition"]) is not dict) or ("expectedVersion" in c and not positive(c["expectedVersion"])) or ("expiresAt" in c and not positive(c["expiresAt"])) or ("status" in c and c["status"] not in ("running", "completed")):
            raise StoreError("INVALID_COMMAND")
        if action == "resumeCheckpoint" and (type(c["resumeToken"]) is not str or len(c["resumeToken"]) != 80):
            raise StoreError("INVALID_TOKEN")
        if "refreshRevision" in c and not integer(c["refreshRevision"]): raise StoreError("INVALID_COMMAND")
        if action=="putPromptState" and not valid_prompt_state(c["state"]): raise StoreError("INVALID_COMMAND")
        if action in ("commitTurn","commitRefreshedTurn","commitRedirectTurn","commitScopedWorkflowTurn"):
            output = c["output"]
            provenance = output.get("provenance") if type(output) is dict else None
            if type(c["complete"]) is not bool or c["postCompletion"] != ("redirect" if action=="commitRedirectTurn" else "scoped" if action=="commitScopedWorkflowTurn" else "lockdown") or type(c["retained"]) is not dict or type(c["inputDigest"]) is not str or not re.fullmatch(r"[0-9a-f]{64}", c["inputDigest"]) or type(output) is not dict or set(output) != {"text", "provenance"} or type(output["text"]) is not str or type(provenance) is not dict or set(provenance) != {"profile", "providerId", "providerRevision", "outputDigest", "trustLevel", "steps"} or provenance["profile"] != "PSP-LLM-LOOP-0.1" or provenance["trustLevel"] != 5 or not identifier(provenance["providerId"]) or not identifier(provenance["providerRevision"]) or not positive(provenance["steps"]) or provenance["steps"] > 32 or provenance["outputDigest"] != digest(canonical_json({"text":output["text"]})):
                raise StoreError("INVALID_COMMAND")
        if action=="commitRedirectTurn" and (not valid_redirect(c["redirect"]) or c["redirect"]["nodeId"]==c["nodeId"] if c["complete"] else c["redirect"] is not None): raise StoreError("INVALID_COMMAND")
        if action=="commitScopedWorkflowTurn" and (not valid_scope(c["scope"]) or type(c["threatState"]) is not dict if c["complete"] else c["scope"] is not None or c["threatState"] is not None):raise StoreError("INVALID_COMMAND")
        if action=="commitScopedTurn" and (not valid_digest(c["inputDigest"]) or not valid_digest(c["scopeDigest"]) or type(c["threatState"]) is not dict or type(c["retained"]) is not dict or (not valid_scoped_output(c["output"]) if c["violationPhase"] is None else c["violationPhase"] not in ("ingress","egress") or c["output"] is not None)):raise StoreError("INVALID_COMMAND")
        now = self._now()
        prompt_key=key("receipt",digest(canonical_json(["prompt-refresh",actor["subjectId"],c.get("sessionId")])))
        if action=="getPromptState":
            session=self._owned(actor,"session",c["sessionId"]);self._live(session,now)
            r=self.backend.read(actor["tenantId"],prompt_key)
            if r is None or r["body"].get("profile")!=PROMPT_REFRESH_PROFILE: raise StoreError("NOT_FOUND")
            self._live(r,now)
            return access({**r["body"],"revision":r["revision"]},session["body"])
        if action=="putPromptState":
            session=self._owned(actor,"session",c["sessionId"]);self._live(session,now)
            if session["revision"]!=c["expectedVersion"]: raise StoreError("STATE_CONFLICT")
            if session["body"]["status"]!="running": raise StoreError("INVALID_TRANSITION")
            r=self.backend.read(actor["tenantId"],prompt_key)
            old=r["body"]["state"] if r else None
            state=c["state"]
            if (r["revision"] if r else 0)!=c["refreshRevision"] or r and r["body"]["sessionVersion"]!=session["revision"]: raise StoreError("STATE_CONFLICT")
            if r and r["revision"]==MAX_INTEGER: raise StoreError("VERSION_EXHAUSTED")
            if old and (compare_prompt_versions(state["version"],old["version"])<0 or compare_prompt_versions(state["version"],old["version"])==0 and state["digest"]!=old["digest"]): raise StoreError("PROMPT_ROLLBACK")
            if state["turnCount"]!=0 or state["refreshCount"]!=(old["refreshCount"]+1 if old else 0) or old and state["timestamp"]<=old["timestamp"]: raise StoreError("INVALID_TRANSITION")
            body={**actor,"profile":PROMPT_REFRESH_PROFILE,"sessionId":c["sessionId"],"sessionVersion":session["revision"],"expiresAt":session["body"]["expiresAt"],"state":state}
            revision=(r["revision"] if r else 0)+1
            checks=[comparison(session),comparison(r) if r else absent(prompt_key)];writes=[row(prompt_key,body,revision)]
            validate_batch(actor["tenantId"],checks,writes,session["body"]["expiresAt"])
            try: allowed=self._authorize(bounded(actor),bounded(writes))
            except Exception: raise StoreError("PERSISTENCE_DENIED") from None
            if allowed is not True: raise StoreError("PERSISTENCE_DENIED")
            result={**body,"revision":revision};access(result,r["body"] if r else None)
            if not self.backend.commit(actor["tenantId"],checks,writes,session["body"]["expiresAt"]): raise StoreError("STATE_CONFLICT")
            return bounded(result)
        if action == "getSession":
            s = self._owned(actor, "session", c["sessionId"])
            self._live(s, self._now())
            return access(s["body"], s["body"])
        if action == "getNode":
            node = self._node(actor, c["nodeId"], c["nodeVersion"])
            return access(node["body"], node["body"])
        if action == "getTurn":
            receipt = self.backend.read(actor["tenantId"], key("receipt", digest(canonical_json([actor["subjectId"], c["requestId"]]))))
            if receipt is None or receipt["body"].get("subjectId") != actor["subjectId"] or receipt["body"].get("tenantId") != actor["tenantId"] or receipt["body"].get("profile") != "PSP-LLM-DURABLE-0.1" or type(receipt["body"].get("result")) is not dict or receipt["body"]["result"].get("sessionId") != c["sessionId"]:
                raise StoreError("NOT_FOUND")
            self._live(receipt, self._now())
            return access(receipt["body"]["result"], replay=True)
        current = None
        checks, writes, expires_at = [], [], MAX_INTEGER
        receipt_key = key("receipt", digest(canonical_json([actor["subjectId"], c["requestId"]]))) if "requestId" in c else None
        command_digest = digest(canonical_json(c))

        def receipt_result():
            if receipt_key is None:
                return None
            r = self.backend.read(actor["tenantId"], receipt_key)
            if r is None:
                return None
            if r["body"].get("subjectId") != actor["subjectId"] or r["body"].get("tenantId") != actor["tenantId"]:
                raise StoreError("NOT_FOUND")
            if r["body"]["digest"] != command_digest:
                raise StoreError("IDEMPOTENCY_CONFLICT")
            self._live(r, self._now())
            access(r["body"]["result"], replay=True)
            return self._result(actor, r["body"]["result"])

        cached = receipt_result()
        if cached is not None:
            return cached
        if action == "putNode":
            k = node_key(c["nodeId"], c["nodeVersion"])
            old = self.backend.read(actor["tenantId"], k)
            if old is not None:
                if canonical_json(old["body"]["definition"]) != canonical_json(c["definition"]):
                    raise StoreError("NODE_CONFLICT")
                return access(old["body"], old["body"], True)
            result = {"tenantId": actor["tenantId"], "nodeId": c["nodeId"], "nodeVersion": c["nodeVersion"], "definition": c["definition"], "createdAt": now}
            checks, writes = [absent(k)], [row(k, result)]
        elif action == "createSession":
            n = self._node(actor, c["nodeId"], c["nodeVersion"])
            expires_at = c["expiresAt"]
            if now >= expires_at:
                raise StoreError("EXPIRED")
            session_id = str(uuid.uuid4())
            k = key("session", session_id)
            result = {**actor, "sessionId": session_id, "version": 1, "nodeId": c["nodeId"], "nodeVersion": c["nodeVersion"], "policyVersion": c["policyVersion"], "status": "running", "state": c["state"], "createdAt": now, "updatedAt": now, "expiresAt": expires_at}
            checks, writes = [comparison(n), absent(k)], [row(k, result)]
        else:
            cp = None
            if action == "resumeCheckpoint":
                cp = self._owned(actor, "checkpoint", c["checkpointId"])
                token = self._token(actor, cp["id"])
                if not hmac.compare_digest(digest(token), digest(c["resumeToken"])) or digest(c["resumeToken"]) != cp["body"]["tokenHash"]:
                    raise StoreError("INVALID_TOKEN")
                self._live(cp, now)
                if cp["body"]["consumed"]:
                    raise StoreError("CHECKPOINT_CONSUMED")
            s = self._owned(actor, "session", cp["body"]["sessionId"] if cp else c["sessionId"])
            self._live(s, now)
            current = s["body"]
            if s["revision"] == MAX_INTEGER:
                raise StoreError("VERSION_EXHAUSTED")
            if s["revision"] != (cp["body"]["sessionVersion"] if cp else c["expectedVersion"]):
                raise StoreError("STATE_CONFLICT")
            if s["body"]["status"] != ("waiting" if cp else "completed" if action=="commitScopedTurn" else "running"):
                raise StoreError("INVALID_TRANSITION")
            expires_at = s["body"]["expiresAt"]
            next_state = {**s["body"], "version": s["revision"] + 1, "updatedAt": now}
            checks = [comparison(s)]
            if action=="commitScopedTurn":
                previous=s["body"].get("llmCompletion")
                if not valid_scoped_completion(previous):raise StoreError("INVALID_TRANSITION")
                if any(c[k]!=s["body"][k] for k in ("nodeId","nodeVersion","policyVersion")) or c["scopeDigest"]!=scoped_digest(previous["scope"]):raise StoreError("STATE_CONFLICT")
                if previous["turnCount"]==MAX_INTEGER or previous["violationCount"]==MAX_INTEGER:raise StoreError("VERSION_EXHAUSTED")
                denied=c["violationPhase"] is not None;turn_count=previous["turnCount"]+1;violation_count=previous["violationCount"]+int(denied)
                if denied and canonical_json(c["retained"])!=canonical_json(previous["retained"]):raise StoreError("INVALID_COMMAND")
                next_state["llmCompletion"]={**previous,"threatState":c["threatState"],"retained":c["retained"],"turnCount":turn_count,"violationCount":violation_count}
                signal={"signal":"post_completion_violation","kind":"hard","phase":c["violationPhase"],"inputDigest":c["inputDigest"],"at":now} if denied else None
                result={"profile":"PSP-LLM-DURABLE-0.1","requestId":c["requestId"],"sessionId":s["id"],"sessionVersion":next_state["version"],"status":"completed","inputDigest":c["inputDigest"],"output":c["output"],"retained":c["retained"],
                        "scoped":{"profile":SCOPED_PROFILE,"scopeDigest":c["scopeDigest"],"turnCount":turn_count,"violationCount":violation_count,"outcome":"violation" if denied else "answer","signal":signal}}
            elif action in ("commitTurn","commitRefreshedTurn","commitRedirectTurn","commitScopedWorkflowTurn"):
                if action=="commitRefreshedTurn":
                    r=self.backend.read(actor["tenantId"],prompt_key)
                    if r is None or r["revision"]!=c["refreshRevision"] or r["body"]["sessionVersion"]!=s["revision"]: raise StoreError("STATE_CONFLICT")
                    state=r["body"]["state"]
                    if not valid_prompt_state(state) or state["turnCount"]==MAX_INTEGER or r["revision"]==MAX_INTEGER: raise StoreError("INVALID_STATE")
                    checks.append(comparison(r));writes.append(row(prompt_key,{**r["body"],"sessionVersion":next_state["version"],"state":{**state,"turnCount":state["turnCount"]+1}},r["revision"]+1))
                if any(c[k] != s["body"][k] for k in ("nodeId", "nodeVersion", "policyVersion")): raise StoreError("STATE_CONFLICT")
                if c["complete"] and now > 253402300799: raise StoreError("INVALID_CLOCK")
                next_state.update(state=c["state"], status="completed" if c["complete"] else "running")
                if c["complete"]: next_state["llmCompletion"] = {"profile":"PSP-LLM-DURABLE-0.1", "policy":"lockdown", "requestId":c["requestId"], "lockedAt":now}
                result = {"profile":"PSP-LLM-DURABLE-0.1", "requestId":c["requestId"], "sessionId":s["id"], "sessionVersion":next_state["version"], "status":next_state["status"], "inputDigest":c["inputDigest"], "output":c["output"], "retained":c["retained"]}
                if action=="commitScopedWorkflowTurn" and c["complete"]:
                    next_state["llmCompletion"]={"profile":SCOPED_PROFILE,"policy":"scoped","requestId":c["requestId"],"completedAt":now,"scope":c["scope"],"threatState":c["threatState"],"retained":c["retained"],"turnCount":0,"violationCount":0}
                    result["scoped"]={"profile":SCOPED_PROFILE,"scopeDigest":scoped_digest(c["scope"]),"turnCount":0,"violationCount":0,"outcome":"completion","signal":None}
                if action=="commitRedirectTurn" and c["complete"]:
                    target=c["redirect"]
                    if target["expiresAt"]<=self._now() or target["expiresAt"]>expires_at: raise StoreError("INVALID_EXPIRY")
                    node=self._node(actor,target["nodeId"],target["nodeVersion"])
                    target_id=str(uuid.uuid4());target_key=key("session",target_id)
                    redirect={"profile":REDIRECT_PROFILE,**target,"sessionId":target_id}
                    body={**actor,"sessionId":target_id,"version":1,**{k:target[k] for k in ("nodeId","nodeVersion","policyVersion","expiresAt")},"status":"running",
                          "state":{"input":c["output"],"retained":c["retained"]},"createdAt":now,"updatedAt":now}
                    checks.extend([comparison(node),absent(target_key)]);writes.append(row(target_key,body))
                    next_state["llmCompletion"]={"profile":REDIRECT_PROFILE,"policy":"redirect","requestId":c["requestId"],"completedAt":now,"redirect":redirect}
                    result["redirect"]=redirect
            elif action == "updateSession":
                n = self._node(actor, c["nodeId"], c["nodeVersion"])
                checks.append(comparison(n))
                next_state.update({name: c[name] for name in ("nodeId", "nodeVersion", "policyVersion", "status", "state")})
                result = next_state
            elif action == "createCheckpoint":
                if c["expiresAt"] > expires_at:
                    raise StoreError("INVALID_EXPIRY")
                expires_at = c["expiresAt"]
                if now >= expires_at:
                    raise StoreError("EXPIRED")
                checkpoint_id = str(uuid.uuid4())
                k = key("checkpoint", checkpoint_id)
                next_state["status"] = "waiting"
                body = {**actor, "checkpointId": checkpoint_id, "sessionId": s["id"], "sessionVersion": s["revision"] + 1, "expiresAt": expires_at, "consumed": False, "tokenHash": digest(self._token(actor, checkpoint_id))}
                checks.append(absent(k))
                writes.append(row(k, body))
                result = {"checkpointId": checkpoint_id, "sessionId": s["id"], "sessionVersion": s["revision"] + 1, "expiresAt": expires_at}
            else:
                checks.append(comparison(cp))
                expires_at = cp["body"]["expiresAt"]
                writes.append(row(key("checkpoint", cp["id"]), {**cp["body"], "consumed": True}, cp["revision"] + 1))
                next_state.update(status="running", state=c["state"])
                result = next_state
            writes.append(row(key("session", s["id"]), next_state, s["revision"] + 1))
        if receipt_key:
            checks.append(absent(receipt_key))
            writes.append(row(receipt_key, {**actor, "digest": command_digest, "expiresAt": expires_at, "result": result, **({"profile":"PSP-LLM-DURABLE-0.1"} if action in ("commitTurn","commitRefreshedTurn","commitRedirectTurn","commitScopedWorkflowTurn","commitScopedTurn") else {})}))
        validate_batch(actor["tenantId"], checks, writes, expires_at)
        try:
            allowed = self._authorize(bounded(actor), bounded(writes))
        except Exception:
            raise StoreError("PERSISTENCE_DENIED") from None
        if allowed is not True:
            raise StoreError("PERSISTENCE_DENIED")
        access(result, current)
        if action=="commitRedirectTurn" and c["complete"] and self._now()>=c["redirect"]["expiresAt"]: raise StoreError("EXPIRED")
        if not self.backend.commit(actor["tenantId"], checks, writes, min(expires_at,c["redirect"]["expiresAt"]) if action=="commitRedirectTurn" and c["complete"] else expires_at):
            if action == "putNode":
                winner = self._node(actor, c["nodeId"], c["nodeVersion"])
                if canonical_json(winner["body"]["definition"]) != canonical_json(c["definition"]):
                    raise StoreError("NODE_CONFLICT")
                return access(winner["body"], winner["body"], True)
            retry = receipt_result()
            if retry is not None:
                return retry
            raise StoreError("STATE_CONFLICT")
        return self._result(actor, result)
