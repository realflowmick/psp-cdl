# SPDX-License-Identifier: Apache-2.0
import json
import sys
from pathlib import Path
cases=[]
def case(mode,code="OK",calls=0,request=None,id=None):
    cases.append({"id":id or mode,"mode":mode,**({"request":request} if request else {}),"expected":{"code":code,"calls":calls,"released":int(code=="OK")}})
case("normal",calls=1);case("equivalent",calls=1)
for mode,code in (("missing","DISCOVERY_MISMATCH"),("duplicate","INVALID_DISCOVERY"),("schema","DISCOVERY_MISMATCH"),("unapproved","CATALOG_NOT_APPROVED"),("owner","REFRESH_BINDING_MISMATCH"),("binding","REFRESH_BINDING_MISMATCH"),("session","REFRESH_BINDING_MISMATCH"),("expired","PEER_CANCELLED"),("cancelled","PEER_CANCELLED"),("drift-before","DISCOVERY_CHANGED")):case(mode,code)
for mode,code in (("drift-after","DISCOVERY_CHANGED"),("malformed","INVALID_REFRESH_RESPONSE"),("multiple","INVALID_REFRESH_RESPONSE"),("not-system","INVALID_REFRESH_RESPONSE"),("nested","INVALID_REFRESH_RESPONSE"),("extra-output","INVALID_CONTROL_OUTPUT"),("missing-output","INVALID_CONTROL_OUTPUT"),("oversize-output","INVALID_CONTROL_OUTPUT"),("bad-text","INVALID_JSON"),("expired-after","PEER_CANCELLED"),("cancelled-after","PEER_CANCELLED")):case(mode,code,1)
for id,request,code in (("no-authority-on-wire",{"binding":{"secret":"PRIVATE"}},"INVALID_CONTROL_INPUT"),("unsupported-trigger",{"trigger":"adaptive"},"INVALID_CONTROL_INPUT"),("negative-turns",{"turn_count":-1},"INVALID_CONTROL_INPUT"),("boolean-turns",{"turn_count":True},"INVALID_CONTROL_INPUT"),("bad-version",{"current_version":"1.0"},"INVALID_REFRESH_REQUEST"),("alias-version",{"current_version":"v1.0.0"},"INVALID_REFRESH_REQUEST")):
    case("normal",code,request=request,id=id)
loop_cases=[{"id":name,"flags":flags,"code":code,"providerCalls":2 if code=="OK" else 0} for name,flags,code in (
    ("valid",{},"OK"),("tampered",{"tamperedRefresh":True},"PROMPT_REJECTED"),
    ("wrong-scope",{"wrongRefreshScope":True},"PROMPT_REJECTED"),("rollback",{"refreshVersion":"0.9.0"},"PROMPT_ROLLBACK"),
    ("same-version",{"refreshVersion":"1.0.0"},"PROMPT_VERSION_CONFLICT"),
    ("expired",{"refreshExpires":1100,"refreshTimestamp":1099},"PROMPT_REJECTED"),("denied",{"denyRefresh":True},"REFRESH_DENIED"))]
suite={"profile":"PSP-MCP-PROMPT-REFRESH-0.1","license":"CC0-1.0","cases":cases,"loopCases":loop_cases}
path=Path(__file__).resolve().parents[1]/"conformance/vectors/llm/mcp-refresh-0.1.json"
content=json.dumps(suite,indent=2)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=content:raise SystemExit("Stale MCP refresh vectors")
else:path.write_text(content,encoding="utf-8")
print(f"{len(cases)} MCP refresh vectors checked")
