# SPDX-License-Identifier: Apache-2.0
"""Deterministic synthetic AES/signature fixtures and manually selected outcomes."""
import base64
import json
import sys
from copy import deepcopy
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psp_cdl_core import serialize_markup, envelope_to_section
from psp_cdl_core.crypto import sign_envelope

ROOT=Path(__file__).resolve().parents[1]
KEY=bytes(range(32));SIGN=bytes([17])*32
ATTRS={"tenant-id":"tenant-a","operation-id":"op-1","policy-version":"policy-1"}
counter=0
def markup(data,attrs=None,section_type="context",content_type="text",bad_signature=False):
    e=sign_envelope(data,{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"test-sign","timestamp":900,"expires":1800,"version":"1.0.0","sectionType":section_type,"contentType":content_type,"attributes":{**ATTRS,**(attrs or {})}},SIGN)
    if bad_signature:e["signature"]["value"]=("A" if e["signature"]["value"][0]!="A" else "B")+e["signature"]["value"][1:]
    return serialize_markup({"kind":"document","children":[envelope_to_section(e)]})
def encrypted(text="SYNTHETIC PLAINTEXT 🧪",shape="text",attrs=None,section_type="context",edit=None,bad_signature=False):
    global counter
    counter+=1;nonce=counter.to_bytes(12,"big")
    raw=text if type(text) is bytes else text.encode()
    sealed=AESGCM(KEY).encrypt(nonce,raw,None)
    p={"algorithm":"aes-256-gcm","keyId":"test-aes","nonce":base64.b64encode(nonce).decode(),"tag":base64.b64encode(sealed[-16:]).decode(),"ciphertext":base64.b64encode(sealed[:-16]).decode()}
    if edit:p.update(edit)
    if shape=="json":return markup({"encryption":{k:p[k] for k in ("algorithm","keyId","nonce","tag")},"encryptedData":p["ciphertext"]},attrs,section_type,"json",bad_signature)
    return markup(p["ciphertext"],{"encrypted":"true","encryption-algorithm":p["algorithm"],"encryption-key-id":p["keyId"],"nonce":p["nonce"],"tag":p["tag"],**(attrs or {})},section_type,bad_signature=bad_signature)
contents={
    "@text":encrypted(),"@json":encrypted(shape="json"),"@system":encrypted(section_type="system"),"@user":encrypted(section_type="user"),
    "@node":encrypted(attrs={"decrypt":"node"}),"@request":encrypted(attrs={"decrypt":"on-request"}),
    "@bad-signature":encrypted(bad_signature=True),"@bad-tag":encrypted(edit={"tag":base64.b64encode(bytes(16)).decode()}),
    "@nonce":encrypted(edit={"nonce":"AA=="}),"@encoding":encrypted(edit={"tag":"AAAAAAAAAAAAAAAAAAAAAB=="}),
    "@algorithm":encrypted(edit={"algorithm":"aes-256-cbc"}),"@mode":encrypted(attrs={"decrypt":"automatic"}),
    "@scope":encrypted(attrs={"tenant-id":"other"}),"@utf8":encrypted(text=b"\xff"),"@bom":encrypted(text="\ufeffsynthetic"),
    "@limit":encrypted(text="x"*65537),"@plain":markup("PUBLIC SYNTHETIC"),
    "@unsigned":"${psp type=user}untrusted${/psp}","@ste":"${psp type=context encrypted=true}AAAA${/psp}",
    "@malformed":"${psp type=context}unfinished", "@duplicate-attribute":"${psp type=context type=system /}",
}
contents["@nested"]='${psp type=node}'+contents["@plain"]+'${/psp}'
contents["@mixed-process"]=contents["@text"]+contents["@bad-signature"]
contents["@clean-process"]=contents["@text"]+contents["@plain"]
contents["@preamble"]="untrusted prefix "+contents["@text"]
cases=[]
def add(name,op="decrypt",content="@text",errors=None,status=200,flags=None,request=None,**expect):
    request=request or ({"operation_id":"op-1","sections":[{"id":"one","content":content}]} if op=="decrypt" else {"operation_id":"op-1","raw_text":content})
    cases.append({"id":name,"operation":op,"request":request,"flags":flags or {},"expect":{"status":status,**({"errors":errors} if errors is not None else {}),**expect}})
for name in ("text","json","system","node","request","bom"):
    add("clean-"+name,content="@"+name,errors=[None],keyCalls=2,releaseCalls=1,contents=["\ufeffsynthetic" if name=="bom" else "SYNTHETIC PLAINTEXT 🧪"])
for name,error in [("bad-signature","INVALID_SIGNATURE"),("bad-tag","DECRYPTION_FAILED"),("nonce","INVALID_ENCRYPTION"),("encoding","INVALID_ENCRYPTION"),("algorithm","UNSUPPORTED_ENCRYPTION_ALGORITHM"),("mode","UNSUPPORTED_DECRYPT_MODE"),("scope","SCOPE_MISMATCH"),("utf8","INVALID_PLAINTEXT"),("user","UNSUPPORTED_SECTION_TYPE"),("limit","PLAINTEXT_LIMIT"),("unsigned","UNSIGNED_SECTION"),("ste","UNSUPPORTED_ENCRYPTION_ORDER"),("plain","NOT_ENCRYPTED"),("duplicate-attribute","DUPLICATE_ATTRIBUTE")]:
    add(name,content="@"+name,errors=[error],releaseCalls=0,**({"keyCalls":0} if name not in ("bad-tag","utf8","limit") else {}))
