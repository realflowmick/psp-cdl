# SPDX-License-Identifier: Apache-2.0
"""Versioned private command schema; keep original durable commands unchanged."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
schema=json.loads((ROOT/"schemas/persistence/turns-0.1.schema.json").read_text(encoding="utf-8"))
schema["$id"]="https://realflowcloud.org/psp/schemas/redirect-turns-0.1.json"
schema["title"]="PSP LLM Redirect 0.1 private commit command"
schema["$comment"]="CC0-1.0. Explicit redirect store opt-in. Same-owner distinct target node, live expiry, full-write authorization and atomic CAS enforced separately."
defs=schema["$defs"]
defs.pop("lockdown");defs.pop("plan")
defs["target"]={"type":"string","minLength":1,"maxLength":256,"pattern":"^mcp://[a-z0-9]+(?:[.-][a-z0-9]+)*/applications/[A-Za-z0-9][A-Za-z0-9_-]*$","not":{"pattern":"[\\r\\n]"}}
defs["redirect"]={"type":"object","additionalProperties":False,"required":["target","nodeId","nodeVersion","policyVersion","expiresAt"],"properties":{"target":{"$ref":"#/$defs/target"},**{k:{"$ref":"#/$defs/id"} for k in ("nodeId","nodeVersion","policyVersion")},"expiresAt":{"type":"integer","minimum":1,"maximum":9007199254740991}}}
command=schema.pop("oneOf")[1]
command["properties"]["action"]={"const":"commitRedirectTurn"}
command["properties"]["postCompletion"]={"const":"redirect"}
command["properties"]["redirect"]={"oneOf":[{"type":"null"},{"$ref":"#/$defs/redirect"}]}
command["required"].append("redirect")
command["allOf"]=[{"if":{"properties":{"complete":{"const":True}}},"then":{"properties":{"redirect":{"$ref":"#/$defs/redirect"}}},"else":{"properties":{"redirect":{"type":"null"}}}}]
schema.update(command)
path=ROOT/"schemas/persistence/redirect-0.1.schema.json"
text=json.dumps(schema,indent=2)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=text: raise SystemExit("Redirect schema differs")
else: path.write_text(text,encoding="utf-8")
