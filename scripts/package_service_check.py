# SPDX-License-Identifier: Apache-2.0
"""Executed in the isolated wheel consumer. Public synthetic keys only."""
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64
from psp_cdl_api_server.lifecycle import LifecycleStore
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.security_tools import SecurityToolsService
from psp_cdl_core.crypto import sign_envelope
from psp_cdl_core import serialize_markup, envelope_to_section

actor={"tenantId":"test","subjectId":"test"};key=bytes([7])*32
backend=SqliteBackend("lifecycle-wheel.sqlite","test",clock=lambda:1)
try:
    store=LifecycleStore(backend,resume_secret=key,authorize_persistence=lambda a,w:True,authorize_retention=lambda a,c:True)
    store.execute(actor,{"action":"putNode","nodeId":"entry","nodeVersion":"1","definition":{}})
    s=store.execute(actor,{"action":"createSession","requestId":"create","nodeId":"entry","nodeVersion":"1","policyVersion":"p1","expiresAt":9,"state":{}})
    store.lifecycle(actor,"cancelSession",{"requestId":"cancel","sessionId":s["sessionId"],"expectedVersion":1},lambda c:True)
    assert store.lifecycle(actor,"purgeSession",{"requestId":"purge","sessionId":s["sessionId"],"expectedVersion":2},lambda c:True)["more"] is False
finally:backend.close()
resource={"classes":[],"covenants":[],"capabilities":[],"checks":{},"parameters":{},"context":{}}
context={"tenant-id":"test","operation-id":"op","policy-version":"p1"};nonce=bytes([1])*12
sealed=AESGCM(key).encrypt(nonce,b"isolated synthetic",None)
e=sign_envelope(base64.b64encode(sealed[:-16]).decode(),{"algorithm":"hmac-sha256","signatureVersion":"2.0","secretId":"sign","timestamp":0,"expires":9,"version":"1.0.0","sectionType":"context","contentType":"text","attributes":{**context,"encrypted":"true","encryption-algorithm":"aes-256-gcm","encryption-key-id":"aes","nonce":base64.b64encode(nonce).decode(),"tag":base64.b64encode(sealed[-16:]).decode()}},key)
content=serialize_markup({"kind":"document","children":[envelope_to_section(e)]})
class Host:
    def now(self):return 1
    def authenticate(self,t):return {**actor,"scopes":["security:decrypt"]}
    def resolve(self,p,o):return {**actor,"operationId":"op","policyVersion":"p1","expires":9,"resources":[resource],"verification":{"context":context,"allowedAttributes":list(e["signature"]["attributes"]),"keys":[{"id":"sign","algorithm":"hmac-sha256","material":key,"status":"active","trustLevels":[2],"sectionTypes":["context"],"scope":{},"allowUnscoped":False}]}}
    def resolve_decryption(self,p,c):return {**actor,**c,"algorithm":"aes-256-gcm","material":key,"status":"active","expires":9,"requestingZone":0,"sectionTypes":["context"],"modes":["upfront"],"applicationOnly":True}
    def plaintext_policy(self,p,c):return {"allow":True,"complete":True,"resources":[resource]}
result=SecurityToolsService(Host()).invoke("decrypt",{"operation_id":"op","sections":[{"id":"one","content":content}]},"synthetic")
assert result["results"][0]["content"]=="isolated synthetic"
