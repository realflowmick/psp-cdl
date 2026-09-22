// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { profileReport } from "./profiles.js";
if (process.argv.length === 3 && process.argv[2] === "--profiles") {
  const read=(path:string)=>JSON.parse(readFileSync(new URL("../../../../../conformance/vectors/"+path,import.meta.url),"utf8"));
  try {
    const report=profileReport(read("policy/profile-1.0.json"),read("codec/profile-1.0.json"),read("signatures/profile-2.0.json"));
    console.log(JSON.stringify(report)); process.exitCode=report.failed?1:0;
  } catch { console.log(JSON.stringify({mode:"profile-conformance",status:"error",executed:0,passed:0,reason:"Profile fixtures unavailable or invalid."})); process.exitCode=2; }
} else if (process.argv.length === 3 && process.argv[2] === "--inventory") {
  try {
    const inventory = JSON.parse(readFileSync(new URL("../../../../../conformance/requirements.json", import.meta.url), "utf8"));
    console.log(JSON.stringify({mode:"inventory", executed:0, requirements:inventory.requirements}, null, 2));
  } catch { console.log(JSON.stringify({status:"error",reason:"Inventory requires the source workspace."})); process.exitCode=2; }
} else {
  console.log(JSON.stringify({mode:"conformance", status:"not_implemented", executed:0, passed:0, reason:"No implementation adapter is registered."}));
  process.exitCode = 2;
}
