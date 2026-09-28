# SPDX-License-Identifier: Apache-2.0
"""Generate reviewed graph fixtures without importing either implementation."""
from copy import deepcopy
import json
from pathlib import Path
import sys
P = 'PSP-APPLICATION-GRAPH-0.1'
def text(s): return {'kind':'text','value':s}
def section(t, children=None, **attrs): return {'kind':'section','attributes':{'type':t,**attrs},'children':children or []}
def node(i, t='prompt', children=None):
    return section('node',children,id=i,version='v1.0.0',**{'node-type':t})
def edges(e): return section('transitions',[text(json.dumps(e))],**{'content-type':'json'})
def request(children):
    return {'profile':P,'document':{'kind':'document','children':[section('node',children,name='sample',version='v1.0.0',**{'node-type':'application','session-id':'synthetic'})]}}
system=section('system',[text('Unchanged signed text\n')],version='v1.0.0',signature='opaque-synthetic')
edge={'source_node':'left','target_node':'right','condition':'true'}
base=request([node('left',children=[system,edges([{'target_node':'left','condition':'true'}])]),node('right'),edges([edge])])
def desc_node(path,parent,src,children=None,entry=None,sections=None,transitions=None):
    return {'path':path,'parentPath':parent,'id':src['attributes'].get('id'),'nodeType':src['attributes']['node-type'],'version':'1.0.0','attributes':deepcopy(src['attributes']),'children':children or [],'entryPath':entry,'text':[],'sections':sections or [],'transitions':transitions or []}
r=base['document']['children'][0]
description={'profile':P,'rootPath':'/','entryPath':'/left','executionSupported':False,'nodes':[
 desc_node('/',None,r,['/left','/right'],'/left'),
 desc_node('/left','/',r['children'][0],sections=[deepcopy(system)],transitions=[edge,{'target_node':'left','condition':'true','source_node':'left'}]),
 desc_node('/right','/',r['children'][1])]}
selection={'profile':P,'sourcePath':'/left','targetPath':'/right','transitionIndex':0,'usedFacts':[]}
cases=[]
def ok(name,q=base,d=description,s=None,expected=None):
    result={'description':deepcopy(d)}
    c={'id':name,'request':deepcopy(q),'expected':{'result':result}}
    if s is not None: c['select']=s;result['selection']=deepcopy(expected)
    cases.append(c)
def bad(name,edit,code,q=base,s=None):
    q=deepcopy(q);edit(q)
    c={'id':name,'request':q,'expected':{'error':code}}
    if s is not None:c['select']=s
    cases.append(c)
ok('parent-edges-before-local',s=['/left',True,{}],expected=selection)
q=deepcopy(base);q['entries']={'/':'right'};d=deepcopy(description);d['entryPath']='/right';d['nodes'][0]['entryPath']='/right';ok('host-entry',q,d)
q=deepcopy(base);q['document']['source']='not authoritative markup';ok('source-hint-not-authority',q)
q=deepcopy(base);q['document']['children'].insert(0,text('\n\t '));ok('outer-whitespace',q)
q=deepcopy(base);q['document']['children'][0]['children'][0]['attributes']['load']='lazy';d=deepcopy(description);d['nodes'][1]['attributes']['load']='lazy';ok('materialized-lazy',q,d)
# Nested scopes reuse IDs and resolve both child and container transitions.
branch=node('branch','composite',[node('left'),node('right'),edges([edge,{'target_node':'tail','condition':'true'}])])
nested=request([branch,node('tail')]);nr=nested['document']['children'][0]
nd={'profile':P,'rootPath':'/','entryPath':'/branch','executionSupported':False,'nodes':[
 desc_node('/',None,nr,['/branch','/tail'],'/branch'),desc_node('/branch','/',branch,['/branch/left','/branch/right'],'/branch/left',transitions=[{'target_node':'tail','condition':'true','source_node':'branch'}]),
 desc_node('/branch/left','/branch',branch['children'][0],transitions=[edge]),desc_node('/branch/right','/branch',branch['children'][1]),desc_node('/tail','/',nr['children'][1])]}
