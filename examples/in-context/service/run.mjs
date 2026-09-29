// SPDX-License-Identifier: Apache-2.0
import {suite,runCase} from '../../../scripts/context-service-fixtures.mjs';
for(const id of ['model-selects-help','host-denies-then-model-chooses-alternative','checkpoint-resume-rehydrates']) {
  const r=await runCase(suite.cases.find(c=>c.id===id));
  console.log(JSON.stringify({id,code:r.code,calls:r.calls,node:r.node,version:r.version,status:r.status,events:r.events}));
}
