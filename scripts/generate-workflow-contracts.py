# SPDX-License-Identifier: Apache-2.0
"""Generate opt-in workflow wire contracts and packaged discovery metadata."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def obj(properties):
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}

identifier = {"type":"string", "minLength":1, "maxLength":128, "pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]*$", "not":{"pattern":"[^A-Za-z0-9._:-]"}}
uuid = {"type":"string", "minLength":36, "maxLength":36, "pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"}
positive = {"type":"integer", "minimum":1, "maximum":9_007_199_254_740_991}
data = {"type":"object", "description":"Bounded portable JSON; data never establishes authority."}
properties = {**{k:identifier for k in ("requestId","nodeId","nodeVersion")}, **{k:uuid for k in ("sessionId","checkpointId")}, **{k:positive for k in ("expectedVersion","expiresAt")}, "state":data, "status":{"enum":["running","completed"]}}
session = obj({"sessionId":uuid,"version":positive,"status":{"enum":["running","waiting","completed"]},"view":data})
node = obj({"nodeId":identifier,"nodeVersion":identifier,"view":data})
checkpoint = obj({"checkpointId":uuid,"sessionId":uuid,"sessionVersion":positive,"expiresAt":positive})
operations = [
    ("createSession","sessions/create","sessions:write",["requestId","nodeId","nodeVersion","expiresAt","state"],session),
    ("getSession","sessions/get","sessions:read",["sessionId"],session),
    ("updateSession","sessions/update","sessions:write",["requestId","sessionId","expectedVersion","nodeId","nodeVersion","status","state"],session),
    ("getNode","nodes/fetch","nodes:read",["nodeId","nodeVersion"],node),
    ("createCheckpoint","checkpoints/create","checkpoints:write",["requestId","sessionId","expectedVersion","expiresAt"],checkpoint),
    ("resumeCheckpoint","checkpoints/resume","checkpoints:resume",["requestId","checkpointId","state"],session),
]
paths, tools, schemas = {}, [], {"Error":obj({"error":obj({"code":{"type":"string"}})})}
for operation, route, scope, fields, result in operations:
    request = obj({k:properties[k] for k in fields})
    response = obj({"profile":{"const":"PSP-WORKFLOW-SERVICE-0.1"},"result":result})
    schemas[operation+"Request"], schemas[operation+"Response"] = request, response
    responses = {str(code):{"description":"Authorized projected result" if code == 200 else "Fail-closed error; 503 delivery failure may follow a committed checkpoint. Retry the identical request.","content":{"application/json":{"schema":{"$ref":"#/components/schemas/"+(operation+"Response" if code == 200 else "Error")}}}} for code in (200,400,401,403,404,405,409,413,415,500,503)}
    paths["/v1/"+route] = {"post":{"operationId":operation,"security":[{"bearerAuth":[]}],"x-required-scope":scope,"requestBody":{"required":True,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/"+operation+"Request"}}}},"responses":responses}}
    tools.append({"name":"realflow."+route.replace("/","."),"description":"Host-authorized "+operation+"; data is projected by the host. Checkpoint credentials never appear in tool input/output.","inputSchema":request,"outputSchema":response,"annotations":{"readOnlyHint":operation in ("getSession","getNode"),"destructiveHint":operation not in ("getSession","getNode"),"idempotentHint":True,"openWorldHint":False}})
openapi = {"openapi":"3.1.0","info":{"title":"PSP reference workflow service (draft)","version":"0.1.0","description":"PSP-WORKFLOW-SERVICE-0.1. Opt-in extension, not the missing RFC-PSP-API or a SaaS API."},"paths":paths,"components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer"}},"schemas":schemas}}
outputs = {
    "schemas/api/workflow-0.1.openapi.json":json.dumps(openapi,indent=2)+"\n",
    "schemas/mcp/workflow-tools-0.1.json":json.dumps({"profile":"PSP-WORKFLOW-SERVICE-0.1","protocolVersion":"2025-11-25","tools":tools},indent=2)+"\n",
    "implementations/typescript/packages/mcp-server/src/workflow-tools.ts":"// SPDX-License-Identifier: Apache-2.0\n// Generated from public-domain workflow contracts.\nexport const workflowToolDefinitions = "+json.dumps(tools,indent=2)+";\n",
    "implementations/python/packages/mcp-server/src/psp_cdl_mcp_server/workflow_tools.py":"# SPDX-License-Identifier: Apache-2.0\n# Generated from public-domain workflow contracts.\nimport json\nWORKFLOW_TOOL_DEFINITIONS = json.loads("+repr(json.dumps(tools,separators=(",",":")))+")\n",
}
for name, text in outputs.items():
    path = ROOT/name
    if sys.argv[1:] == ["--check"]:
        assert path.read_bytes() == text.encode("utf-8"), name+" differs"
    elif not sys.argv[1:]:
        path.write_text(text, encoding="utf-8", newline="\n")
    else:
        raise SystemExit("Use --check or no arguments.")
print("Four workflow contract artifacts agree.")
