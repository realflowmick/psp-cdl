# SPDX-License-Identifier: Apache-2.0
import json
import sys
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.lifecycle import LifecycleStore
backend=SqliteBackend(sys.argv[1],"epoch-1",clock=lambda:1000)
actor={"tenantId":"tenant-a","subjectId":"subject-a"}
store=LifecycleStore(backend,resume_secret=bytes([7])*32,authorize_persistence=lambda a,w:True,authorize_retention=lambda a,c:True)
try:
    c=json.load(sys.stdin)
    if c["operation"]=="seed":
        store.execute(actor,{"action":"putNode","nodeId":"entry","nodeVersion":"1","definition":{}})
        result=store.execute(actor,{"action":"createSession","requestId":"seed","nodeId":"entry","nodeVersion":"1","policyVersion":"policy-1","expiresAt":2000,"state":{"payload":"SYNTHETIC_PAYLOAD"}})
        if c.get("waiting"):result={**result,"checkpoint":store.execute(actor,{"action":"createCheckpoint","requestId":"cp","sessionId":result["sessionId"],"expectedVersion":1,"expiresAt":1500})}
    elif c["operation"]=="execute":result=store.execute(actor,c["command"])
    elif c["operation"]=="read":result=backend.read(actor["tenantId"],{"kind":"session","id":c["sessionId"]})
    else:result=store.lifecycle(actor,c["operation"],c["command"],lambda c:True)
    print(json.dumps({"result":result}))
except Exception as exc:print(json.dumps({"error":getattr(exc,"code","INTERNAL_ERROR")}))
finally:backend.close()