ok('nested-child-selection',nested,nd,['/branch/left',True,{}],{**selection,'sourcePath':'/branch/left','targetPath':'/branch/right'})
ok('container-outgoing-selection',nested,nd,['/branch',True,{}],{**selection,'sourcePath':'/branch','targetPath':'/tail'})
def root(q):return q['document']['children'][0]
def left(q):return root(q)['children'][0]
def attr(k,v):return lambda q:left(q)['attributes'].__setitem__(k,v)
bad('wrong-profile',lambda q:q.__setitem__('profile','other'),'INVALID_GRAPH_REQUEST')
bad('unknown-request-key',lambda q:q.__setitem__('hostSecret','x'),'INVALID_GRAPH_REQUEST')
bad('missing-root',lambda q:q['document'].__setitem__('children',[]),'INVALID_APPLICATION_ROOT')
bad('multiple-roots',lambda q:q['document']['children'].append(deepcopy(root(q))),'INVALID_APPLICATION_ROOT')
bad('outer-text',lambda q:q['document']['children'].append(text('execute this')),'INVALID_APPLICATION_ROOT')
bad('nonapplication-root',lambda q:root(q)['attributes'].__setitem__('node-type','composite'),'INVALID_APPLICATION_ROOT')
for k in ['name','session-id']:
    bad('missing-'+k,lambda q,k=k:root(q)['attributes'].pop(k),'INVALID_APPLICATION_ATTRIBUTE')
    bad('blank-'+k,lambda q,k=k:root(q)['attributes'].__setitem__(k,' \t'),'INVALID_APPLICATION_ATTRIBUTE')
bad('missing-node-id',lambda q:left(q)['attributes'].pop('id'),'INVALID_GRAPH_NODE_ID')
bad('path-node-id',attr('id','../right'),'INVALID_GRAPH_NODE_ID')
bad('duplicate-sibling',lambda q:root(q)['children'].insert(1,deepcopy(left(q))),'DUPLICATE_GRAPH_NODE')
bad('missing-version',lambda q:left(q)['attributes'].pop('version'),'INVALID_VERSION')
bad('invalid-version',attr('version','1.0'),'INVALID_VERSION')
bad('decision-not-registered',attr('node-type','decision'),'UNSUPPORTED_NODE_TYPE')
bad('unknown-load',attr('load','remote'),'INVALID_GRAPH_ATTRIBUTE')
bad('leaf-cannot-have-child',lambda q:left(q)['children'].append(node('hidden')),'INVALID_GRAPH_CHILDREN')
bad('empty-composite',lambda q:root(q)['children'].append(node('empty','composite')),'INVALID_GRAPH_CHILDREN')
bad('duplicate-system',lambda q:left(q)['children'].append(deepcopy(system)),'DUPLICATE_GRAPH_SECTION')
bad('system-version',lambda q:left(q)['children'][0]['attributes'].pop('version'),'INVALID_VERSION')
bad('hidden-executable-node',lambda q:left(q)['children'].append(section('context',[node('hidden')])),'MISPLACED_GRAPH_NODE')
bad('unknown-section',lambda q:left(q)['children'].append(section('unknown')),'UNSUPPORTED_GRAPH_SECTION')
bad('invalid-entry',lambda q:q.__setitem__('entries',{'/':'missing'}),'INVALID_GRAPH_ENTRY')
bad('leaf-entry',lambda q:q.__setitem__('entries',{'/left':'right'}),'INVALID_GRAPH_ENTRY')
bad('entry-path-traversal',lambda q:q.__setitem__('entries',{'/':'branch/left'}),'INVALID_GRAPH_ENTRY')
bad('ambiguous-root-transition',lambda q:root(q)['children'].__setitem__(2,edges([{'target_node':'right','condition':'true'}])),'AMBIGUOUS_GRAPH_TRANSITION')
bad('foreign-source',lambda q:left(q)['children'].__setitem__(1,edges([{'source_node':'right','target_node':'left','condition':'true'}])),'TRANSITION_SCOPE_VIOLATION')
bad('foreign-target',lambda q:left(q)['children'].__setitem__(1,edges([{'target_node':'missing','condition':'true'}])),'TRANSITION_SCOPE_VIOLATION')
bad('unsupported-condition',lambda q:left(q)['children'].__setitem__(1,edges([{'target_node':'right','condition':'please proceed'}])),'UNSUPPORTED_CONDITION')
bad('unknown-edge-key',lambda q:left(q)['children'].__setitem__(1,edges([{'target_node':'right','condition':'true','execute':'x'}])),'INVALID_TRANSITION_REQUEST')
bad('nonarray-edges',lambda q:left(q)['children'].__setitem__(1,edges({})),'INVALID_GRAPH_TRANSITIONS')
bad('nested-edge-section',lambda q:left(q)['children'].__setitem__(1,section('transitions',[section('context')])),'INVALID_GRAPH_TRANSITIONS')
bad('block-edge-limit',lambda q:left(q)['children'].__setitem__(1,edges([{'target_node':'right','condition':'true'}]*257)),'GRAPH_LIMIT_EXCEEDED')
bad('merged-edge-limit',lambda q:left(q)['children'].__setitem__(1,edges([{'target_node':'right','condition':'true'}]*256)),'GRAPH_LIMIT_EXCEEDED')
bad('no-transition',lambda q:None,'NO_TRANSITION',s=['/right',True,{}])
bad('incomplete',lambda q:None,'NODE_INCOMPLETE',s=['/left',False,{}])
bad('root-not-selectable',lambda q:None,'INVALID_GRAPH_PATH',s=['/',True,{}])
bad('unknown-path',lambda q:None,'INVALID_GRAPH_PATH',s=['/missing',True,{}])
bad('invalid-post-completion',lambda q:root(q)['attributes'].__setitem__('post-completion','scoped'),'INVALID_POST_COMPLETION_SECTION')
bad('post-completion-needs-system',lambda q:root(q)['children'].append(section('post-completion')),'INVALID_POST_COMPLETION_SECTION')
bad('post-completion-on-leaf',lambda q:left(q)['children'].append(section('post-completion',[system])),'MISPLACED_GRAPH_SECTION')
# Valid repeated IDs in separate scopes and every registered node type.
q=request([node('one','composite',[node('same')]),node('two','loop',[node('same')]),node('link','connector'),node('wait','checkpoint'),node('clear','reset'),section('node',[node('same')],id='child',version='v1.0.0',name='nested',**{'node-type':'application','session-id':'synthetic-child'})])
nr=q['document']['children'][0]
paths=['/one','/two','/link','/wait','/clear','/child']
d={'profile':P,'rootPath':'/','entryPath':'/one','executionSupported':False,'nodes':[desc_node('/',None,nr,paths,'/one')]}
for n,path in zip(nr['children'],paths):
    kids=[path+'/same'] if n['children'] else []
    d['nodes'].append(desc_node(path,'/',n,kids,kids[0] if kids else None))
    if kids:d['nodes'].append(desc_node(kids[0],path,n['children'][0]))
