# SPDX-License-Identifier: Apache-2.0
"""Host-only MCP discovery for the opt-in prompt refresh loop."""
from copy import deepcopy
from psp_cdl_core import canonical_version, parse_markup, section_to_envelope
from psp_cdl_api_server.service import identifier
from .mcp_refresh_contract import REFRESH_TOOL_DEFINITION
MCP_PROMPT_REFRESH_PROFILE="PSP-MCP-PROMPT-REFRESH-0.1"

class PromptRefreshError(ValueError):
    def __init__(self,code):super().__init__(code);self.code=code

def mcp_refresh_tool_definition():return deepcopy(REFRESH_TOOL_DEFINITION)

class McpPromptRefresher:
    def __init__(self,peer,config):
        p=config.get("principal") if type(config) is dict else None
        if type(p) is not dict or not all(identifier(v) for v in (p.get("tenantId"),p.get("subjectId"),config.get("sessionId"))) or not callable(config.get("now")) or not callable(config.get("cancelled")):raise PromptRefreshError("INVALID_CONFIGURATION")
        self._peer,self._tenant,self._subject,self._session,self._cancelled=peer,p["tenantId"],p["subjectId"],config["sessionId"],config["cancelled"]
        tool=mcp_refresh_tool_definition()
        self._invoke=peer.bind_control_tool({"name":config.get("toolName",tool["name"]),"revision":config.get("toolRevision","refresh-1"),"inputSchema":tool["inputSchema"],"outputSchema":tool["outputSchema"]},config.get("approvedCatalogDigest"),config["now"])

    def refresh(self,principal,binding,request):
        if type(principal) is not dict or type(binding) is not dict or type(request) is not dict or any(value.get("tenantId")!=self._tenant or value.get("subjectId")!=self._subject for value in (principal,binding)) or binding.get("sessionId")!=self._session or request.get("session_id")!=self._session:raise PromptRefreshError("REFRESH_BINDING_MISMATCH")
        try:
            if type(request.get("current_version")) is not str or canonical_version(request["current_version"])!=request["current_version"]:raise ValueError()
        except Exception:raise PromptRefreshError("INVALID_REFRESH_REQUEST") from None
        result=self._invoke(request,{"deadline":binding.get("deadline"),"cancelled":self._cancelled})
        try:
            doc=parse_markup(result["prompt"])
            if len(doc["children"])!=1 or doc["children"][0]["kind"]!="section":raise ValueError()
            envelope=section_to_envelope(doc["children"][0])
            if envelope["signature"]["sectionType"]!="system" or envelope["signature"]["contentType"]!="text":raise ValueError()
            return envelope
        except Exception:
            self._peer.close();raise PromptRefreshError("INVALID_REFRESH_RESPONSE") from None
