# SPDX-License-Identifier: Apache-2.0
"""Opt-in authenticated workflows; authority and checkpoint credentials stay in the host."""
import re
from psp_cdl_core import validate_json, canonical_json
from .persistence import StoreError, integer
from .service import SecurityService, ServiceError, identifier, scope_for, MAX_REQUEST_BYTES

WORKFLOW_SERVICE_PROFILE = "PSP-WORKFLOW-SERVICE-0.1"
WORKFLOW_FIELDS = {
    "createSession": ["requestId", "nodeId", "nodeVersion", "expiresAt", "state"],
    "getSession": ["sessionId"],
    "updateSession": ["requestId", "sessionId", "expectedVersion", "nodeId", "nodeVersion", "status", "state"],
    "getNode": ["nodeId", "nodeVersion"],
    "createCheckpoint": ["requestId", "sessionId", "expectedVersion", "expiresAt"],
    "resumeCheckpoint": ["requestId", "checkpointId", "state"],
}


def workflow_error(error):
    if isinstance(error, ServiceError):
        return error
    if isinstance(error, StoreError):
        code = error.code
        if code == "NOT_FOUND": status = 404
        elif code in ("AUTHORIZATION_DENIED", "PERSISTENCE_DENIED", "INVALID_TOKEN"): status = 403
        elif code in ("INVALID_COMMAND", "INVALID_STATE", "INVALID_EXPIRY"): status = 400
        elif code == "STORE_BUSY": status = 503
        elif code in ("STATE_CONFLICT", "NODE_CONFLICT", "IDEMPOTENCY_CONFLICT", "INVALID_TRANSITION", "CHECKPOINT_CONSUMED", "EXPIRED", "CHECKPOINT_KEY_CHANGED", "VERSION_EXHAUSTED"): status = 409
        else: status = 500
        return ServiceError("INTERNAL_ERROR" if status == 500 else code, status)
    return ServiceError("INTERNAL_ERROR", 500)


def request(operation, value):
    try:
        value = validate_json(value)
    except Exception:
        raise ServiceError("INVALID_REQUEST", 400) from None
    if len(canonical_json(value).encode("utf-8")) > MAX_REQUEST_BYTES:
        raise ServiceError("REQUEST_TOO_LARGE", 413)
    if type(value) is not dict or set(value) != set(WORKFLOW_FIELDS[operation]):
        raise ServiceError("INVALID_REQUEST", 400)
    for name in ("requestId", "nodeId", "nodeVersion"):
        if name in value and not identifier(value[name]):
            raise ServiceError("INVALID_REQUEST", 400)
    for name in ("sessionId", "checkpointId"):
        if name in value and (type(value[name]) is not str or re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", value[name]) is None):
            raise ServiceError("INVALID_REQUEST", 400)
    for name in ("expectedVersion", "expiresAt"):
        if name in value and (not integer(value[name]) or value[name] <= 0):
            raise ServiceError("INVALID_REQUEST", 400)
    if ("state" in value and type(value["state"]) is not dict) or ("status" in value and value["status"] not in ("running", "completed")):
        raise ServiceError("INVALID_REQUEST", 400)
    return value


class WorkflowService(SecurityService):
    operations = (*SecurityService.operations, *WORKFLOW_FIELDS)

    def __init__(self, store, host):
        super().__init__(host)
        if any(not callable(getattr(host, name, None)) for name in ("authenticate", "resolve", "now", "policy_version", "authorize", "present", "deliver_checkpoint", "resume_token")):
            raise ServiceError("INVALID_CONFIGURATION", 500)
        self.store = store

    def invoke(self, operation, value, token, expected_identity=None):
        if operation in ("verify", "evaluate"):
            return super().invoke(operation, value, token, expected_identity)
        try:
            principal = self.authenticate(token)

            def recheck():
                live = self.authenticate(token)
                if any(live[k] != principal[k] for k in ("tenantId", "subjectId")) or scope_for(operation) not in live["scopes"]:
                    raise ServiceError("FORBIDDEN", 403)
                return live

            if expected_identity is not None and any(principal[k] != expected_identity[k] for k in ("tenantId", "subjectId")):
                raise ServiceError("FORBIDDEN", 403)
            if operation not in WORKFLOW_FIELDS:
                raise ServiceError("UNSUPPORTED_OPERATION", 404)
            if scope_for(operation) not in principal["scopes"]:
                raise ServiceError("FORBIDDEN", 403)
            value = request(operation, value)
            command = {"action": operation, **value}
            if operation in ("createSession", "updateSession"):
                command["policyVersion"] = self.host.policy_version(validate_json(principal))
                if not identifier(command["policyVersion"]):
                    raise ServiceError("INTERNAL_ERROR", 500)
            if operation == "resumeCheckpoint":
                command["resumeToken"] = self.host.resume_token(validate_json(principal), value["checkpointId"])
                if type(command["resumeToken"]) is not str:
                    raise ServiceError("FORBIDDEN", 403)

            def guard(context):
                live = recheck()
                if "policyVersion" in command and self.host.policy_version(validate_json(live)) != command["policyVersion"]:
                    return False
                if self.host.authorize(validate_json(live), context) is not True:
                    return False
                final = recheck()
                required_policy = command.get("policyVersion")
                if required_policy is None and not context["replay"] and operation in ("createCheckpoint", "resumeCheckpoint"):
                    required_policy = context["current"]["policyVersion"]
                return required_policy is None or self.host.policy_version(validate_json(final)) == required_policy

            result = self.store.execute({k: principal[k] for k in ("tenantId", "subjectId")}, command, guard)
            live = recheck()
            if operation == "createCheckpoint":
                try:
                    self.host.deliver_checkpoint(validate_json(live), validate_json(result))
                except Exception:
                    raise ServiceError("CHECKPOINT_DELIVERY_FAILED", 503) from None
                return {"profile": WORKFLOW_SERVICE_PROFILE, "result": {k: result[k] for k in ("checkpointId", "sessionId", "sessionVersion", "expiresAt")}}
            data = result["definition"] if operation == "getNode" else result["state"]
            view = validate_json(self.host.present(validate_json(live), operation, validate_json(data)))
            if type(view) is not dict:
                raise ServiceError("INTERNAL_ERROR", 500)
            fields = ("nodeId", "nodeVersion") if operation == "getNode" else ("sessionId", "version", "status")
            output = {**{k: result[k] for k in fields}, "view": view}
            if len(canonical_json(output).encode("utf-8")) > MAX_REQUEST_BYTES:
                raise ServiceError("RESPONSE_TOO_LARGE", 500)
            recheck()
            return {"profile": WORKFLOW_SERVICE_PROFILE, "result": output}
        except Exception as exc:
            raise workflow_error(exc) from None
