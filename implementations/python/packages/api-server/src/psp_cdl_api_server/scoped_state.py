# SPDX-License-Identifier: Apache-2.0
import hashlib
from psp_cdl_core import canonical_json
from .service import identifier

SCOPED_PROFILE="PSP-LLM-SCOPED-0.1"
def exact(v,keys):return type(v) is dict and set(v)==set(keys.split(","))
def natural(v):return type(v) in (int,float) and 0<=v<=9007199254740991 and int(v)==v
def scoped_digest(v):return hashlib.sha256(canonical_json(v).encode("utf-8")).hexdigest()
def valid_digest(v):return type(v) is str and len(v)==64 and all(c in "0123456789abcdef" for c in v)
def valid_threat_policy(v):return exact(v,"id,version") and identifier(v["id"]) and identifier(v["version"])
def valid_scope(v):return exact(v,"id,systemDigest,threatPolicy,version") and identifier(v["id"]) and identifier(v["version"]) and valid_digest(v["systemDigest"]) and valid_threat_policy(v["threatPolicy"])
def valid_scoped_completion(v):
    return exact(v,"completedAt,policy,profile,requestId,retained,scope,threatState,turnCount,violationCount") and v["profile"]==SCOPED_PROFILE and v["policy"]=="scoped" and identifier(v["requestId"]) and natural(v["completedAt"]) and v["completedAt"]<=253402300799 and valid_scope(v["scope"]) and type(v["threatState"]) is dict and type(v["retained"]) is dict and natural(v["turnCount"]) and natural(v["violationCount"]) and v["violationCount"]<=v["turnCount"]
def valid_scoped_output(o):
    if not exact(o,"provenance,text") or type(o["text"]) is not str or not exact(o["provenance"],"outputDigest,profile,providerId,providerRevision,steps,trustLevel"):return False
    p=o["provenance"]
    return p["profile"]=="PSP-LLM-LOOP-0.1" and p["trustLevel"]==5 and identifier(p["providerId"]) and identifier(p["providerRevision"]) and natural(p["steps"]) and p["steps"]==1 and p["outputDigest"]==scoped_digest({"text":o["text"]})
