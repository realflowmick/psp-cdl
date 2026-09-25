# SPDX-License-Identifier: Apache-2.0
"""Generate the opt-in draft lifecycle HTTP/MCP contracts."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def obj(p):
    return {"type":"object", "additionalProperties":False, "properties":p, "required":list(p)}
uuid = {"type":"string", "pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "minLength":36, "maxLength":36}
identifier = {"type":"string", "pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]*$", "not":{"pattern":"[^A-Za-z0-9._:-]"}, "minLength":1, "maxLength":128}
positive = {"type":"integer", "minimum":1, "maximum":9007199254740991}
cursor = {"anyOf":[uuid,{"type":"null"}]}
summary = obj({"sessionId":uuid,"version":positive,"status":{"enum":["running","waiting","completed","cancelled"]},"expiresAt":positive,"updatedAt":{"type":"integer","minimum":0,"maximum":9007199254740991}})
mutation = obj({"requestId":identifier,"sessionId":uuid,"expectedVersion":positive})
operations = [
    ("listSessions","list","sessions:read",obj({"after":cursor,"limit":{"type":"integer","minimum":1,"maximum":50},"status":{"enum":["all","running","waiting","completed","cancelled","expired"]}}),obj({"sessions":{"type":"array","maxItems":50,"items":summary},"after":cursor})),
    ("cancelSession","cancel","sessions:cancel",mutation,obj({"sessionId":uuid,"version":positive,"status":{"const":"cancelled"}})),
    ("purgeSession","purge","sessions:purge",mutation,obj({"sessionId":uuid,"version":positive,"status":{"const":"purged"},"cleaned":{"type":"integer","minimum":0,"maximum":1},"more":{"type":"boolean"}})),
]
paths, tools, schemas = {}, [], {"Error":obj({"error":obj({"code":{"type":"string"}})})}
for operation, suffix, scope, request, result in operations:
    response = obj({"profile":{"const":"PSP-LIFECYCLE-0.1"},"result":result})
    schemas[operation+"Request"], schemas[operation+"Response"] = request, response
    paths["/v1/sessions/"+suffix] = {"post":{"operationId":operation,"security":[{"bearerAuth":[]}],"x-required-scope":scope,"requestBody":{"required":True,"content":{"application/json":{"schema":request}}},"responses":{str(status):{"description":"Host-authorized result" if status==200 else "Stable error code; no backend detail","content":{"application/json":{"schema":response if status==200 else schemas["Error"]}}} for status in (200,400,401,403,404,409,413,500,503)}}}
    tools.append({"name":"realflow.sessions."+suffix,"description":"Opt-in host-authorized "+operation+"; cancellation and payload cleanup are draft extensions. Tombstones require retention approval.","inputSchema":request,"outputSchema":response,"annotations":{"readOnlyHint":suffix=="list","destructiveHint":suffix!="list","idempotentHint":True,"openWorldHint":False}})
openapi = {"openapi":"3.1.0","info":{"title":"PSP lifecycle service (draft)","version":"0.1.0"},"paths":paths,"components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer"}},"schemas":schemas}}
outputs = {
    "schemas/api/lifecycle-0.1.openapi.json":json.dumps(openapi,indent=2)+"\n",
    "schemas/mcp/lifecycle-tools-0.1.json":json.dumps({"profile":"PSP-LIFECYCLE-0.1","protocolVersion":"2025-11-25","tools":tools},indent=2)+"\n",
    "implementations/typescript/packages/mcp-server/src/lifecycle-tools.ts":"// SPDX-License-Identifier: Apache-2.0\n// Generated from public-domain lifecycle contracts.\nexport const lifecycleToolDefinitions = "+json.dumps(tools,indent=2)+";\n",
    "implementations/python/packages/mcp-server/src/psp_cdl_mcp_server/lifecycle_tools.py":"# SPDX-License-Identifier: Apache-2.0\n# Generated from public-domain lifecycle contracts.\nimport json\nLIFECYCLE_TOOL_DEFINITIONS = json.loads("+repr(json.dumps(tools,separators=(",",":")))+")\n",
}
for name, value in outputs.items():
    path = ROOT/name
    if sys.argv[1:] == ["--check"]:
        assert path.read_bytes() == value.encode(), name+" differs"
    elif not sys.argv[1:]:
        path.write_text(value,encoding="utf-8",newline="\n")
    else:
        raise SystemExit("Use --check or no arguments")
print("Lifecycle contracts agree.")
