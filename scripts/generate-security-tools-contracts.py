# SPDX-License-Identifier: Apache-2.0
"""Generate shared opt-in scan/decrypt/process contracts and discovery metadata."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def obj(p,required=None):return {"type":"object","additionalProperties":False,"properties":p,"required":list(p) if required is None else required}
identifier={"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]*$","not":{"pattern":"[^A-Za-z0-9._:-]"}}
code={"type":"string","maxLength":128,"pattern":"^[A-Z][A-Z0-9_]*$"}
provenance=obj({"profile":{"const":"PSP-SECURITY-TOOLS-0.1"},"envelopeDigest":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"signatureAlgorithm":{"enum":["ed25519","hmac-sha256"]},"signingKeyId":identifier,"trustLevel":{"type":"integer","minimum":0,"maximum":5},"transformation":{"enum":["verified","decrypted"]}})
base={"id":identifier,"ok":{"const":True},"encrypted":{"type":"boolean"},"sectionType":{"type":"string"}}
failure=obj({**base,"ok":{"const":False},"error":code},["id","ok","error"])
paths,tools,schemas={},[],{"Error":obj({"error":obj({"code":code})})}
for op in ("scan","decrypt","process"):
    request=obj({"operation_id":identifier,**({"sections":{"type":"array","minItems":1,"maxItems":32,"items":obj({"id":identifier,"content":{"type":"string","maxLength":1048576}})}} if op=="decrypt" else {"raw_text":{"type":"string","maxLength":1048576}})})
    success=obj({**base,**({"content":{"type":"string","maxLength":65536},"provenance":provenance} if op!="scan" else {})})
    result=obj({"profile":{"const":"PSP-SECURITY-TOOLS-0.1"},"operation_id":identifier,"policy_version":identifier,"success":{"type":"boolean"},"results":{"type":"array","maxItems":32,"items":{"oneOf":[success,failure]}},"summary":obj({k:{"type":"integer","minimum":0,"maximum":32} for k in ("total","successful","failed")}),**({"untrustedText":{"type":"boolean"}} if op!="decrypt" else {})})
    schemas[op+"Request"],schemas[op+"Response"]=request,result
    paths["/v1/security/"+op]={"post":{"operationId":op,"security":[{"bearerAuth":[]}],"x-required-scope":"security:"+op,"requestBody":{"required":True,"content":{"application/json":{"schema":request}}},"responses":{str(status):{"description":"Inspect per-item results; success does not authorize dispatch" if status==200 else "Sanitized error","content":{"application/json":{"schema":result if status==200 else schemas["Error"]}}} for status in (200,400,401,403,404,409,413,500)}}}
    tools.append({"name":"realflow.security."+op,"description":"Opt-in "+op+" under PSP-SECURITY-TOOLS-0.1. Host authority and buffered CDL release are mandatory; unsupported cases are explicit.","inputSchema":request,"outputSchema":result,"annotations":{"readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":False}})
openapi={"openapi":"3.1.0","info":{"title":"PSP security tools (draft)","version":"0.1.0"},"paths":paths,"components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer"}},"schemas":schemas}}
outputs={
"schemas/api/security-tools-0.1.openapi.json":json.dumps(openapi,indent=2)+"\n",
"schemas/mcp/security-tools-extension-0.1.json":json.dumps({"profile":"PSP-SECURITY-TOOLS-0.1","protocolVersion":"2025-11-25","tools":tools},indent=2)+"\n",
"implementations/typescript/packages/mcp-server/src/security-tools-extension.ts":"// SPDX-License-Identifier: Apache-2.0\n// Generated from public-domain security tool contracts.\nexport const securityExtensionTools = "+json.dumps(tools,indent=2)+";\n",
"implementations/python/packages/mcp-server/src/psp_cdl_mcp_server/security_tools_extension.py":"# SPDX-License-Identifier: Apache-2.0\n# Generated from public-domain security tool contracts.\nimport json\nSECURITY_EXTENSION_TOOLS = json.loads("+repr(json.dumps(tools,separators=(",",":")))+")\n",
}
for name,value in outputs.items():
    path=ROOT/name
    if sys.argv[1:]==["--check"]:assert path.read_bytes()==value.encode(),name+" differs"
    elif not sys.argv[1:]:path.write_text(value,encoding="utf-8",newline="\n")
    else:raise SystemExit("Use --check or no arguments")
print("Security tool contracts agree.")
