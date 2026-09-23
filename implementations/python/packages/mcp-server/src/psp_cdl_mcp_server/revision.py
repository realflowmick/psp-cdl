# SPDX-License-Identifier: Apache-2.0
"""Opt-in atomic callback selection and catalog publication, within one process."""
import hashlib
import re
import threading
import uuid
from types import SimpleNamespace
from psp_cdl_core import canonical_json
from psp_cdl_api_server import SecurityService, ServiceError
from psp_cdl_api_server.service import identifier
from psp_cdl_api_server.persistence import bounded, integer

REVISION_PROFILE="PSP-MCP-REVISION-0.1"
REVISION_KEY="psp-cdl.org/revision"
def fail(code,status=409): raise ServiceError(code,status)
def clone(value):
    try: return bounded(value)
    except Exception: fail("INVALID_REVISION_DATA",400)
def revision_digest(value): return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
def identity(p): return canonical_json([p["tenantId"],p["subjectId"]])
def valid_catalog_revision(v):
    return type(v) is dict and set(v)=={"profile","epoch","generation","catalogDigest"} and v["profile"]==REVISION_PROFILE and identifier(v["epoch"]) and integer(v["generation"]) and v["generation"]>0 and type(v["catalogDigest"]) is str and re.fullmatch(r"[a-f0-9]{64}",v["catalogDigest"]) is not None

class RevisionedToolRegistry:
    def __init__(self,host,tools,epoch=None):
        self._epoch=str(uuid.uuid4()) if epoch is None else epoch
        if not identifier(self._epoch) or any(not callable(getattr(host,k,None)) for k in ("authenticate","authorize")): fail("INVALID_CONFIGURATION",400)
        self._host,self._auth=host,SecurityService(host)
        self._lock,self._active,self._generation=threading.Lock(),0,1
        self._state=self._prepare(tools)

    def _prepare(self,tools):
        if type(tools) is not list or len(tools)>1024: fail("INVALID_CONFIGURATION",400)
        handlers,catalog={},[]
        for tool in tools:
            if type(tool) is not dict: fail("INVALID_CONFIGURATION",400)
            invoke=tool.get("invoke")
            meta=clone({k:v for k,v in tool.items() if k!="invoke"})
            if set(meta)!={"name","revision","readOnly","inputSchema","outputSchema"} or type(meta["name"]) is not str or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}",meta["name"]) or not identifier(meta["revision"]) or meta["readOnly"] is not True or any(type(meta[k]) is not dict or meta[k].get("type")!="object" for k in ("inputSchema","outputSchema")) or not callable(invoke) or meta["name"] in handlers: fail("INVALID_CONFIGURATION",400)
            handlers[meta["name"]]=invoke
            catalog.append({"name":meta["name"],"inputSchema":meta["inputSchema"],"outputSchema":meta["outputSchema"],"_meta":{REVISION_KEY:{"toolRevision":meta["revision"]}}})
        catalog.sort(key=lambda t:t["name"])
        return {"handlers":handlers,"catalog":clone(catalog),"digest":revision_digest(catalog)}

    def _revision(self): return {"profile":REVISION_PROFILE,"epoch":self._epoch,"generation":self._generation,"catalogDigest":self._state["digest"]}
    @property
    def revision(self):
        with self._lock: return self._revision()

    def publish(self,expected,tools):
        with self._lock:
            if not valid_catalog_revision(expected) or canonical_json(expected)!=canonical_json(self._revision()): fail("REVISION_CONFLICT")
            if self._active: fail("REGISTRY_BUSY")
            if self._generation==9_007_199_254_740_991: fail("REVISION_EXHAUSTED")
            next_state=self._prepare(tools)
            self._state=next_state
            self._generation+=1
            return self._revision()

    def _authorized(self,token,expected,name,phase):
        p=self._auth.authenticate(token)
        if identity(p)!=identity(expected) or ("tools:list" if phase=="discover" else "tools:call") not in p["scopes"] or self._host.authorize(clone(p),name,phase) is not True: fail("FORBIDDEN",403)
        return p

    def service(self,cancelled=lambda:False):
        def check():
            if cancelled() is not False: fail("CANCELLED")
        def discover(token,p):
            self._authorized(token,p,None,"discover")
            check()
            with self._lock: return clone({"tools":self._state["catalog"],"_meta":{REVISION_KEY:self._revision()}})
        def call(name,args,token,p,raw):
            data,pre=clone(args),clone(raw)
            if type(data) is not dict or type(pre) is not dict or set(pre)!={"profile","epoch","generation","catalogDigest","toolRevision","inputDigest"}: fail("INVALID_PRECONDITION",400)
            principal=self._authorized(token,p,name,"invoke")
            check()
            with self._lock:
                tool=next((t for t in self._state["catalog"] if t["name"]==name),None)
                expected={**self._revision(),"toolRevision":tool["_meta"][REVISION_KEY]["toolRevision"] if tool else None,"inputDigest":revision_digest(data)}
                if tool is None or canonical_json(pre)!=canonical_json(expected): fail("REVISION_MISMATCH")
                invoke=self._state["handlers"][name]
                self._active+=1
            try:
                output=clone(invoke(data,{"principal":clone(principal),"cancelled":cancelled}))
                if type(output) is not dict: fail("INVALID_OUTPUT",500)
                check()
                self._authorized(token,p,name,"release")
                check()
                return clone({"data":output,"meta":{REVISION_KEY:pre}})
            finally:
                with self._lock: self._active-=1
        return SimpleNamespace(authenticate=self._auth.authenticate,discover=lambda *_:fail("REVISION_REQUIRED"),call_tool=lambda *_:fail("REVISION_REQUIRED"),revisions=SimpleNamespace(profile=REVISION_PROFILE,discover=discover,call_tool=call))
