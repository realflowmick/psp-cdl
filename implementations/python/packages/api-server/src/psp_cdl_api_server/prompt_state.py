# SPDX-License-Identifier: Apache-2.0
import re
from psp_cdl_core import canonical_version
PROMPT_REFRESH_PROFILE="PSP-PROMPT-REFRESH-0.1"

def compare_prompt_versions(a,b):
    def parts(s):
        core,sep,pre=canonical_version(s).split("+",1)[0].partition("-")
        return core.split("."),pre.split(".") if sep else []
    def cmp(a,b): return (a>b)-(a<b)
    def num(a,b): return cmp(len(a),len(b)) or cmp(a,b)
    x,xpre=parts(a);y,ypre=parts(b)
    for u,v in zip(x,y):
        n=num(u,v)
        if n:return n
    if not xpre or not ypre:return cmp(bool(ypre),bool(xpre))
    for u,v in zip(xpre,ypre):
        n=num(u,v) if u.isascii() and u.isdigit() and v.isascii() and v.isdigit() else cmp(not u.isdigit(),not v.isdigit()) if u.isdigit()!=v.isdigit() else cmp(u,v)
        if n:return n
    return cmp(len(xpre),len(ypre))

def valid_prompt_state(s):
    if type(s) is not dict or set(s)!={"digest","expires","grace","interval","policies","refreshCount","timestamp","turnCount","version"}:return False
    try:
        if canonical_version(s["version"])!=s["version"]:return False
    except Exception:return False
    if type(s["digest"]) is not str or not re.fullmatch(r"[a-f0-9]{64}",s["digest"]):return False
    for k in ("expires","grace","interval","refreshCount","timestamp","turnCount"):
        n=s[k]
        if type(n) not in (int,float) or not 0<=n<=9007199254740991 or int(n)!=n:return False
    p=s["policies"]
    return s["expires"]>s["timestamp"] and type(p) is list and 0<len(p)<=2 and all(type(v) is str and v in ("expiration","interval") and p.index(v)==i for i,v in enumerate(p)) and (("interval" in p)==(s["interval"]>0))
