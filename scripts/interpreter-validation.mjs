// SPDX-License-Identifier: Apache-2.0
// Observable checks only. Expected routes are grading data, never runtime inputs.
export function gradeCase(c, observation) {
  const a=observation.actual;
  const actual={code:a.code,recoveryCode:a.recoveryCode,node:a.node,version:a.version,status:a.status,
    writes:a.services.filter(e=>e.operation==='updateSession').length,
    resumes:a.services.filter(e=>e.operation==='resumeCheckpoint'&&e.result).length};
  const checks=Object.fromEntries(Object.entries(c.expected).map(([k,v])=>[k,actual[k]===v]));
  checks.candidateDelivery=a.calls>0&&a.hasCandidates===true&&a.trace.length===a.calls;
  checks.privateChannel=a.privateLeak===false;
  checks.noUnexpectedTools=a.toolCalls===0;
  checks.visibleResponse=a.trace.some(t=>t.response);
  checks.stateCoherent=a.state.current_node===a.node;
  const covenants=a.state.governance?.covenants,variables=a.state.variables;
  checks.governanceRetained=Array.isArray(covenants)&&c.initialState.governance.covenants.every(v=>covenants.includes(v));
  checks.reconstructible=Array.isArray(a.state.history)&&variables!==null&&typeof variables==='object'&&!Array.isArray(variables)&&Object.keys(c.initialState.variables).every(k=>Object.hasOwn(variables,k));
  if(c.id==='denied-write')checks.denialObserved=a.trace.some(t=>t.request.messages.some(m=>m.content?.includes('"event":"service-denied"')));
  if(c.id==='checkpoint-resume')checks.resumeReconstructed=a.rehydrated===true&&a.outputs.some(o=>o.status==='waiting');
  if(c.id==='post-commit-reconciliation')checks.failureRetained=a.services.some(e=>e.operation==='updateSession'&&e.code==='INTERNAL_ERROR')&&a.outputs.length===1;
  const ok=Object.values(checks).every(Boolean);
  return {caseId:c.id,checks,boundaryStatus:ok?'passed':'failed',
    behaviorStatus:observation.mode==='rehearsal'?'not-run':ok?'needs-review':'failed',
    evidenceKind:observation.mode==='rehearsal'?'scripted-runtime':'model-observation'};
}
