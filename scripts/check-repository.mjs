// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {validate as validateMatrix} from './validate-topology-matrix.mjs';

const root = process.cwd();
const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));
const project = json("project.json");
validateMatrix('suite',json('conformance/vectors/topologies/matrix-0.2.json'));
validateMatrix('mappings',json('conformance/workflow-mappings-0.2.json'));
const ajv = new Ajv2020({allErrors:true});
const validators = Object.fromEntries(["component","vector","result"].map(name => [name,ajv.compile(json("schemas/"+name+".schema.json"))]));
const requiredFiles = ["LICENSE","LICENSES/CC0-1.0.txt","NOTICE","README.md","GOVERNANCE.md","CONTRIBUTING.md","SECURITY.md","ROADMAP.md",".github/CODEOWNERS","package-lock.json","uv.lock"];
for (const file of requiredFiles) assert(existsSync(file), "Missing "+file);
assert(read("LICENSE").includes("Apache License"));
assert(read("LICENSES/CC0-1.0.txt").includes("CC0 1.0 Universal"));
assert.equal(new Set(project.components.map(c=>c.id)).size,7);
for (const component of project.components) {
  const pkg=json(component.typescript+"/package.json");
  assert.equal(pkg.name,"@psp-cdl/"+component.id);
  assert.equal(pkg.private,true,"Scaffold packages must not be published");
  for(const lang of ["typescript","python"]) {
    for(const name of ["README.md","LICENSE","NOTICE"]) assert(existsSync(component[lang]+"/"+name));
  }
  assert(read(component.python+"/pyproject.toml").includes('name = "psp-cdl-'+component.id+'"'));
}
const inventory=json("conformance/requirements.json");
const requirements=inventory.requirements;
const ids=new Set(requirements.map(r=>r.id));
assert.equal(ids.size,requirements.length,"Duplicate requirement IDs");
for(const r of requirements) {
  assert(project.components.some(c=>c.id===r.component));
  assert(["blocked","unimplemented"].includes(r.status));
  for(const blocker of r.blockedBy) assert(read("specs/errata/README.md").includes(blocker));
}
assert.equal(inventory.schemaVersion,2);
for(const source of inventory.sources) {
  const raw=readFileSync(source.path), lines=raw.toString('utf8').split(/\r?\n/);
  assert.equal(createHash('sha256').update(raw).digest('hex'),source.sha256);
  const audit=inventory.keywordAudit.filter(e=>e.path===source.path);
  const matches=[];
  lines.forEach((line,i)=>{
    for(const m of line.matchAll(/\b(?:MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|RECOMMENDED|REQUIRED|MAY|OPTIONAL)\b/g))
      matches.push([i+1,m.index+1,m[0]]);
  });
  assert.deepEqual(audit.map(e=>[e.line,e.column,e.keyword]),matches,'Incomplete keyword audit');
  for(const e of audit) {
    assert.equal(e.quote,lines[e.line-1]);
    assert(e.contextEndLine>=e.line && e.contextEndLine<=lines.length);
    if(e.disposition==='obligation-candidate') assert(ids.has(e.id),'Unmapped obligation');
    else assert(['example','keyword-definition'].includes(e.disposition));
  }
}
for(const evidence of Object.values(inventory.evidence)) for(const file of evidence.implementation) assert(existsSync(file));
const caseIds=new Set();
for(const file of readdirSync("conformance/vectors").filter(f=>f.endsWith(".json"))) {
  const vector=json("conformance/vectors/"+file);
  assert(validators.vector(vector),JSON.stringify(validators.vector.errors));
  assert(ids.has(vector.requirement),"Unknown requirement "+vector.requirement);
  assert(!caseIds.has(vector.id),"Duplicate vector ID");
  caseIds.add(vector.id);
}
for(const entry of json("specs/import-manifest.json").entries) {
  const bytes=readFileSync(entry.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),entry.importedSha256,"Imported RFC changed: "+entry.path);
  assert(read(entry.path).includes("CC0 1.0 Universal"));
}
const ignored=new Set([".git",".cache",".tools",".artifacts",".venv","node_modules","dist","__pycache__"]);
function walk(dir=".") {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>ignored.has(e.name)?[]:e.isDirectory()?walk(dir+"/"+e.name):[dir+"/"+e.name]);
}
const files=walk();
for(const file of files.filter(f=>f.endsWith(".json"))) json(file);
for(const file of files.filter(f=>f.endsWith(".md")&&!f.startsWith("./specs/psp/")&&!f.startsWith("./specs/cdl/"))) {
  for(const match of read(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target=match[1].split("#")[0];
    if(!target||/^[a-z]+:/i.test(target)) continue;
    const absolute=resolve(dirname(file),decodeURIComponent(target));
    assert(absolute.startsWith(root), "Link outside repository in "+file);
    assert(existsSync(absolute),"Broken local link in "+file+": "+target);
  }
}
console.log("Repository checks passed: "+project.components.length+" paired components, "+requirements.length+" pending requirement entries, "+caseIds.size+" draft workflow vectors. No conformance executed.");
