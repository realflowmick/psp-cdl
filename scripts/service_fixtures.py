# SPDX-License-Identifier: Apache-2.0
import json
from copy import deepcopy
from pathlib import Path
from psp_cdl_api_server import SecurityService
SUITE=json.loads((Path(__file__).resolve().parents[1]/'conformance/vectors/services/profile-0.1.json').read_text(encoding='utf-8'))
def fixture(case=None):
    case=case or {}
    class Host:
        def __init__(self):
            self.snapshot=deepcopy(SUITE['snapshot'])
            self.resolutions=0
            self.token='public-token-a'
            for key in self.snapshot['verification']['keys']:
                key['material']=bytes.fromhex(key.pop('materialHex'))
                if case.get('revoked'): key['status']='revoked'
            if case.get('allow'): self.snapshot['resources'][0]['capabilities']=[]
        def authenticate(self,token): return SUITE['principals'].get(token)
        def resolve(self,principal,operation_id):
            self.resolutions+=1
            if case.get('backendFailure'): raise RuntimeError('PRIVATE_BACKEND_DETAIL')
            return self.snapshot
        def now(self): return case.get('now',SUITE['now'])
    host=Host()
    headers=[] if case.get('token','public-token-a') is None else [['Authorization','Bearer '+case.get('token','public-token-a')]]
    headers+=[['Content-Type',case.get('contentType','application/json')]]+case.get('extraHeaders',[])
    request={'method':case.get('method','POST'),'path':case.get('path','/v1/policy/evaluate'),'headers':headers,'body':case.get('rawBody',json.dumps(case.get('request',{'operation_id':'op-1'}))).encode('utf-8')}
    return SecurityService(host),request,host
