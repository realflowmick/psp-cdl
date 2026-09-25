# SPDX-License-Identifier: Apache-2.0
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_api_server import MAX_REQUEST_BYTES, SecurityService, ServiceError, scope_for
from .tools import TOOL_DEFINITIONS
from .workflow_tools import WORKFLOW_TOOL_DEFINITIONS
from .lifecycle_tools import LIFECYCLE_TOOL_DEFINITIONS
from .revision import REVISION_PROFILE, REVISION_KEY
MCP_VERSION="2025-11-25"
OPERATIONS={"realflow.security.verify":"verify","realflow.policy.evaluate":"evaluate", "realflow.sessions.create":"createSession", "realflow.sessions.get":"getSession", "realflow.sessions.update":"updateSession", "realflow.nodes.fetch":"getNode", "realflow.checkpoints.create":"createCheckpoint", "realflow.checkpoints.resume":"resumeCheckpoint", "realflow.sessions.list":"listSessions", "realflow.sessions.cancel":"cancelSession", "realflow.sessions.purge":"purgeSession"}


class SecurityTools:
    def __init__(self, service): self.service = service
    def authenticate(self, token): return self.service.authenticate(token)
    def discover(self, token, principal):
        return [t for t in [*TOOL_DEFINITIONS, *WORKFLOW_TOOL_DEFINITIONS, *LIFECYCLE_TOOL_DEFINITIONS] if OPERATIONS[t["name"]] in self.service.operations and scope_for(OPERATIONS[t["name"]]) in principal["scopes"]]
    def call_tool(self, name, args, token, principal):
        if name not in OPERATIONS or OPERATIONS[name] not in self.service.operations:
            raise ServiceError("Invalid tool or arguments", 400)
        return {"data":self.service.invoke(OPERATIONS[name], args, token, principal)}

class McpServer:
    """One initialized peer; transports can supply immutable per-request context."""
    def __init__(self,service: SecurityService,credential):
        self.service,self.credential=SecurityTools(service) if hasattr(service,"operations") else service,credential
        self.phase,self.identity="new",None
        self.revision_negotiated=False

    def handle(self,source,context=None):
        def error(id,code,reason):
            return {"jsonrpc":"2.0","id":id,"error":{"code":code,"message":reason}}
        try:
            if len(source.encode("utf-8"))>MAX_REQUEST_BYTES:
                raise ValueError()
            message=parse_json(source)
        except (ValueError,UnicodeError):
            return error(None,-32700,"Parse error")
        if type(message) is not dict or message.get("jsonrpc")!="2.0" or type(message.get("method")) is not str or set(message)-{"jsonrpc","id","method","params"}:
            return error(None,-32600,"Invalid Request")
        notification="id" not in message
        id=message.get("id")
        if not notification and not (type(id) is str or type(id) in (int,float) and int(id)==id and abs(id)<=9_007_199_254_740_991):
            return error(None,-32600,"Invalid Request")
        def fail(code,reason):
            return None if notification else error(id,code,reason)
        def success(result):
            return {"jsonrpc":"2.0","id":id,"result":result}
        try:
            service = context["service"] if context else self.service
            token = context["token"] if context else self.credential()
            principal=service.authenticate(token)
            identity=canonical_json([principal["tenantId"],principal["subjectId"]])
            if context and context.get("principal") and identity != canonical_json([context["principal"]["tenantId"],context["principal"]["subjectId"]]):
                return fail(-32001,"IDENTITY_CHANGED")
            if self.identity is not None and self.identity!=identity:
                return fail(-32001,"IDENTITY_CHANGED")
            params=message.get("params",{})
            if type(params) is not dict:
                return fail(-32602,"Invalid params")
            if "_meta" in params and type(params["_meta"]) is not dict:
                return fail(-32602,"Invalid params")
            if notification:
                if message["method"]=="notifications/initialized" and self.phase=="initializing" and not set(params)-{"_meta"}:
                    self.phase="ready"
                return None
            method=message["method"]
            if method=="ping":
                return success({})
            if method=="initialize":
                client=params.get("clientInfo")
                if self.phase!="new" or type(params.get("protocolVersion")) is not str or type(params.get("capabilities")) is not dict or type(client) is not dict or type(client.get("name")) is not str or type(client.get("version")) is not str:
                    return fail(-32602,"Invalid initialization")
                revisions=getattr(service,"revisions",None)
                offered=getattr(revisions,"profile",None)==REVISION_PROFILE
                experimental=params["capabilities"].get("experimental")
                requested=type(experimental) is dict and REVISION_KEY in experimental
                if requested and (not offered or experimental[REVISION_KEY]!={"profile":REVISION_PROFILE}): return fail(-32000,"REVISION_UNSUPPORTED")
                self.revision_negotiated=requested
                self.identity,self.phase=identity,"initializing"
                return success({"protocolVersion":MCP_VERSION,"capabilities":{"tools":{"listChanged":False},**({"experimental":{REVISION_KEY:{"profile":REVISION_PROFILE}}} if offered else {})},"serverInfo":{"name":"psp-cdl-reference","version":"0.1.0"}})
            if self.phase!="ready":
                return fail(-32000,"NOT_INITIALIZED")
            if self.revision_negotiated and getattr(getattr(service,"revisions",None),"profile",None)!=REVISION_PROFILE: return fail(-32000,"REVISION_UNSUPPORTED")
            if method=="tools/list":
                if set(params)-{"_meta"}:
                    return fail(-32602,"Invalid params")
                # Detach tool schemas so callers cannot alter future discovery.
                if self.revision_negotiated: return success(parse_json(canonical_json(service.revisions.discover(token,principal))))
                tools=service.discover(token,principal)
                return success({"tools":parse_json(canonical_json(tools))})
            if method!="tools/call":
                return fail(-32601,"Method not found")
            if set(params)-{"name","arguments","_meta"} or type(params.get("name")) is not str or type(params.get("arguments")) is not dict:
                return fail(-32602,"Invalid tool or arguments")
            try:
                if not self.revision_negotiated and REVISION_KEY in params.get("_meta",{}): raise ServiceError("REVISION_UNSUPPORTED",409)
                result=service.revisions.call_tool(params["name"],params["arguments"],token,principal,params.get("_meta",{}).get(REVISION_KEY)) if self.revision_negotiated else service.call_tool(params["name"],params["arguments"],token,principal)
                return success({"content":[{"type":"text","text":canonical_json(result["data"])}],"structuredContent":result["data"],"isError":False,**({"_meta":result["meta"]} if "meta" in result else {})})
            except Exception as exc:
                if isinstance(exc,ServiceError) and exc.status==400:
                    return fail(-32602,exc.code)
                code=exc.code if isinstance(exc,ServiceError) else "INTERNAL_ERROR"
                return success({"content":[{"type":"text","text":canonical_json({"error":{"code":code}})}],"isError":True})
        except Exception as exc:
            return fail(-32001 if isinstance(exc,ServiceError) and exc.status==401 else -32603,exc.code if isinstance(exc,ServiceError) else "INTERNAL_ERROR")
