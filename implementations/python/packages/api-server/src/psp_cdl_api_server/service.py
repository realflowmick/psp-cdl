# SPDX-License-Identifier: Apache-2.0
"""Reusable host-authenticated security services; no implicit authority or persistence."""
import math
import re
from typing import Protocol
from psp_cdl_core import PspError, canonical_json, parse_markup, section_to_envelope, validate_json
from psp_cdl_core.crypto import verify_envelope
from psp_cdl_cdl import evaluate_batch

SERVICE_PROFILE = "PSP-SERVICE-0.1"
MAX_REQUEST_BYTES = 1_048_576

class ServiceHost(Protocol):
    def authenticate(self, token: str) -> dict | None: ...
    def resolve(self, principal: dict, operation_id: str) -> dict | None: ...
    def now(self) -> float: ...

class ServiceError(ValueError):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status

def identifier(value):
    return type(value) is str and len(value)<=128 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*",value) is not None

def scope_for(operation):
    return "security:verify" if operation=="verify" else "policy:evaluate"

def request_object(value, fields):
    try:
        value=validate_json(value)
        if len(canonical_json(value).encode("utf-8"))>MAX_REQUEST_BYTES:
            raise ServiceError("REQUEST_TOO_LARGE",413)
    except PspError as exc:
        raise ServiceError("INVALID_REQUEST",400) from exc
    if type(value) is not dict or set(value)!=set(fields) or not identifier(value.get("operation_id")):
        raise ServiceError("INVALID_REQUEST",400)
    return value

class SecurityService:
    def __init__(self, host: ServiceHost):
        self.host=host

    def authenticate(self, token):
        if type(token) is not str or not 1<=len(token)<=4096 or re.search(r"[^\x21-\x7e]",token):
            raise ServiceError("UNAUTHENTICATED",401)
        try:
            principal=validate_json(self.host.authenticate(token))
        except Exception as exc:
            raise ServiceError("INTERNAL_ERROR",500) from exc
        if principal is None:
            raise ServiceError("UNAUTHENTICATED",401)
        if type(principal) is not dict or not identifier(principal.get("tenantId")) or not identifier(principal.get("subjectId")) or type(principal.get("scopes")) is not list or any(type(s) is not str for s in principal["scopes"]):
            raise ServiceError("INTERNAL_ERROR",500)
        return principal

    def invoke(self, operation, value, token, expected_identity=None):
        principal=self.authenticate(token)
        if expected_identity is not None and (principal["tenantId"]!=expected_identity["tenantId"] or principal["subjectId"]!=expected_identity["subjectId"]):
            raise ServiceError("FORBIDDEN",403)
        if operation not in ("verify","evaluate"):
            raise ServiceError("UNSUPPORTED_OPERATION",404)
        if scope_for(operation) not in principal["scopes"]:
            raise ServiceError("FORBIDDEN",403)
        value=request_object(value,["operation_id","sections"] if operation=="verify" else ["operation_id"])
        sections=value.get("sections",[])
        if type(sections) is not list or len(sections)>32 or (operation=="verify" and not sections):
            raise ServiceError("INVALID_REQUEST",400)
        ids=set()
        for section in sections:
            if type(section) is not dict or set(section)!={"id","content"} or not identifier(section["id"]) or type(section["content"]) is not str or section["id"] in ids:
                raise ServiceError("INVALID_REQUEST",400)
            ids.add(section["id"])
        try:
            snapshot=self.host.resolve(principal,value["operation_id"])
        except Exception as exc:
            raise ServiceError("INTERNAL_ERROR",500) from exc
        if not snapshot or snapshot.get("tenantId")!=principal["tenantId"] or snapshot.get("subjectId")!=principal["subjectId"] or snapshot.get("operationId")!=value["operation_id"]:
            raise ServiceError("NOT_FOUND",404)
        now=self.host.now()
        if type(now) not in (int,float) or abs(now)>9_007_199_254_740_991 or not math.isfinite(now) or type(snapshot.get("expires")) is not int or not 0<=snapshot["expires"]<=9_007_199_254_740_991 or not identifier(snapshot.get("policyVersion")):
            raise ServiceError("INTERNAL_ERROR",500)
        if now>=snapshot["expires"]:
            raise ServiceError("STALE_OPERATION",409)
        common={"profile":SERVICE_PROFILE,"operation_id":value["operation_id"],"policy_version":snapshot["policyVersion"]}
        if operation=="evaluate":
            return {**common,**evaluate_batch(snapshot.get("resources"))}
        policy=snapshot.get("verification")
        required={"tenant-id":principal["tenantId"],"operation-id":snapshot["operationId"],"policy-version":snapshot["policyVersion"]}
        if type(policy) is not dict or type(policy.get("context")) is not dict or any(policy["context"].get(k)!=v for k,v in required.items()) or type(policy.get("keys")) is not list or any(k.get("allowUnscoped") is not False for k in policy["keys"]):
            raise ServiceError("INTERNAL_ERROR",500)
        results=[]
        for section in sections:
            try:
                document=parse_markup(section["content"])
                if len(document["children"])!=1 or document["children"][0]["kind"]!="section":
                    raise PspError("INVALID_SECTION")
                envelope=verify_envelope(section_to_envelope(document["children"][0]),{**policy,"now":now})
                signature=envelope["signature"]
                results.append({"id":section["id"],"valid":True,"signature_algorithm":signature["algorithm"],"trust_level":signature.get("trustLevel",2),"priority":signature.get("priority",50),"expires":signature["expires"]})
            except PspError as exc:
                results.append({"id":section["id"],"valid":False,"error":exc.code})
        valid=sum(r["valid"] for r in results)
        return {**common,"results":results,"summary":{"total":len(results),"valid":valid,"invalid":len(results)-valid}}
