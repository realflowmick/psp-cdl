// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
const inventory = JSON.parse(readFileSync(new URL("../../../../../conformance/requirements.json", import.meta.url), "utf8"));
if (process.argv.length === 3 && process.argv[2] === "--inventory") {
  console.log(JSON.stringify({mode:"inventory", executed:0, requirements:inventory.requirements}, null, 2));
} else {
  console.log(JSON.stringify({mode:"conformance", status:"not_implemented", executed:0, passed:0, reason:"No implementation adapter is registered."}));
  process.exitCode = 2;
}
