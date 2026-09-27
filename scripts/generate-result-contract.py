# SPDX-License-Identifier: Apache-2.0
"""Generate the separate draft result contract and public synthetic crypto vectors."""
import base64
import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path
import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ROOT = Path(__file__).resolve().parents[1]
def obj(properties):
    return {'type':'object','additionalProperties':False,'required':list(properties),'properties':properties}
def ref(name): return {'$ref':'#/$defs/'+name}
digest = {'type':'string','pattern':r'^[a-f0-9]{64}(?![\s\S])'}
integer = {'type':'integer','minimum':0,'maximum':9007199254740991}
key_id = {'type':'string','pattern':r'^[a-z0-9][a-z0-9._-]{0,127}(?![\s\S])'}
artifact = obj({'path':{'type':'string','pattern':r'^(?:(?:analysis|bundle|corpus|grading|manifest|outcomes|operator-admission)\.json|[0-9]{4}\.(?:(?:record|started|timing|observation)\.json|events\.jsonl))(?![\s\S])'},
                'bytes':{**integer,'maximum':4194304},'sha256':digest})
manifest = obj({'schemaVersion':{'const':1},'scope':{'const':'signed-result-manifest-0.1'},
                'bundleSha256':digest,'planSha256':digest,'corpusSha256':digest,
                'mode':{'enum':['offline','live']},'status':{'enum':['finalized','invalid-source-changed']},'recovered':{'type':'boolean'},
                'evidencePolicy':{'const':'local-synthetic-raw-0.1'},'fullStudy':{'const':False},'independentReview':{'const':False},'executionAuthorized':{'const':False},
                'artifacts':{'type':'array','items':ref('artifact'),'minItems':6,'maxItems':25001}})
signature = obj({'profile':{'const':'result-ed25519-0.1'},'algorithm':{'const':'ed25519'},'keyId':key_id,'signedAt':integer,
                 'value':{'type':'string','pattern':r'^[A-Za-z0-9_-]{85}[AQgw](?![\s\S])'}})
trust = obj({'schemaVersion':{'const':1},'keyId':key_id,'publicKey':{'type':'string','pattern':r'^[A-Za-z0-9_-]{43}(?![\s\S])'},
             'status':{'enum':['active','revoked']},'bundleSha256':digest})
schema = {'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://psp-cdl.org/schemas/result-manifest-0.1.schema.json',
          'title':'Signed result manifest draft 0.1 (CC0-1.0)',
          '$defs':{'artifact':artifact,'manifest':manifest,'signature':signature,'signed':obj({'manifest':ref('manifest'),'signature':ref('signature')}),'trust':trust}}

def b64(data): return base64.urlsafe_b64encode(data).decode().rstrip('=')
def sha(data): return hashlib.sha256(data).hexdigest()
def digest_object(value): return sha(rfc8785.dumps(value))
def saved(value): return rfc8785.dumps(value).decode()+'\n'
# Deliberately public fixture key, never an operational credential.
seed = bytes(range(32))
key = Ed25519PrivateKey.from_private_bytes(seed)
public = key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
plan = {'fixture':'result-byte-binding-only','unicode':'雪 🧪 e\u0301','number':1.25}
corpus = {'syntheticData':True,'cases':[]}
bundle = {'plan':plan,'planSha256':digest_object(plan),'corpusSha256':digest_object(corpus),'mode':'offline','evidencePolicy':'local-synthetic-raw-0.1'}
files = {'bundle.json':saved(bundle),'corpus.json':saved(corpus),'analysis.json':saved({'fixture':True}),
         'outcomes.json':saved({'rows':[]}), 'grading.json':saved({'independentReview':False})}
source = {'schemaVersion':1,'scope':'heldout-execution-result-0.1','bundleSha256':digest_object(bundle),'planSha256':digest_object(plan),
          'corpusSha256':digest_object(corpus),'mode':'offline','status':'finalized','recovered':False,
          'signed':False,'fullStudy':False,'independentReview':False,
          'files':[{'path':p,'sha256':sha(v.encode())} for p,v in sorted(files.items())]}
files['manifest.json'] = saved(source)
payload = {'schemaVersion':1,'scope':'signed-result-manifest-0.1',**{k:source[k] for k in ('bundleSha256','planSha256','corpusSha256','mode','status','recovered')},
           'evidencePolicy':'local-synthetic-raw-0.1','fullStudy':False,'independentReview':False,'executionAuthorized':False,
           'artifacts':[{'path':p,'bytes':len(v.encode()),'sha256':sha(v.encode())} for p,v in sorted(files.items())]}
metadata = {'profile':'result-ed25519-0.1','algorithm':'ed25519','keyId':'public-result-fixture','signedAt':1700000000}
def signed(m, s=metadata):
    data = b'PSP-CDL-RESULT-MANIFEST-0.1\n'+rfc8785.dumps({'manifest':m,'signature':s})
    return {'manifest':m,'signature':{**s,'value':b64(key.sign(data))}}
envelope = signed(payload)
policy = {'keyId':metadata['keyId'],'publicKey':b64(public),'status':'active','bundleSha256':payload['bundleSha256'],'now':1700000010}
cases = []
def add(name, code='OK', target=None, path=None, value=None, delete=False, resign=False):
    cases.append({'id':name,'code':code,'target':target,'path':path or [],'value':value,'delete':delete,'resign':resign})
add('valid-public-fixture')
for field in ('fullStudy','independentReview','executionAuthorized'):
    add('no-'+field+'-promotion','INVALID_RESULT_MANIFEST','envelope',['manifest',field],True)
