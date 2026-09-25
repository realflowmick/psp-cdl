# SPDX-License-Identifier: Apache-2.0
"""Opt-in owner-scoped lifecycle and bounded payload cleanup."""
import re
from psp_cdl_core import canonical_json
from .persistence import WorkflowStore, StoreError, bounded, integer, digest, comparison, MAX_INTEGER
from .workflow import WorkflowService, workflow_error
from .service import ServiceError, identifier, scope_for

LIFECYCLE_PROFILE = "PSP-LIFECYCLE-0.1"


def is_uuid(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", value) is not None


def lifecycle_request(operation, value):
    c = bounded(value)
    fields = {"after", "limit", "status"} if operation == "listSessions" else {"requestId", "sessionId", "expectedVersion"}
    if type(c) is not dict or set(c) != fields:
        raise StoreError("INVALID_COMMAND")
    if operation == "listSessions":
        if c["after"] is not None and not is_uuid(c["after"]) or not integer(c["limit"]) or not 1 <= c["limit"] <= 50 or c["status"] not in ("all", "running", "waiting", "completed", "cancelled", "expired"):
            raise StoreError("INVALID_COMMAND")
    elif not identifier(c["requestId"]) or not is_uuid(c["sessionId"]) or not integer(c["expectedVersion"]) or c["expectedVersion"] < 1:
        raise StoreError("INVALID_COMMAND")
    return c


class LifecycleStore(WorkflowStore):
    def __init__(self, backend, *, authorize_retention, **kwargs):
        super().__init__(backend, **kwargs)
        if not callable(authorize_retention) or any(not callable(getattr(backend, k, None)) for k in ("list_sessions", "cleanup_candidate")):
            raise StoreError("INVALID_CONFIGURATION")
        self._retention = authorize_retention

    def lifecycle(self, actor, operation, value, guard):
        actor, c = bounded(actor), lifecycle_request(operation, value)
        if type(actor) is not dict or set(actor) != {"tenantId", "subjectId"} or not all(identifier(actor[k]) for k in actor) or not callable(guard) or operation not in ("listSessions", "cancelSession", "purgeSession"):
            raise StoreError("INVALID_STATE")

        def run():
            now = self._now()

            def access(result, current=None, replay=False):
                try:
                    allowed = guard({"command": {"action": operation, **bounded(c)}, "current": bounded(current), "result": bounded(result), "replay": replay})
                except Exception:
                    raise StoreError("AUTHORIZATION_DENIED") from None
                if allowed is not True:
                    raise StoreError("AUTHORIZATION_DENIED")

            if operation == "listSessions":
                access({"sessions": [], "after": None})
                rows = self.backend.list_sessions(actor, c["after"] or "", int(c["limit"]) + 1, c["status"], now)
                page = rows[:int(c["limit"])]
                for r in page:
                    access(r["body"], r["body"])
                return {"sessions": [bounded(r["body"]) for r in page], "after": page[-1]["id"] if len(rows) > c["limit"] else None}

            command_digest = digest(canonical_json({"action": operation, **c}))
            receipt_key = {"kind": "receipt", "id": digest(canonical_json([actor["subjectId"], c["requestId"]]))}

            def replay():
                r = self.backend.read(actor["tenantId"], receipt_key)
                if r is None:
                    return None
                if any(r["body"].get(k) != actor[k] for k in actor):
                    raise StoreError("NOT_FOUND")
                if r["body"].get("digest") != command_digest:
                    raise StoreError("IDEMPOTENCY_CONFLICT")
                if r["body"].get("profile") != LIFECYCLE_PROFILE or type(r["body"].get("result")) is not dict:
                    raise StoreError("RECEIPT_RETIRED")
                access(r["body"]["result"], replay=True)
                return bounded(r["body"]["result"])

            cached = replay()
            if cached is not None:
                return cached
            s = self.backend.read(actor["tenantId"], {"kind": "session", "id": c["sessionId"]})
            if s is None or any(s["body"].get(k) != actor[k] for k in actor):
                raise StoreError("NOT_FOUND")
            if s["revision"] != c["expectedVersion"]:
                winner = replay()
                if winner is not None:
                    return winner
                raise StoreError("STATE_CONFLICT")
            if s["revision"] >= MAX_INTEGER:
                raise StoreError("VERSION_EXHAUSTED")
            checks, writes, removed = [comparison(s), {**receipt_key, "revision": None}], [], []
            if operation == "cancelSession":
                if s["body"]["status"] not in ("running", "waiting"):
                    raise StoreError("INVALID_TRANSITION")
                body = {**s["body"], "status": "cancelled", "version": s["revision"] + 1, "updatedAt": now}
                result = {"sessionId": s["id"], "version": body["version"], "status": "cancelled"}
            else:
                if s["body"]["status"] not in ("completed", "cancelled", "purged") and not (integer(s["body"].get("expiresAt")) and now >= s["body"]["expiresAt"]):
                    raise StoreError("INVALID_TRANSITION")
                candidate = self.backend.cleanup_candidate(actor, s["id"])
                r = candidate["record"]
                if r is not None:
                    if r["revision"] >= MAX_INTEGER:
                        raise StoreError("VERSION_EXHAUSTED")
                    removed = [r]
                    checks.append(comparison(r))
                    writes.append({**r, "revision": r["revision"] + 1, "body": {**actor, "sessionId": s["id"], "tombstone": True, **({"digest": r["body"]["digest"]} if type(r["body"].get("digest")) is str else {})}})
                body = {**actor, "sessionId": s["id"], "status": "purged", "version": s["revision"] + 1, "purgedAt": s["body"].get("purgedAt", now)}
                result = {"sessionId": s["id"], "version": body["version"], "status": "purged", "cleaned": len(removed), "more": candidate["more"]}
            writes.extend([{**s, "revision": s["revision"] + 1, "body": body}, {**receipt_key, "revision": 1, "body": {**actor, "profile": LIFECYCLE_PROFILE, "digest": command_digest, "result": result}}])
            if operation == "purgeSession":
                try:
                    allowed = self._retention(bounded(actor), {"session": bounded(s["body"]), "removed": bounded(removed), "writes": bounded(writes), "now": now})
                except Exception:
                    raise StoreError("RETENTION_DENIED") from None
                if allowed is not True:
                    raise StoreError("RETENTION_DENIED")
            try:
                allowed = self._authorize(bounded(actor), bounded(writes))
            except Exception:
                raise StoreError("PERSISTENCE_DENIED") from None
            if allowed is not True:
                raise StoreError("PERSISTENCE_DENIED")
            access(result, s["body"])
            if not self.backend.commit(actor["tenantId"], checks, writes, MAX_INTEGER):
                winner = replay()
                if winner is not None:
                    return winner
                raise StoreError("STATE_CONFLICT")
            return bounded(result)

        return self.coordinator.run(actor, run) if self.coordinator else run()


class LifecycleService(WorkflowService):
    operations = (*WorkflowService.operations, "listSessions", "cancelSession", "purgeSession")

    def invoke(self, operation, value, token, expected_identity=None):
        if operation not in ("listSessions", "cancelSession", "purgeSession"):
            return super().invoke(operation, value, token, expected_identity)
        try:
            principal = self.authenticate(token)

            def recheck():
                live = self.authenticate(token)
                if any(live[k] != principal[k] for k in ("tenantId", "subjectId")) or scope_for(operation) not in live["scopes"]:
                    raise ServiceError("FORBIDDEN", 403)
                return live

            if expected_identity is not None and any(expected_identity[k] != principal[k] for k in ("tenantId", "subjectId")):
                raise ServiceError("FORBIDDEN", 403)
            recheck()

            def guard(context):
                allowed = self.host.authorize(bounded(recheck()), context)
                recheck()
                return allowed is True

            result = self.store.lifecycle({k: principal[k] for k in ("tenantId", "subjectId")}, operation, value, guard)
            recheck()
            return {"profile": LIFECYCLE_PROFILE, "result": result}
        except Exception as exc:
            raise workflow_error(exc) from None