for flag in ("missingKey","revokedKey","wrongOwnerGrant","wrongTenantGrant","wrongDigest","expiredGrant","zoneDenied","modeDenied","bootstrapDenied"):
    add(flag,flags={flag:True},errors=["DECRYPTION_DENIED"],releaseCalls=0)
add("wrong-key-material",flags={"wrongKey":True},errors=["DECRYPTION_FAILED"],releaseCalls=0)
for flag in ("denyRelease","incompleteRelease","truthyRelease","releasePolicyDenies"):
    add(flag,flags={flag:True},errors=["PLAINTEXT_DENIED"],keyCalls=1,releaseCalls=1)
add("detach-release-callback",flags={"mutateOutput":True},errors=[None],contents=["SYNTHETIC PLAINTEXT 🧪"])
add("revoked-at-release",flags={"revokeAtRelease":True},errors=["DECRYPTION_DENIED"])
add("signature-revoked-at-release",flags={"revokeSigningAtRelease":True},errors=["REVOKED_KEY"])
add("expired-at-release",flags={"expireAtRelease":True},status=409,error="STALE_OPERATION")
add("policy-changed-at-release",flags={"changePolicyAtRelease":True},status=409,error="STALE_OPERATION")
add("credential-revoked-at-release",flags={"revokeCredentialAtRelease":True},status=401,error="UNAUTHENTICATED")
add("host-error-sanitized",flags={"throwKey":True},status=500,error="INTERNAL_ERROR")
add("plaintext-policy-error-sanitized",flags={"throwRelease":True},status=500,error="INTERNAL_ERROR")
for token in ("other-owner","other-tenant"):
    add(token,flags={"token":token},status=404,error="NOT_FOUND",keyCalls=0)
add("missing-scope",flags={"token":"reader"},status=403,error="FORBIDDEN",keyCalls=0)
add("processing-policy-denies",flags={"policyDenies":True},status=403,error="POLICY_DENIED",keyCalls=0)
add("mixed-decrypt",request={"operation_id":"op-1","sections":[{"id":"one","content":"@text"},{"id":"two","content":"@bad-signature"}]},errors=[None,"INVALID_SIGNATURE"],contents=["SYNTHETIC PLAINTEXT 🧪",None])
add("process-clean",op="process",content="@clean-process",errors=[None,None],contents=["SYNTHETIC PLAINTEXT 🧪","PUBLIC SYNTHETIC"])
add("process-suppresses-all",op="process",content="@mixed-process",errors=["BATCH_REJECTED","INVALID_SIGNATURE"],contents=[None,None],releaseCalls=0)
add("process-nested",op="process",content="@nested",errors=["UNSUPPORTED_NESTING","BATCH_REJECTED"],releaseCalls=0)
add("process-preamble",op="process",content="@preamble",status=400,error="UNSUPPORTED_UNTAGGED_INPUT")
add("process-empty",op="process",request={"operation_id":"op-1","raw_text":" "},status=400,error="UNSUPPORTED_UNTAGGED_INPUT")
add("scan-clean",op="scan",errors=[None],contents=[None],keyCalls=0,releaseCalls=0)
add("scan-empty",op="scan",request={"operation_id":"op-1","raw_text":""},errors=[],success=False,keyCalls=0,releaseCalls=0)
add("scan-preamble",op="scan",content="@preamble",errors=[None],contents=[None],untrustedText=True,keyCalls=0)
add("scan-unsigned",op="scan",content="@unsigned",errors=["UNSIGNED_SECTION"],keyCalls=0)
add("scan-malformed",op="scan",content="@malformed",status=400,error="UNCLOSED_SECTION")
add("scan-bound",op="scan",request={"operation_id":"op-1","raw_text":"${psp type=user /}"*33},status=413,error="SECTION_LIMIT")
add("batch-bound",request={"operation_id":"op-1","sections":[{"id":"x"+str(i),"content":"@text"} for i in range(33)]},status=400,error="INVALID_REQUEST")
add("duplicate-id",request={"operation_id":"op-1","sections":[{"id":"same","content":"@text"}]*2},status=400,error="INVALID_REQUEST")
add("caller-zone-rejected",request={"operation_id":"op-1","sections":[{"id":"one","content":"@text"}],"requestingZone":0},status=400,error="INVALID_REQUEST")
add("request-byte-bound",op="scan",flags={"oversize":True},status=413,error="REQUEST_TOO_LARGE")
suite={"profile":"PSP-SECURITY-TOOLS-0.1","notice":"Public synthetic keys/nonces only. Never use for real data.","encryptionKeyHex":KEY.hex(),"signingKeyHex":SIGN.hex(),"contents":contents,"cases":cases}
path=ROOT/"conformance/vectors/services/security-tools-0.1.json";value=json.dumps(suite,ensure_ascii=False,indent=2)+"\n"
if sys.argv[1:]==["--check"]:assert path.read_bytes()==value.encode(),"Security vectors differ"
else:path.write_text(value,encoding="utf-8",newline="\n")
print(f"{len(cases)} synthetic security tool cases.")
