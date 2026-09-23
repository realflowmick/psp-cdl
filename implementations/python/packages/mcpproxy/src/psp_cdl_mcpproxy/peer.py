# SPDX-License-Identifier: Apache-2.0
"""Shared pinned discovery and buffered result contract across transports."""
import re
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_api_server.persistence import bounded
from psp_cdl_mcp_server import MCP_VERSION
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

    def _initialize(self, info):
        init = self._request("initialize", {"protocolVersion":MCP_VERSION, "capabilities":{}, "clientInfo":{"name":"psp-cdl-mcpproxy", "version":"0.1.0"}})
        if type(init) is not dict or init.get("protocolVersion") != MCP_VERSION or type(init.get("serverInfo")) is not dict or any(init["serverInfo"].get(k) != info[k] for k in ("name", "version")) or type(init.get("capabilities")) is not dict or type(init["capabilities"].get("tools")) is not dict:
            raise PeerError("INVALID_INITIALIZATION")
        self._notify("notifications/initialized", {})
        self._catalog = self._discover()
        self._fingerprint = binding_digest(self._catalog)

    def _discover(self, cancelled=lambda:False):
        result = self._request("tools/list", {}, cancelled)
        if type(result) is not dict or set(result) != {"tools"} or type(result["tools"]) is not list or len(result["tools"]) > 1024: raise PeerError("INVALID_DISCOVERY")
        seen = set()
        for t in result["tools"]:
            if type(t) is not dict or type(t.get("name")) is not str or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", t["name"]) or t["name"] in seen or type(t.get("inputSchema")) is not dict or type(t.get("outputSchema")) is not dict: raise PeerError("INVALID_DISCOVERY")
            seen.add(t["name"])
        return json_copy(sorted(result["tools"],key=lambda t:t["name"]))

    def registrations(self, server, approvals, now):
        approvals = json_copy(approvals)
        if type(approvals) is not list or not callable(now): raise PeerError("INVALID_CONFIGURATION")
        result, seen = [], set()
        for a in approvals:
            t = next((t for t in self._catalog if t["name"] == a.get("name")), None)
            if t is None or a["name"] in seen or any(canonical_json(t[k]) != canonical_json(a.get(k)) for k in ("inputSchema", "outputSchema")): raise PeerError("DISCOVERY_MISMATCH")
            seen.add(a["name"])
            def invoke(args, options, name=a["name"]):
                cancelled = lambda:options["cancelled"]() or now() >= options["deadline"]
                try:
                    if binding_digest(self._discover(cancelled)) != self._fingerprint: raise PeerError("DISCOVERY_CHANGED")
                    response = self._request("tools/call", {"name":name, "arguments":args}, cancelled)
                    if type(response) is not dict or set(response)-{"content","structuredContent","isError","_meta"} or ("isError" in response and response["isError"] is not False) or type(response.get("structuredContent")) is not dict or type(response.get("content")) is not list or len(response["content"]) > 1: raise PeerError("INVALID_TOOL_RESPONSE")
                    for block in response["content"]:
                        if type(block) is not dict or set(block) != {"type","text"} or block["type"] != "text" or type(block["text"]) is not str or canonical_json(parse_json(block["text"])) != canonical_json(response["structuredContent"]): raise PeerError("INVALID_TOOL_RESPONSE")
                    if binding_digest(self._discover(cancelled)) != self._fingerprint: raise PeerError("DISCOVERY_CHANGED")
                    return json_copy(response["structuredContent"])
                except Exception:
                    self.close()
                    raise
            result.append({**a, "server":server, "invoke":invoke})
        return result