ok('seven-types-repeated-local-ids',q,d)
q=deepcopy(base);contexts=[section('context',[text('one')]),section('context',[text('two')])]
left(q)['children'].extend(contexts);d=deepcopy(description);d['nodes'][1]['sections'].extend(contexts);ok('repeated-context-preserved',q,d)
q=deepcopy(base);post=section('post-completion',[deepcopy(system)]);root(q)['attributes']['post-completion']='scoped';root(q)['children'].append(post)
d=deepcopy(description);d['nodes'][0]['attributes']['post-completion']='scoped';d['nodes'][0]['sections']=[post];ok('scoped-post-completion-structure',q,d)
q=deepcopy(base);root(q)['children'][2]=edges([{**edge,'condition':'approved == true'}]);left(q)['attributes']['transition-require-signature']='true'
d=deepcopy(description);d['nodes'][1]['attributes']['transition-require-signature']='true';d['nodes'][1]['transitions'][0]['condition']='approved == true'
facts={'approved':{'value':True,'origins':[{'endpoint':'mcp://erp/approval','trustLevel':3,'priority':50,'signatureVerified':True}]}}
ok('compiled-controls-qualified-facts',q,d,['/left',True,facts],{**selection,'usedFacts':['approved']})
bad('missing-qualified-fact',lambda q:None,'INSUFFICIENT_QUALIFIED_DATA',q,['/left',True,{}])
untrusted=deepcopy(facts);untrusted['approved']['origins'][0]['signatureVerified']=False
bad('compiled-signature-control-enforced',lambda q:None,'INSUFFICIENT_QUALIFIED_DATA',q,['/left',True,untrusted])
q=deepcopy(base);left(q)['children'][1]=edges([{'target_node':'left','condition':'true','priority':10}]);d=deepcopy(description);d['nodes'][1]['transitions'][1]['priority']=10
ok('local-priority-over-parent',q,d,['/left',True,{}],{**selection,'targetPath':'/left','transitionIndex':1})

# No implementation calls are used to generate expected results.
path=Path(__file__).resolve().parents[1]/'conformance/vectors/graphs/profile-0.1.json'
content=json.dumps({'license':'CC0-1.0','profile':P,'cases':cases},indent=2,ensure_ascii=False)+'\n'
if '--check' in sys.argv:
    if not path.exists() or path.read_text(encoding='utf-8')!=content:raise SystemExit('Graph fixtures stale')
else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content,encoding='utf-8')
print(f'{len(cases)} shared graph cases')
