// SPDX-License-Identifier: Apache-2.0
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runPolicyVectors,runCodecVectors,runSignatureVectors} from "../dist/profiles.js";
const read=path=>JSON.parse(readFileSync(new URL("../../../../../conformance/vectors/"+path,import.meta.url),"utf8"));
for(const [suite,run] of [["policy/profile-1.0.json",runPolicyVectors],["codec/profile-1.0.json",runCodecVectors],["signatures/profile-2.0.json",runSignatureVectors]]) {
  for(const result of run(read(suite))) test(suite+": "+result.caseId,()=>assert.equal(result.status,"passed",JSON.stringify(result)));
}
test("unknown profiles do not become empty passing suites",()=>{
  assert.throws(()=>runPolicyVectors({profile:"unknown",cases:[]}),{code:"UNSUPPORTED_PROFILE"});
  assert.throws(()=>runPolicyVectors({profile:"CDL-DETERMINISTIC-1.0",cases:[]}),{code:"INVALID_FIXTURE"});
});
