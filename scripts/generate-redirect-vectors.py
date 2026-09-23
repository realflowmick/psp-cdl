# SPDX-License-Identifier: Apache-2.0
"""Reviewable expectations for the opt-in completion redirect boundary."""
import json
import sys
from pathlib import Path

cases = []
def case(name, settings=None, codes=None, targets=0, version=1, providers=2, **extra):
    cases.append({"id":name,"settings":settings or {},**extra,"expected":{"codes":codes or ["OK"],"targets":targets,"version":version,"providerCalls":providers}})

case("atomic-completion",targets=1,version=2)
case("continuing-turn",{"continueTurn":True},version=2)
case("source-does-not-resume",targets=1,version=2,codes=["OK","INACTIVE_SESSION"],steps=[{"action":"run"},{"action":"run"}])
case("historical-recovery",targets=1,version=2,codes=["OK","OK"],steps=[{"action":"run"},{"action":"recover"}])
case("continue-then-complete",targets=1,version=3,providers=3,codes=["OK","OK"],steps=[{"action":"run","flags":{"continueTurn":True}},{"action":"run","flags":{"continueTurn":False},"options":{"requestId":"turn-2","expectedVersion":2}}])
for flag,code in [("denyRedirect","REDIRECT_DENIED"),("unknownRedirect","UNSUPPORTED_POLICY"),("emptyRedirect","INVALID_POLICY"),("wrongRedirectBinding","INVALID_POLICY"),("throwRedirect","HOST_ERROR"),("throwResolve","HOST_ERROR"),("badResolve","INVALID_REDIRECT"),("missingTarget","NOT_FOUND"),("sameTarget","INVALID_REDIRECT"),("expiredTarget","INVALID_REDIRECT"),("longTarget","INVALID_REDIRECT"),("resolveOwner","INVALID_REDIRECT"),("denyTransition","TRANSITION_DENIED"),("denyStorage","PERSISTENCE_DENIED"),("failBeforeCommit","HOST_ERROR"),("redirectCancel","CANCELLED"),("redirectRevoke","UNAUTHENTICATED"),("redirectDrift","STALE_AUTHORITY"),("redirectExpiry","STALE_AUTHORITY")]:
    case(flag,{flag:True},[code])
for flag,code in [("failAfterCommit","HOST_ERROR"),("cancelAfterCommit","CANCELLED"),("driftAfterCommit","STALE_AUTHORITY"),("denyAfterCommit","OUTPUT_DENIED")]:
    case(flag,{flag:True},[code,"OK"],targets=1,version=2,steps=[{"action":"run"},{"action":"recover","flags":{flag:False},"baseFlags":{"cancelled":False,"drift":False}}])
case("recovery-denied",targets=1,version=2,codes=["OK","RECOVERY_DENIED"],steps=[{"action":"run"},{"action":"recover","flags":{"denyRecovery":True}}])
case("recovery-cdl-denied",targets=1,version=2,codes=["OK","OUTPUT_DENIED"],steps=[{"action":"run"},{"action":"recover","flags":{"denyRecoveryPolicy":True}}])
case("isolated-callback-copies",{"mutateResolve":True,"mutateRedirect":True,"mutateTransition":True},targets=1,version=2)
for name,token,code in [("unauthenticated","bad","UNAUTHENTICATED"),("cross-owner","test-other","NOT_FOUND"),("cross-tenant","test-tenant","NOT_FOUND")]:
    case(name,codes=[code],providers=0,steps=[{"action":"run","token":token}])
case("model-cannot-select-target",codes=["INVALID_REQUEST"],providers=0,steps=[{"action":"run","request":{"message":"hello","target":"mcp://evil/applications/evil"}}])
for name,config in [("missing-target",{"postCompletion":"redirect"}),("unmanaged",{"postCompletion":"unmanaged","target":"mcp://realflow/applications/support"}),("url",{"postCompletion":"redirect","target":"https://example.com/applications/support"}),("userinfo",{"postCompletion":"redirect","target":"mcp://user@realflow/applications/support"}),("query",{"postCompletion":"redirect","target":"mcp://realflow/applications/support?secret=x"}),("newline",{"postCompletion":"redirect","target":"mcp://realflow/applications/support\n"})]:
    cases.append({"id":name,"settings":{"configuration":config},"expected":{"code":"UNSUPPORTED_POST_COMPLETION"}})
cases.append({"id":"store-opt-in","settings":{"disabledRedirect":True},"expected":{"code":"INVALID_CONFIGURATION"}})
suite={"profile":"PSP-LLM-REDIRECT-0.1","status":"draft","cases":cases}
path=Path(__file__).resolve().parents[1]/"conformance/vectors/llm/redirect-0.1.json"
text=json.dumps(suite,indent=2,ensure_ascii=False)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=text: raise SystemExit("Redirect vectors differ")
else: path.write_text(text,encoding="utf-8")
