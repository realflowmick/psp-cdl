# SPDX-License-Identifier: Apache-2.0
"""Shared pinned discovery and buffered result contract across transports."""
import re
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_api_server.persistence import bounded
from psp_cdl_mcp_server import MCP_VERSION
from psp_cdl_mcp_server.revision import REVISION_PROFILE, REVISION_KEY, valid_catalog_revision
from psp_cdl_api_server.service import identifier
from .dispatch import binding_digest

class PeerError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def json_copy(value):
    try: return bounded(value)
    except Exception: raise PeerError("INVALID_PEER_DATA") from None

class PinnedMcpClient:
    @property
    def catalog_digest(self): return self._fingerprint

    @property
    def catalog_snapshot(self): return json_copy({"tools":self._catalog,"revision":self._revision,"approvalDigest":self._fingerprint})

    def _digest(self,view): return binding_digest(view if self._required_revision else view["tools"])

    def _initialize(self, info, profile=None):
        self._required_revision=profile==REVISION_PROFILE
        init = self._request("initialize", {"protocolVersion":MCP_VERSION, "capabilities":{"experimental":{REVISION_KEY:{"profile":REVISION_PROFILE}}} if self._required_revision else {}, "clientInfo":{"name":"psp-cdl-mcpproxy", "version":"0.1.0"}})
        if type(init) is not dict or init.get("protocolVersion") != MCP_VERSION or type(init.get("serverInfo")) is not dict or any(init["serverInfo"].get(k) != info[k] for k in ("name", "version")) or type(init.get("capabilities")) is not dict or type(init["capabilities"].get("tools")) is not dict:
            raise PeerError("INVALID_INITIALIZATION")
        experimental=init["capabilities"].get("experimental")
        if self._required_revision and (type(experimental) is not dict or experimental.get(REVISION_KEY)!={"profile":REVISION_PROFILE}): raise PeerError("REVISION_UNSUPPORTED")
        self._notify("notifications/initialized", {})
        view=self._discover()
        self._catalog,self._revision=view["tools"],view["revision"]
        self._fingerprint=self._digest(view)

    def _discover(self, cancelled=lambda:False):
        result = self._request("tools/list", {}, cancelled)
        if type(result) is not dict or set(result) != ({"tools","_meta"} if self._required_revision else {"tools"}) or type(result["tools"]) is not list or len(result["tools"]) > 1024: raise PeerError("INVALID_DISCOVERY")
        seen = set()
        for t in result["tools"]:
            if type(t) is not dict or type(t.get("name")) is not str or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", t["name"]) or t["name"] in seen or type(t.get("inputSchema")) is not dict or type(t.get("outputSchema")) is not dict: raise PeerError("INVALID_DISCOVERY")
            seen.add(t["name"])
        tools=json_copy(sorted(result["tools"],key=lambda t:t["name"]))
        revision=None
        if self._required_revision:
            meta=result.get("_meta")
            r=meta.get(REVISION_KEY) if type(meta) is dict else None
            if type(meta) is not dict or set(meta)!={REVISION_KEY} or not valid_catalog_revision(r) or r["catalogDigest"]!=binding_digest(tools): raise PeerError("INVALID_REVISION_DATA")
            for t in tools:
                m=t.get("_meta")
                if type(m) is not dict or type(m.get(REVISION_KEY)) is not dict or set(m[REVISION_KEY])!={"toolRevision"} or not identifier(m[REVISION_KEY]["toolRevision"]): raise PeerError("INVALID_REVISION_DATA")
            revision=json_copy(r)
        return {"tools":tools,"revision":revision}

    def registrations(self, server, approvals, now, approved_catalog_digest=None):
        if self._required_revision and approved_catalog_digest!=self._fingerprint: raise PeerError("CATALOG_NOT_APPROVED")
        approvals = json_copy(approvals)
        if type(approvals) is not list or not callable(now): raise PeerError("INVALID_CONFIGURATION")
        result, seen = [], set()
        for a in approvals:
            t = next((t for t in self._catalog if t["name"] == a.get("name")), None)
            if t is None or a["name"] in seen or any(canonical_json(t[k]) != canonical_json(a.get(k)) for k in ("inputSchema", "outputSchema")): raise PeerError("DISCOVERY_MISMATCH")
            if self._required_revision and a["revision"]!=t["_meta"][REVISION_KEY]["toolRevision"]: raise PeerError("DISCOVERY_MISMATCH")
            seen.add(a["name"])
            def invoke(args, options, name=a["name"], tool_revision=a["revision"]):
                cancelled = lambda:options["cancelled"]() or now() >= options["deadline"]
                try:
                    if self._digest(self._discover(cancelled)) != self._fingerprint: raise PeerError("DISCOVERY_CHANGED")
                    pre={**self._revision,"toolRevision":tool_revision,"inputDigest":binding_digest(args)} if self._required_revision else None
                    response = self._request("tools/call", {"name":name, "arguments":args,**({"_meta":{REVISION_KEY:pre}} if pre else {})}, cancelled)
                    if type(response) is not dict or set(response)-{"content","structuredContent","isError","_meta"} or ("isError" in response and response["isError"] is not False) or type(response.get("structuredContent")) is not dict or type(response.get("content")) is not list or len(response["content"]) > 1: raise PeerError("INVALID_TOOL_RESPONSE")
                    if pre and (type(response.get("_meta")) is not dict or canonical_json(response["_meta"].get(REVISION_KEY))!=canonical_json(pre)): raise PeerError("INVALID_REVISION_RECEIPT")
                    for block in response["content"]:
                        if type(block) is not dict or set(block) != {"type","text"} or block["type"] != "text" or type(block["text"]) is not str or canonical_json(parse_json(block["text"])) != canonical_json(response["structuredContent"]): raise PeerError("INVALID_TOOL_RESPONSE")
                    if self._digest(self._discover(cancelled)) != self._fingerprint: raise PeerError("DISCOVERY_CHANGED")
                    return json_copy(response["structuredContent"])
                except Exception:
                    self.close()
                    raise
            result.append({**a, "server":server, "invoke":invoke})
        return result
