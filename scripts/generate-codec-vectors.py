# SPDX-License-Identifier: Apache-2.0
import json
import random
import sys
from pathlib import Path

def text(value): return {'kind':'text','value':value}
def section(attrs, children=None): return {'kind':'section','attributes':attrs,'children':children or []}
def document(children): return {'kind':'document','children':children,'profile':'PSP-CODEC-1.0'}
valid=[]
def add(id, source, children): valid.append({'id':id,'source':source,'expected':document(children)})
add('empty','',[])
add('untagged-unicode','Hello\r\n世界 e\u0301 🧪',[text('Hello\r\n世界 e\u0301 🧪')])
add('self-closing','${psp type=link ref="doc" href="https://example.test/a?q=x&n=2" /}',[section({'type':'link','ref':'doc','href':'https://example.test/a?q=x&n=2'})])
add('empty-paired','${psp type=context}${/psp}',[section({'type':'context'})])
add('raw-formatting',' Before\r\n${psp\n type=system version=v1.0.0 name="Say \\"Hello\\""}\n  Keep   spaces\r\n${/psp}\tAfter'.replace('\\\\"','\\"'),[text(' Before\r\n'),section({'type':'system','version':'v1.0.0','name':'Say "Hello"'},[text('\n  Keep   spaces\r\n')]),text('\tAfter')])
add('braces-in-attribute','${psp type=custom route="/sessions/{session-id}" note="${/psp} inside quote" /}',[section({'type':'custom','route':'/sessions/{session-id}','note':'${/psp} inside quote'})])
add('quoted-escapes','${psp type=context note="line\\nnext\\t\\u03b1" /}',[section({'type':'context','note':'line\nnext\tα'})])
add('nested-application','${psp type=node node-type=application version=v1.0.0 name=demo session-id=s}\n${psp type=system version=v1.0.0}Rules${/psp}\n${psp type=node id=child version=v1.0.0}${psp type=output}{"ok":true}${/psp}${/psp}\n${/psp}',[section({'type':'node','node-type':'application','version':'v1.0.0','name':'demo','session-id':'s'},[text('\n'),section({'type':'system','version':'v1.0.0'},[text('Rules')]),text('\n'),section({'type':'node','id':'child','version':'v1.0.0'},[section({'type':'output'},[text('{"ok":true}')])]),text('\n')])])
add('literal-delimiters',r'Literal \${psp type=system}x\${/psp} and \\ tail', [text('Literal ${psp type=system}x${/psp} and \\ tail')])
add('unknown-escape-preserved',r'path C:\data\report and \q',[text(r'path C:\data\report and \q')])
add('prototype-attribute','${psp type=custom __proto__="ordinary" constructor="value" /}',[section({'type':'custom','__proto__':'ordinary','constructor':'value'})])
add('fences-are-not-parser-exceptions','```\n${psp type=user}literal block${/psp}\n```',[text('```\n'),section({'type':'user'},[text('literal block')]),text('\n```')])
add('extension-section','${psp type=vendor-example vendor:flag="yes" /}',[section({'type':'vendor-example','vendor:flag':'yes'})])
invalid = [
 ('unclosed','${psp type=system}body','UNCLOSED_SECTION'),
 ('orphan-close','${/psp}','UNEXPECTED_CLOSE'),
 ('malformed-close','${psp type=context}x${/psp extra}','UNEXPECTED_CLOSE'),
 ('missing-type','${psp id=x /}','INVALID_SECTION_TYPE'),
 ('duplicate','${psp type=context type=system /}','DUPLICATE_ATTRIBUTE'),
 ('no-space','${psp type="context"id=x /}','INVALID_MARKUP'),
 ('single-quotes',"${psp type='context' /}",'INVALID_MARKUP'),
 ('bare-url','${psp type=link href=https://example.test /}','INVALID_MARKUP'),
 ('upper-type','${psp type=SYSTEM /}','INVALID_SECTION_TYPE'),
 ('newline-type','${psp type="system\\n" /}','INVALID_SECTION_TYPE'),
 ('unterminated-quote','${psp type=context name="oops}','INVALID_MARKUP'),
 ('truncated-keyword','${psp','INVALID_MARKUP'),
 ('nesting-limit','${psp type=node}'*65+'${/psp}'*65,'LIMIT_EXCEEDED'),
]
invalid_json=[('duplicate-key','{"a":1,"a":2}','DUPLICATE_KEY'),('escaped-duplicate','{"a":1,"\\u0061":2}','DUPLICATE_KEY'),('unsafe-integer','9007199254740992','INVALID_NUMBER'),('unsafe-exponent','1e30','INVALID_NUMBER'),('overflow','1e309','INVALID_NUMBER'),('trailing-comma','[1,]','INVALID_JSON'),('nan','NaN','INVALID_JSON'),('lone-surrogate','"\\ud800"','INVALID_UNICODE'),('leading-zero','01','INVALID_JSON'),('depth-limit','['*258+'0'+']'*258,'LIMIT_EXCEEDED')]
objects=[]
rng=random.Random(721984)
snippets=['', ' spaces \r\n ', 'α世界🧪', '${psp type=system}fake${/psp}', '\\', '\\${/psp}', '${psp', '${/pspx}', 'e\u0301', '\x00\b\f\t', '<html>&"', '42|v1.0.0']
def nodes(depth):
    out=[]
    for _ in range(rng.randrange(1,5)):
        if depth<4 and rng.randrange(3)==0:
            out.append(section({'type':rng.choice(['node','system','context','custom']),'name':rng.choice(snippets),'version':'v1.0.0'}, nodes(depth+1)))
        else:
            val=rng.choice(snippets)
            if val:
                if out and out[-1]['kind']=='text':out[-1]['value']+=val
                else:out.append(text(val))
    return out
for i in range(80): objects.append({'id':f'generated-tree-{i:03}','object':document(nodes(0))})
schema={'type':'object','x-cdl-classes':'confidential','x-cdl-covenants':['no-persist','no-training'],'description':'Unicode α and ${psp type=user} as JSON text','properties':{'summary':{'type':'string','x-cdl-classes':['public'],'x-cdl-covenants':'!no-persist'},'items':{'type':'array','items':{'type':'object','x-cdl-classes':'pii','properties':{'name':{'type':'string'}}}}}}
suite={'profile':'PSP-CODEC-1.0','status':'proposed-standard','markupCases':valid,'invalidMarkupCases':[{'id':i,'source':s,'error':e} for i,s,e in invalid], 'invalidJsonCases':[{'id':i,'source':s,'error':e} for i,s,e in invalid_json],'objectCases':objects,'cdlSchemas':[{'id':'annotated-nested-schema','schema':schema}]}
path=Path(__file__).resolve().parents[1]/'conformance/vectors/codec/profile-1.0.json';path.parent.mkdir(parents=True,exist_ok=True)
encoded=json.dumps(suite,indent=2,ensure_ascii=False)+'\n'
if sys.argv[1:]==['--check']:
    assert path.read_bytes()==encoded.encode('utf-8'), 'Codec fixture regeneration differs'
elif sys.argv[1:]:
    raise SystemExit('Use --check, or no arguments to regenerate the proposed corpus.')
else:
    path.write_text(encoded,encoding='utf-8',newline='\n')
print('Codec fixtures:', len(valid), 'markup;', len(objects), 'seeded object trees;', len(invalid)+len(invalid_json), 'negative cases.')
