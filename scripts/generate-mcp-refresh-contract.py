# SPDX-License-Identifier: Apache-2.0
"""Generate the shared opt-in MCP prompt-refresh contract and packaged constants."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def obj(properties):return {"type":"object","properties":properties,"required":list(properties),"additionalProperties":False}
request=obj({"session_id":{"type":"string","minLength":1,"maxLength":256},"current_version":{"type":"string","minLength":1,"maxLength":256},"trigger":{"type":"string","enum":["expiration","interval"]},"turn_count":{"type":"integer","minimum":0,"maximum":9007199254740991}})
response=obj({"prompt":{"type":"string","minLength":1,"maxLength":262144}})
tool={"name":"realflow.security.refresh","inputSchema":request,"outputSchema":response}
encoded=json.dumps(tool,ensure_ascii=False,indent=2)+"\n"
artifacts={
    "schemas/mcp/prompt-refresh-tool-0.1.json":encoded,
    "implementations/typescript/packages/llmproxy/src/mcp-refresh-contract.ts":"// SPDX-License-Identifier: Apache-2.0\n// Generated from scripts/generate-mcp-refresh-contract.py.\nexport const refreshToolDefinition="+encoded.strip()+";\n",
    "implementations/python/packages/llmproxy/src/psp_cdl_llmproxy/mcp_refresh_contract.py":"# SPDX-License-Identifier: Apache-2.0\n# Generated from scripts/generate-mcp-refresh-contract.py.\nimport json\nREFRESH_TOOL_DEFINITION=json.loads("+repr(encoded)+")\n",
}
for name,content in artifacts.items():
    path=ROOT/name
    if "--check" in sys.argv:
        if not path.exists() or path.read_text(encoding="utf-8")!=content:raise SystemExit("Stale MCP refresh contract: "+name)
    else:path.write_text(content,encoding="utf-8")
print("MCP refresh contract checked")