add('unknown-root','INVALID_RESULT_MANIFEST','envelope',['extra'],'untrusted')
add('unknown-manifest-field','INVALID_RESULT_MANIFEST','envelope',['manifest','claim'],'approved')
add('unknown-signature-field','INVALID_RESULT_MANIFEST','envelope',['signature','publicKey'],b64(public))
add('no-embedded-key-trust','UNKNOWN_RESULT_KEY','policy',['keyId'],'other')
add('revoked-key','REVOKED_RESULT_KEY','policy',['status'],'revoked')
add('wrong-public-key','INVALID_RESULT_SIGNATURE','policy',['publicKey'],b64(bytes(32)))
add('wrong-run-policy','RESULT_SCOPE_MISMATCH','policy',['bundleSha256'],'0'*64)
add('future-signature','RESULT_NOT_YET_VALID','policy',['now'],1699999999)
add('invalid-policy-clock','INVALID_RESULT_POLICY','policy',['now'],True)
add('short-public-key','INVALID_RESULT_POLICY','policy',['publicKey'],b64(bytes(31)))
add('unsupported-profile','UNSUPPORTED_RESULT_SIGNATURE','envelope',['signature','profile'],'2.0')
add('unsupported-algorithm','UNSUPPORTED_RESULT_SIGNATURE','envelope',['signature','algorithm'],'hmac-sha256')
add('padded-signature','INVALID_RESULT_SIGNATURE','envelope',['signature','value'],envelope['signature']['value']+'==')
add('noncanonical-pad-bits','INVALID_RESULT_SIGNATURE','envelope',['signature','value'],envelope['signature']['value'][:-1]+'R')
add('short-signature','INVALID_RESULT_SIGNATURE','envelope',['signature','value'],'A'*85)
add('boolean-timestamp','INVALID_RESULT_SIGNATURE','envelope',['signature','signedAt'],True)
add('negative-timestamp','INVALID_RESULT_SIGNATURE','envelope',['signature','signedAt'],-1)
add('altered-signing-time','INVALID_RESULT_SIGNATURE','envelope',['signature','signedAt'],1700000001)
add('altered-key-id','INVALID_RESULT_SIGNATURE','envelope',['signature','keyId'],'other')
# Also change policy key ID so the altered signed field reaches crypto verification.
cases[-1]['matchingKeyId'] = True
add('altered-plan','INVALID_RESULT_SIGNATURE','envelope',['manifest','planSha256'],'0'*64)
add('altered-status','INVALID_RESULT_SIGNATURE','envelope',['manifest','status'],'invalid-source-changed')
add('altered-recovery','INVALID_RESULT_SIGNATURE','envelope',['manifest','recovered'],True)
add('invalid-version','INVALID_RESULT_MANIFEST','envelope',['manifest','schemaVersion'],2)
add('boolean-version','INVALID_RESULT_MANIFEST','envelope',['manifest','schemaVersion'],True)
add('traversal','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts',0,'path'],'../analysis.json')
add('absolute-path','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts',0,'path'],'C:/analysis.json')
add('reserved-name','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts',0,'path'],'nul.json')
add('boolean-size','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts',0,'bytes'],True)
add('oversized-file','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts',0,'bytes'],4194305)
add('unordered-files','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts'],list(reversed(payload['artifacts'])))
add('duplicate-file','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','artifacts'],[payload['artifacts'][0]]+payload['artifacts'])
add('missing-inventory','INVALID_RESULT_MANIFEST','envelope',['manifest','artifacts'],payload['artifacts'][:-1])
add('live-needs-admission','INVALID_ARTIFACT_INVENTORY','envelope',['manifest','mode'],'live')
add('missing-file','MISSING_RESULT_ARTIFACT','files',['outcomes.json'],delete=True)
add('tampered-file','RESULT_ARTIFACT_MISMATCH','files',['outcomes.json'],'{}\n')
add('newline-is-hashed','RESULT_ARTIFACT_MISMATCH','files',['analysis.json'],files['analysis.json'].rstrip('\n'))
add('changed-signed-inventory','INVALID_RESULT_SIGNATURE','envelope',['manifest','artifacts',0,'sha256'],'0'*64)
add('resigned-wrong-plan','RESULT_BINDING_MISMATCH','envelope',['manifest','planSha256'],'0'*64,resign=True)
add('resigned-source-drift','RESULT_BINDING_MISMATCH','envelope',['manifest','status'],'invalid-source-changed',resign=True)
for name,content in [('utf8-bom','\ufeff'+files['analysis.json']),('duplicate-json-members','{"fixture":true,"fixture":false}')]:
    add(name,'INVALID_RESULT_ARTIFACT','files',['analysis.json'],content,resign=True)
    cases[-1]['rehashArtifact'] = 'analysis.json'
suite = {'schemaVersion':1,'description':'Public synthetic signature and hash-binding fixtures; minimal documents are not executor outputs or study results.',
         'testKey':{'seedHex':seed.hex(),'publicKey':b64(public)},'files':files,'envelope':envelope,'policy':policy,
         'signingInputHex':(b'PSP-CDL-RESULT-MANIFEST-0.1\n'+rfc8785.dumps({'manifest':payload,'signature':metadata})).hex(),'cases':cases}

for path, value in [('schemas/result-manifest-0.1.schema.json',schema),('conformance/vectors/evaluation/result-manifest-0.1.json',suite)]:
    content = json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    file = ROOT/path
    if '--check' in sys.argv:
        if file.read_text(encoding='utf-8') != content: raise SystemExit('Stale artifact: '+path)
    else: file.write_text(content,encoding='utf-8',newline='\n')
print('Signed result schema and public signature vectors are current.')
