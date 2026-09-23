# SPDX-License-Identifier: Apache-2.0
"""Explicit refresh oracle; expectations are never derived from either adapter."""
import json
import sys
from pathlib import Path
cases=[]
def add(name,settings=None,codes=("OK",),providers=2,tools=1,session=2,turns=1,refreshes=0,calls=0,version="1.0.0",steps=None):
    case={"id":name,"settings":settings or {},"expected":{"codes":list(codes),"released":codes.count("OK"),"providerCalls":providers,"toolCalls":tools,"sessionVersion":session,"turnCount":turns,"refreshCount":refreshes,"refreshCalls":calls,"version":version}}
    if steps is not None:case["steps"]=steps
    cases.append(case)
run={"action":"run"}
two={"action":"run","options":{"requestId":"turn-2","expectedVersion":2}}
three={"action":"run","options":{"requestId":"turn-3","expectedVersion":3}}
near={"base":{"now":1100}}
add("initialize-and-count")
add("tools-do-not-count",codes=("OK","OK"),providers=3,session=3,turns=2,steps=[run,two])
add("interval-before-next-turn",codes=("OK","OK","OK"),providers=4,session=4,refreshes=1,calls=1,version="1.0.1",steps=[run,two,three])
add("new-loop-retains-counter",codes=("OK","OK","OK"),providers=4,session=4,refreshes=1,calls=1,version="1.0.1",steps=[run,two,{**three,"action":"restart"}])
add("expiration-at-grace",near,refreshes=1,calls=1,version="1.0.1")
add("expiration-before-grace",{"base":{"now":1099}})
add("expired-after-idle",codes=("OK","OK"),providers=3,session=3,refreshes=1,calls=1,version="1.0.1",steps=[run,{**two,"baseFlags":{"now":1200}}])
add("interval-only-expiration-backstop",{"initial":{"attributes":{"refresh-policy":"interval","refresh-interval":"10","refresh-grace":"0"}}},codes=("OK","OK"),providers=3,session=3,refreshes=1,calls=1,version="1.0.1",steps=[run,{**two,"baseFlags":{"now":1200}}])
add("default-expiration-and-grace",{"initial":{"expires":1400,"attributes":{}}})
add("default-expiration-triggers",{"initial":{"expires":1400,"attributes":{}},"base":{"now":1100}},refreshes=1,calls=1,version="1.0.1")
add("refresh-between-inferences",{"afterProviderTime":1100},refreshes=1,calls=1,version="1.0.1")
add("expires-during-provider",{"afterProviderTime":1200},codes=("PROMPT_REJECTED",),providers=1,tools=0,session=1,turns=0)
add("recovery-does-not-count",codes=("OK","OK"),steps=[run,{"action":"recover"}])
add("idempotent-input-does-not-count",codes=("OK","TURN_ALREADY_COMMITTED"),steps=[run,run])
add("lockdown-prevents-refresh",{"continueTurn":False},codes=("OK","PSP_POST_COMPLETION_LOCKDOWN"),steps=[run,{**two,"baseFlags":{"now":1200}}])
for name,attrs,code in (
    ("adaptive",{"refresh-policy":"adaptive"},"UNSUPPORTED_REFRESH"),
    ("checkpoint",{"refresh-policy":"checkpoint"},"UNSUPPORTED_REFRESH"),
    ("mixed-unsupported",{"refresh-policy":"expiration|adaptive"},"UNSUPPORTED_REFRESH"),
    ("duplicate",{"refresh-policy":"expiration|expiration"},"UNSUPPORTED_REFRESH"),
    ("missing-interval",{"refresh-policy":"interval"},"INVALID_REFRESH"),
    ("zero-interval",{"refresh-policy":"interval","refresh-interval":"0"},"INVALID_REFRESH"),
    ("leading-zero",{"refresh-grace":"01"},"INVALID_REFRESH"),
    ("newline",{"refresh-grace":"10\n"},"INVALID_REFRESH"),
    ("unsafe-integer",{"refresh-grace":"9007199254740992"},"INVALID_REFRESH"),
    ("unused-interval",{"refresh-interval":"2"},"INVALID_REFRESH"),
    ("endpoint",{"refresh-endpoint":"https://untrusted.invalid/"},"PROMPT_REJECTED"),
    ("refresh-on",{"refresh-on":"connector"},"PROMPT_REJECTED"),
):add(name,{"initial":{"attributes":attrs}},codes=(code,),providers=0,tools=0,session=1,turns=None,refreshes=None,version=None)
cases.append({"id":"explicit-store-opt-in","settings":{"disabledRefresh":True},"expected":{"code":"INVALID_CONFIGURATION"}})
for name,settings,code in (
    ("rollback",{"refreshVersion":"0.9.9"},"PROMPT_ROLLBACK"),
    ("same-version-change",{"refreshVersion":"1.0.0"},"PROMPT_VERSION_CONFLICT"),
    ("build-metadata-cannot-hide-change",{"refreshVersion":"1.0.0+build"},"PROMPT_VERSION_CONFLICT"),
    ("retrieval-failure",{"throwRefresh":True},"HOST_ERROR"),
    ("denied-replacement",{"denyRefresh":True},"REFRESH_DENIED"),
    ("invalid-signature",{"tamperedRefresh":True},"PROMPT_REJECTED"),
    ("wrong-scope",{"wrongRefreshScope":True},"PROMPT_REJECTED"),
    ("not-newly-issued",{"refreshTimestamp":1000},"REFRESH_NOT_FRESH"),
    ("does-not-clear-grace",{"refreshExpires":1200},"REFRESH_NOT_FRESH"),
    ("refresh-cancel",{"refreshCancel":True},"CANCELLED"),
    ("refresh-authority-drift",{"refreshDrift":True},"STALE_AUTHORITY"),
):add(name,{**near,**settings},codes=(code,),providers=0,tools=0,session=1,turns=0,calls=1)
add("same-version-resign",{**near,"refreshVersion":"v1.0.0","refreshText":"System one."},refreshes=1,calls=1)
add("major-approved",{**near,"refreshVersion":"2.0.0"},refreshes=1,calls=1,version="2.0.0")
add("refresh-reserves-owner",{**near,"refreshRace":True},refreshes=1,calls=1,version="1.0.1")
add("storage-denied",{"denyStorage":True},codes=("PERSISTENCE_DENIED",),providers=0,tools=0,session=1,turns=None,refreshes=None,version=None)
add("initial-approval-required",{"denyInitial":True},codes=("REFRESH_DENIED",),providers=0,tools=0,session=1,turns=None,refreshes=None,version=None)
add("audit-failure-after-install",{"denyRefreshAudit":True},codes=("AUDIT_FAILED",),providers=0,tools=0,session=1,turns=0)
add("failed-turn-keeps-version-floor",{**near,"finalDenied":True},codes=("COMPLETION_DENIED","OK"),providers=3,refreshes=1,calls=1,version="1.0.1",steps=[run,{**run,"flags":{"finalDenied":False}}])
add("lost-ack-counts-once",{"failAfterCommit":True},codes=("HOST_ERROR","OK"),steps=[run,{"action":"recover"}])
add("after-refresh-policy-denial",{**near,"denyPhase":"inference"},codes=("POLICY_DENIED",),providers=0,tools=0,session=1,turns=0,refreshes=1,calls=1,version="1.0.1")
add("after-refresh-transition-denial",{**near,"denyTransition":True},codes=("TRANSITION_DENIED",),session=1,turns=0,refreshes=1,calls=1,version="1.0.1")
add("expires-during-tool",{"afterToolTime":1200},codes=("PROMPT_REJECTED",),providers=1,session=1,turns=0)
add("grace-during-tool",{"afterToolTime":1100},refreshes=1,calls=1,version="1.0.1")
add("refresh-identity-revoked",{**near,"refreshRevoke":True},codes=("UNAUTHENTICATED",),providers=0,tools=0,session=1,turns=0,calls=1)
add("audit-failure-retry-still-denies",{"denyRefreshAudit":True},codes=("AUDIT_FAILED","AUDIT_FAILED"),providers=0,tools=0,session=1,turns=0,steps=[run,run])
add("audit-failure-authorized-retry",{"denyRefreshAudit":True},codes=("AUDIT_FAILED","OK"),steps=[run,{**run,"flags":{"denyRefreshAudit":False}}])
add("metadata-lost-ack-rebind",{"failAfterPromptCommit":True},codes=("HOST_ERROR","OK"),steps=[run,{**run,"flags":{"failAfterPromptCommit":False}}])
add("binding-cannot-change-content",codes=("OK","STALE_PROMPT"),steps=[run,{**two,"flags":{"bindingTemplate":{"text":"Changed without refresh."}}}])
add("binding-cannot-lower-version",codes=("OK","STALE_PROMPT"),steps=[run,{**two,"flags":{"bindingTemplate":{"version":"0.9.0"}}}])
add("expired-initial-cannot-supply-directives",{"initial":{"expires":1000}},codes=("PROMPT_REJECTED",),providers=0,tools=0,session=1,turns=None,refreshes=None,version=None)
add("refresh-failure-at-expiration",codes=("OK","HOST_ERROR"),calls=1,steps=[run,{**two,"baseFlags":{"now":1200},"flags":{"throwRefresh":True}}])
add("refresh-retries-on-next-invocation",{**near,"throwRefresh":True},codes=("HOST_ERROR","OK"),calls=2,refreshes=1,version="1.0.1",steps=[run,{**run,"flags":{"throwRefresh":False}}])
add("major-incompatible",{**near,"refreshVersion":"2.0.0","denyRefresh":True},codes=("REFRESH_DENIED",),providers=0,tools=0,session=1,turns=0,calls=1)
add("same-version-trust-change",{**near,"refreshVersion":"1.0.0","refreshText":"System one.","replacement":{"trustLevel":1}},codes=("PROMPT_VERSION_CONFLICT",),providers=0,tools=0,session=1,turns=0,calls=1)
add("same-version-policy-change",{**near,"refreshVersion":"1.0.0","refreshText":"System one.","replacement":{"attributes":{"refresh-policy":"expiration","refresh-grace":"100"}}},codes=("PROMPT_VERSION_CONFLICT",),providers=0,tools=0,session=1,turns=0,calls=1)
add("same-version-normalized-text",{**near,"refreshVersion":"1.0.0","refreshText":"\r\nSystem one.\t"},refreshes=1,calls=1)
versions=[
    ["1.0.0","1.0.1",-1],["1.2.0","1.1.99",1],["1.0.0+one","v1.0.0+two",0],
    ["1.0.0-alpha","1.0.0",-1],["1.0.0-alpha.9","1.0.0-alpha.10",-1],
    ["1.0.0-1","1.0.0-alpha",-1],["1.0.0-a","1.0.0-a.1",-1],
    ["999999999999999999999.0.0","1000000000000000000000.0.0",-1],
]
suite={"profile":"PSP-PROMPT-REFRESH-0.1","license":"CC0-1.0","versions":versions,"cases":cases}
path=Path(__file__).resolve().parents[1]/"conformance/vectors/llm/refresh-0.1.json"
content=json.dumps(suite,ensure_ascii=False,indent=2)+"\n"
if "--check" in sys.argv:
    if path.read_text(encoding="utf-8")!=content:raise SystemExit("Refresh vectors are stale")
else:path.write_text(content,encoding="utf-8")
print(f"{len(cases)} refresh cases and {len(versions)} version comparisons checked")
