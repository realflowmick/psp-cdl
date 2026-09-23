# SPDX-License-Identifier: Apache-2.0
"""Host-only session-bound operation handles. Restart requires fresh issuance."""
from copy import deepcopy
import uuid
from psp_cdl_core import canonical_json, validate_json
from .persistence import integer
from .workflow import workflow_error
from .service import ServiceError, identifier


class SessionOperations:
    def __init__(self, store, host, capacity=1024):
        if not integer(capacity) or capacity < 1:
            raise ServiceError("INVALID_CONFIGURATION", 500)
        self.store, self.host, self.capacity = store, host, capacity
        self._entries = {}

    def authenticate(self, token):
        return self.host.authenticate(token)

    def now(self):
        now = self.host.now()
        if not integer(now):
            raise ServiceError("INTERNAL_ERROR", 500)
        return now

    def _session(self, principal, session_id):
        try:
            return self.store.execute({k: principal[k] for k in ("tenantId", "subjectId")}, {"action": "getSession", "sessionId": session_id}, lambda c: self.host.authorize(deepcopy(principal), c))
        except Exception as exc:
            raise workflow_error(exc) from None

    def _binding(self, principal, session, expires):
        policy = self.host.policy_version(deepcopy(principal))
        if not identifier(policy):
            raise ServiceError("INTERNAL_ERROR", 500)
        if session["status"] != "running" or session["policyVersion"] != policy:
            raise ServiceError("STALE_OPERATION", 409)
        return {"tenantId": principal["tenantId"], "subjectId": principal["subjectId"], **{k: session[k] for k in ("sessionId", "version", "nodeId", "nodeVersion")}, "policyVersion": policy, "epoch": self.store.epoch, "expires": expires}

    def issue(self, principal, session_id, expires):
        now = self.now()
        if not integer(expires) or expires <= now:
            raise ServiceError("STALE_OPERATION", 409)
        session = self._session(principal, session_id)
        if expires > session["expiresAt"]:
            raise ServiceError("INVALID_REQUEST", 400)
        entry = self._binding(principal, session, expires)
        self._entries = {k: v for k, v in self._entries.items() if self.now() < v["expires"]}
        if len(self._entries) >= self.capacity:
            raise ServiceError("OPERATION_CAPACITY", 503)
        operation_id = str(uuid.uuid4())
        self._entries[operation_id] = entry
        return operation_id

    def revoke(self, operation_id):
        self._entries.pop(operation_id, None)

    def resolve(self, principal, operation_id):
        entry = self._entries.get(operation_id)
        if entry is None or any(entry[k] != principal[k] for k in ("tenantId", "subjectId")):
            return None

        def live():
            if self._entries.get(operation_id) is not entry or self.now() >= entry["expires"]:
                raise ServiceError("STALE_OPERATION", 409)
            session = self._session(principal, entry["sessionId"])
            if canonical_json(self._binding(principal, session, entry["expires"])) != canonical_json(entry):
                raise ServiceError("STALE_OPERATION", 409)
            return session

        session = live()
        details = deepcopy(self.host.snapshot(deepcopy(principal), validate_json(session), operation_id))
        live()
        if not integer(details["expires"]) or details["expires"] <= self.now():
            raise ServiceError("STALE_OPERATION", 409)
        required = {"tenant-id": entry["tenantId"], "operation-id": operation_id, "policy-version": entry["policyVersion"], "session-id": entry["sessionId"], "session-version": str(int(entry["version"])), "node-id": entry["nodeId"], "node-version": entry["nodeVersion"]}
        verification = details["verification"]
        return {**details, "tenantId": entry["tenantId"], "subjectId": entry["subjectId"], "operationId": operation_id, "policyVersion": entry["policyVersion"], "expires": int(min(details["expires"], entry["expires"])), "verification": {**verification, "context": {**verification["context"], **required}, "allowedAttributes": list(dict.fromkeys([*verification["allowedAttributes"], *required]))}}
