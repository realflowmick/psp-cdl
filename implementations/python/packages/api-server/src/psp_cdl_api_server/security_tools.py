# SPDX-License-Identifier: Apache-2.0
"""Buffered, opt-in security tools; keys and authority remain host-owned."""
import base64
import hashlib
import re
from copy import deepcopy
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psp_cdl_core import PspError, canonical_json, parse_markup, section_to_envelope, validate_json
from psp_cdl_core.crypto import verify_envelope
from psp_cdl_cdl import evaluate_batch
from .service import SecurityService, ServiceError, identifier, request_object, scope_for, MAX_REQUEST_BYTES
from .persistence import integer

SECURITY_TOOLS_PROFILE = "PSP-SECURITY-TOOLS-0.1"
MAX_PLAINTEXT_BYTES = 65_536
ENCRYPTION_FIELDS = ("encrypted", "encryption-algorithm", "encryption-key-id", "nonce", "tag")


class ItemError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def decode_base64(value, length=None):
    if type(value) is not str or len(value) > 4*((MAX_PLAINTEXT_BYTES+2)//3) or len(value)%4 or re.fullmatch(r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?", value) is None:
        raise ItemError("INVALID_ENCRYPTION")
    raw = base64.b64decode(value, validate=True)
    if base64.b64encode(raw).decode() != value or length is not None and len(raw) != length:
        raise ItemError("INVALID_ENCRYPTION")
    return raw


def scan(source):
    if type(source) is not str:
        raise ServiceError("INVALID_REQUEST",400)
    doc, sections = parse_markup(source), []
    def visit(section):
        sections.append(section)
        if len(sections)>32:
            raise ServiceError("SECTION_LIMIT",413)
        for child in section["children"]:
            if child["kind"]=="section":visit(child)
    for child in doc["children"]:
        if child["kind"]=="section":visit(child)
    return sections, any(n["kind"]=="text" and re.search(r"[^\t\r\n ]",n["value"]) for n in doc["children"])


def envelope(section):
    if any(n["kind"]=="section" for n in section["children"]):
        raise ItemError("UNSUPPORTED_NESTING")
    if "signature" not in section["attributes"]:
        raise ItemError("UNSUPPORTED_ENCRYPTION_ORDER" if section["attributes"].get("encrypted")=="true" else "UNSIGNED_SECTION")
    if section["attributes"].get("type")=="user":raise ItemError("UNSUPPORTED_SECTION_TYPE")
    return section_to_envelope(section)


def encrypted(e):
    return any(k in e["signature"].get("attributes",{}) for k in ENCRYPTION_FIELDS) or type(e["data"]) is dict and any(k in e["data"] for k in ("encryption","encryptedData"))


def parameters(e):
    attrs=e["signature"].get("attributes",{});mode=attrs.get("decrypt","upfront")
    if e["signature"]["sectionType"] not in ("system","context"):
        raise ItemError("UNSUPPORTED_SECTION_TYPE")
    if mode not in ("upfront","node","on-request"):
        raise ItemError("UNSUPPORTED_DECRYPT_MODE")
    if e["signature"]["contentType"]=="text":
        if attrs.get("encrypted")!="true" or any(k not in attrs for k in ENCRYPTION_FIELDS):
            raise ItemError("INVALID_ENCRYPTION")
        algorithm,key_id,nonce,tag,ciphertext=attrs["encryption-algorithm"],attrs["encryption-key-id"],attrs["nonce"],attrs["tag"],e["data"]
    else:
        if any(k in attrs for k in ENCRYPTION_FIELDS) or type(e["data"]) is not dict or set(e["data"])!={"encryption","encryptedData"} or type(e["data"]["encryption"]) is not dict or set(e["data"]["encryption"])!={"algorithm","keyId","nonce","tag"}:
            raise ItemError("INVALID_ENCRYPTION")
        p=e["data"]["encryption"]
        algorithm,key_id,nonce,tag,ciphertext=p["algorithm"],p["keyId"],p["nonce"],p["tag"],e["data"]["encryptedData"]
    if algorithm!="aes-256-gcm":raise ItemError("UNSUPPORTED_ENCRYPTION_ALGORITHM")
    if not identifier(key_id):raise ItemError("INVALID_ENCRYPTION")
    return {"keyId":key_id,"mode":mode,"nonce":decode_base64(nonce,12),"tag":decode_base64(tag,16),"ciphertext":decode_base64(ciphertext)}


def allowed(resources):
    return type(resources) is list and len(resources)>0 and evaluate_batch(resources)["decision"]=="allow"


class SecurityToolsService(SecurityService):
    def __init__(self,host,workflow=None):
        super().__init__(host)
        if any(not callable(getattr(host,k,None)) for k in ("resolve_decryption","plaintext_policy","authenticate","resolve","now")):
            raise ServiceError("INVALID_CONFIGURATION",500)
        self.workflow=workflow
        self.operations=("verify","evaluate","scan","decrypt","process",*(o for o in workflow.operations if o not in ("verify","evaluate"))) if workflow else ("verify","evaluate","scan","decrypt","process")

    def invoke(self,operation,value,token,expected_identity=None):
        if operation not in ("scan","decrypt","process"):
            if operation in ("verify","evaluate"):
                return super().invoke(operation,value,token,expected_identity)
            if self.workflow:
                p=self.authenticate(token)
                if expected_identity is not None and any(expected_identity[k]!=p[k] for k in ("tenantId","subjectId")):
                    raise ServiceError("FORBIDDEN",403)
                if scope_for(operation) not in p["scopes"]:
                    raise ServiceError("FORBIDDEN",403)
                return self.workflow.invoke(operation,value,token,p)
            raise ServiceError("UNSUPPORTED_OPERATION",404)
        try:
            return self._invoke(operation,value,token,expected_identity)
        except ServiceError:
            raise
        except PspError as exc:
            raise ServiceError(exc.code,400) from None
        except Exception:
            raise ServiceError("INTERNAL_ERROR",500) from None

    def _invoke(self,operation,value,token,expected_identity):
        principal=self.authenticate(token)
        if expected_identity is not None and any(expected_identity[k]!=principal[k] for k in ("tenantId","subjectId")):
            raise ServiceError("FORBIDDEN",403)
        if scope_for(operation) not in principal["scopes"]:raise ServiceError("FORBIDDEN",403)
        value=request_object(value,["operation_id","sections"] if operation=="decrypt" else ["operation_id","raw_text"])

        def fresh(version=None):
            live=self.authenticate(token)
            if any(live[k]!=principal[k] for k in ("tenantId","subjectId")) or scope_for(operation) not in live["scopes"]:
                raise ServiceError("FORBIDDEN",403)
            try:s=deepcopy(self.host.resolve(deepcopy(principal),value["operation_id"]))
            except Exception:raise ServiceError("INTERNAL_ERROR",500) from None
            if s is None or any(s.get(k)!=principal[k] for k in ("tenantId","subjectId")) or s.get("operationId")!=value["operation_id"]:
                raise ServiceError("NOT_FOUND",404)
            now=self.host.now()
            if type(now) not in (int,float) or not 0<=now<=9007199254740991 or not integer(s.get("expires")) or not identifier(s.get("policyVersion")):
                raise ServiceError("INTERNAL_ERROR",500)
            if now>=s["expires"] or version is not None and version!=s["policyVersion"]:
                raise ServiceError("STALE_OPERATION",409)
            required={"tenant-id":principal["tenantId"],"operation-id":s["operationId"],"policy-version":s["policyVersion"]}
            p=s.get("verification")
            if type(p) is not dict or type(p.get("context")) is not dict or any(p["context"].get(k)!=v for k,v in required.items()) or type(p.get("keys")) is not list or any(k.get("allowUnscoped") is not False for k in p["keys"]):
                raise ServiceError("INTERNAL_ERROR",500)
            if not allowed(s.get("resources")):raise ServiceError("POLICY_DENIED",403)
            return {**s,"verification":{**p,"now":now}}

        snapshot=fresh();version=snapshot["policyVersion"]
        def grant(context):
            try:g=deepcopy(self.host.resolve_decryption(deepcopy(principal),validate_json(context)))
            except Exception:raise ServiceError("INTERNAL_ERROR",500) from None
            target=0 if context["sectionType"]=="system" else 1
            if type(g) is not dict or any(g.get(k)!=principal[k] for k in ("tenantId","subjectId")) or any(g.get(k)!=v for k,v in context.items()) or g.get("algorithm")!="aes-256-gcm" or g.get("status")!="active" or type(g.get("material")) is not bytes or len(g["material"])!=32 or not integer(g.get("expires")) or self.host.now()>=g["expires"] or g.get("applicationOnly") is not True or not integer(g.get("requestingZone")) or not 0<=g["requestingZone"]<=2 or g["requestingZone"]>target or type(g.get("sectionTypes")) is not list or context["sectionType"] not in g["sectionTypes"] or type(g.get("modes")) is not list or context["mode"] not in g["modes"]:
                raise ItemError("DECRYPTION_DENIED")
            return g

        untrusted_text=False
        if operation=="decrypt":
            sections=value["sections"]
            if type(sections) is not list or not 1<=len(sections)<=32:raise ServiceError("INVALID_REQUEST",400)
            ids=set();items=[]
            for s in sections:
                if type(s) is not dict or set(s)!={"content","id"} or not identifier(s.get("id")) or type(s.get("content")) is not str or s["id"] in ids:raise ServiceError("INVALID_REQUEST",400)
                ids.add(s["id"]);items.append(s)
        else:
            sections,untrusted_text=scan(value["raw_text"])
            if operation=="process" and (untrusted_text or not sections):raise ServiceError("UNSUPPORTED_UNTAGGED_INPUT",400)
            items=[{"id":"section-"+str(i),"section":s} for i,s in enumerate(sections)]
        results,prepared=[],[]
        for item in items:
            try:
                section=item.get("section")
                if section is None:
                    doc=parse_markup(item["content"])
                    if len(doc["children"])!=1 or doc["children"][0]["kind"]!="section":raise ItemError("INVALID_SECTION")
                    section=doc["children"][0]
                e=verify_envelope(envelope(section),snapshot["verification"]);is_encrypted=encrypted(e)
                if operation=="scan":
                    output={"id":item["id"],"ok":True,"encrypted":is_encrypted,"sectionType":e["signature"]["sectionType"]}
                    results.append(output);prepared.append({"output":output,"envelope":e});continue
                sig=e["signature"]
                provenance={"profile":SECURITY_TOOLS_PROFILE,"envelopeDigest":hashlib.sha256(canonical_json(e).encode()).hexdigest(),"signatureAlgorithm":sig["algorithm"],"signingKeyId":sig.get("kid",sig.get("secretId")),"trustLevel":sig.get("trustLevel",2),"transformation":"decrypted" if is_encrypted else "verified"}
                candidate={"output":{"id":item["id"],"ok":True,"encrypted":is_encrypted,"sectionType":sig["sectionType"],"provenance":provenance},"envelope":e}
                if is_encrypted:
                    p=parameters(e)
                    context={"operationId":snapshot["operationId"],"policyVersion":version,"envelopeDigest":provenance["envelopeDigest"],"keyId":p["keyId"],"sectionType":sig["sectionType"],"mode":p["mode"]}
                    g=grant(context);candidate.update(context=context,grant=g)
                    before_decrypt=fresh(version);verify_envelope(e,before_decrypt["verification"])
                    if before_decrypt["verification"]["now"]>=g["expires"]:raise ItemError("DECRYPTION_DENIED")
                    try:raw=AESGCM(g["material"]).decrypt(p["nonce"],p["ciphertext"]+p["tag"],None)
                    except Exception:raise ItemError("DECRYPTION_FAILED") from None
                    if len(raw)>MAX_PLAINTEXT_BYTES:raise ItemError("PLAINTEXT_LIMIT")
                    try:content=raw.decode("utf-8",errors="strict")
                    except UnicodeError:raise ItemError("INVALID_PLAINTEXT") from None
                else:
                    if operation=="decrypt":raise ItemError("NOT_ENCRYPTED")
                    if type(e["data"]) is not str or sig["contentType"]!="text":raise ItemError("UNSUPPORTED_PLAINTEXT")
                    content=e["data"]
                if len(content.encode("utf-8"))>MAX_PLAINTEXT_BYTES:raise ItemError("PLAINTEXT_LIMIT")
                candidate["output"]["content"]=content;prepared.append(candidate);results.append(candidate["output"])
            except (PspError,ItemError) as exc:
                results.append({"id":item["id"],"ok":False,"error":exc.code})

        def reject(p,code):
            p["output"].pop("content",None);p["output"].pop("provenance",None);p["output"].update(ok=False,error=code)

        if operation!="scan" and prepared and (operation!="process" or len(prepared)==len(results)):
            fresh(version)
            try:release=validate_json(self.host.plaintext_policy(deepcopy(principal),{"operationId":snapshot["operationId"],"policyVersion":version,"operation":operation,"outputs":validate_json([p["output"] for p in prepared])}))
            except Exception:raise ServiceError("INTERNAL_ERROR",500) from None
            permit=type(release) is dict and release.get("allow") is True and release.get("complete") is True and allowed(release.get("resources"))
            for p in prepared:
                try:
                    if not permit:raise ItemError("PLAINTEXT_DENIED")
                    if "context" in p:
                        latest=grant(p["context"])
                        if latest["material"]!=p["grant"]["material"]:raise ItemError("DECRYPTION_DENIED")
                        p["grant"]=latest
                except ItemError as exc:reject(p,exc.code)
        final=fresh(version)
        for p in prepared:
            if p["output"]["ok"] is True:
                try:
                    verify_envelope(p["envelope"],final["verification"])
                    if "grant" in p and final["verification"]["now"]>=p["grant"]["expires"]:raise ItemError("DECRYPTION_DENIED")
                except (PspError,ItemError) as exc:reject(p,exc.code)
        if operation=="process" and any(r["ok"] is not True for r in results):
            for r in results:
                if r["ok"] is True:reject({"output":r},"BATCH_REJECTED")
        successful=sum(r["ok"] is True for r in results)
        output={"profile":SECURITY_TOOLS_PROFILE,"operation_id":value["operation_id"],"policy_version":version,"success":len(results)>0 and successful==len(results),"results":results,"summary":{"total":len(results),"successful":successful,"failed":len(results)-successful},**({"untrustedText":bool(untrusted_text)} if operation!="decrypt" else {})}
        if len(canonical_json(output).encode("utf-8"))>MAX_REQUEST_BYTES:raise ServiceError("RESPONSE_TOO_LARGE",500)
        return output
