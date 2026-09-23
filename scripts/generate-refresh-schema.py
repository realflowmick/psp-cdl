# SPDX-License-Identifier: Apache-2.0
"""Shared private command schema; runtime checks also bind versions and clocks."""
import json
import sys
from copy import deepcopy
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
durable=json.loads((ROOT/"schemas/persistence/turns-0.1.schema.json").read_text(encoding="utf-8"))
defs=deepcopy(durable["$defs"])
integer={"type":"integer","minimum":0,"maximum":9007199254740991}
version=r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
defs["promptState"]={
    "type":"object","additionalProperties":False,
    "required":["version","digest","policies","interval","grace","timestamp","expires","turnCount","refreshCount"],
    "properties":{
        "version":{"type":"string","pattern":"^"+version+"$","not":{"pattern":"[^0-9A-Za-z.+-]"}},
        "digest":{"$ref":"#/$defs/digest"},
        "policies":{"type":"array","minItems":1,"maxItems":2,"uniqueItems":True,"items":{"enum":["expiration","interval"]}},
        **{key:integer for key in ("interval","grace","timestamp","expires","turnCount","refreshCount")},
    },
    "if":{"properties":{"policies":{"type":"array","contains":{"const":"interval"}}}},
    "then":{"properties":{"interval":{"type":"integer","minimum":1}}},
    "else":{"properties":{"interval":{"const":0}}},
    "$comment":"Runtime additionally requires expires > timestamp; stored versions omit the optional v prefix."
}
def command(action,properties):
    return {"type":"object","required":["action",*properties],"additionalProperties":False,"properties":{"action":{"const":action},**properties}}
get=command("getPromptState",{"sessionId":{"$ref":"#/$defs/uuid"}})
put=command("putPromptState",{"sessionId":{"$ref":"#/$defs/uuid"},"expectedVersion":{**integer,"minimum":1},"refreshRevision":integer,"state":{"$ref":"#/$defs/promptState"}})
commit=deepcopy(durable["oneOf"][1])
commit["properties"]["action"]={"const":"commitRefreshedTurn"}
commit["properties"]["refreshRevision"]=integer
commit["required"].append("refreshRevision")
schema={"$schema":durable["$schema"],"$id":"https://realflowcloud.org/psp/schemas/prompt-refresh-0.1.json",
        "title":"PSP Prompt Refresh 0.1 private store commands",
        "$comment":"CC0-1.0. Requires durableTurns and promptRefresh opt-in. Host authentication, signature verification, compatibility approval and complete write bounds remain runtime responsibilities. No public HTTP/MCP methods are added.",
        "$defs":defs,"oneOf":[get,put,commit]}
path=ROOT/"schemas/persistence/prompt-refresh-0.1.schema.json"
content=json.dumps(schema,ensure_ascii=False,indent=2)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=content:raise SystemExit("Prompt refresh schema is stale")
else:path.write_text(content,encoding="utf-8")
print("Prompt refresh private command schema checked")
