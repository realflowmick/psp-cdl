// SPDX-License-Identifier: Apache-2.0
// Synthetic fixture only; no live provider or credentials.
import {suite,runCase} from '../../scripts/durable-fixtures.mjs';
for(const id of ['lockdown-before-provider','failAfterCommit','retained-origin-denies-recovery']) {
  const actual=await runCase(suite.cases.find(c=>c.id===id));
  console.log(JSON.stringify({scenario:id,codes:actual.codes,providerCalls:actual.providerCalls,status:actual.status,released:actual.released}));
}
