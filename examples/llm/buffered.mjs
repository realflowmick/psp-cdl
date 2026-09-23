// SPDX-License-Identifier: Apache-2.0
import {runCase} from '../../scripts/llm-fixtures.mjs';
for(const settings of [{},{providerTraining:true}]) {
  const {code,providerCalls,toolCalls,released,result}=await runCase({settings});
  console.log({code,providerCalls,toolCalls,released,...(result?{result}:{})});
}
