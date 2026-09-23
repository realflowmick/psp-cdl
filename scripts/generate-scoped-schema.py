# SPDX-License-Identifier: Apache-2.0
import json
import sys
from copy import deepcopy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
base=json.loads((ROOT/"schemas/persistence/turns-0.1.schema.json").read_text(encoding="utf-8"))
defs=deepcopy(base["$defs"]);defs.pop("lockdown");defs.pop("plan")
defs["threatPolicy"]={"type":"object","required":["id","version"],"additionalProperties":False,"properties":{k:{"$ref":"#/$defs/id"} for k in ("id","version")}}
defs["scope"]={"type":"object","required":["id","version","systemDigest","threatPolicy"],"additionalProperties":False,"properties":{"id":{"$ref":"#/$defs/id"},"version":{"$ref":"#/$defs/id"},"systemDigest":{"$ref":"#/$defs/digest"},"threatPolicy":{"$ref":"#/$defs/threatPolicy"}}}
workflow=deepcopy(base["oneOf"][1]);workflow["required"] += ["scope","threatState"]
workflow["properties"].update(action={"const":"commitScopedWorkflowTurn"},postCompletion={"const":"scoped"},scope={"oneOf":[{"type":"null"},{"$ref":"#/$defs/scope"}]},threatState={"type":["object","null"]})
workflow["allOf"]=[{"if":{"properties":{"complete":{"const":True}}},"then":{"properties":{"scope":{"$ref":"#/$defs/scope"},"threatState":{"type":"object"}}},"else":{"properties":{"scope":{"type":"null"},"threatState":{"type":"null"}}}}]
props={k:deepcopy(v) for k,v in base["oneOf"][1]["properties"].items() if k not in ("state","complete","postCompletion")}
props.update(action={"const":"commitScopedTurn"},scopeDigest={"$ref":"#/$defs/digest"},threatState={"type":"object"},violationPhase={"enum":[None,"ingress","egress"]},output={"oneOf":[{"type":"null"},{"allOf":[{"$ref":"#/$defs/output"},{"properties":{"provenance":{"properties":{"steps":{"const":1}}}}}]}]})
followup={"type":"object","required":list(props),"additionalProperties":False,"properties":props,"allOf":[{"if":{"properties":{"violationPhase":{"type":"null"}}},"then":{"properties":{"output":{"$ref":"#/$defs/output"}}},"else":{"properties":{"output":{"type":"null"}}}}]}
schema={"$schema":base["$schema"],"$id":"https://realflowcloud.org/psp/schemas/scoped-turns-0.1.json","title":"PSP Scoped Continuation 0.1 private store commands","$comment":"CC0-1.0. Explicit opt-in. Frozen workflow, scope binding, retained evidence and atomic revision/receipt rules enforced separately.","$defs":defs,"oneOf":[workflow,followup]}
path=ROOT/"schemas/persistence/scoped-0.1.schema.json";text=json.dumps(schema,indent=2)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=text:raise SystemExit("Scoped schema differs")
else:path.write_text(text,encoding="utf-8")
