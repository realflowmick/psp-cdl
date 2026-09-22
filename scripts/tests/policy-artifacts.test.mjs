// SPDX-License-Identifier: Apache-2.0
// Specification-fixture audit only. No parser, provenance resolver or dispatch adapter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const json = path => JSON.parse(read(path));
const table = json("conformance/policy/cdl-1.0.json");
const enforcement = json("conformance/policy/enforcement-1.0.json");
const vectors = json("conformance/vectors/policy/profile-1.0.json");
const rules = new Map(table.rules.map(r => [r.id, r]));

test("policy artifacts match their schemas and exact table digest", () => {
  for (const [name, data] of [["cdl-policy-table", table], ["psp-enforcement-table", enforcement], ["policy-vectors", vectors]]) {
    const validate = new Ajv2020({ allErrors: true }).compile(json("schemas/" + name + "-1.0.schema.json"));
    assert(validate(data), JSON.stringify(validate.errors));
  }
  assert.equal(vectors.tableSha256, createHash("sha256").update(read("conformance/policy/cdl-1.0.json")).digest("hex"));
  assert.equal(vectors.executionStatus, "unimplemented");
});

test("every Appendix B.2/B.3 row is mapped exactly once", () => {
  const source = read("specs/cdl/RFC-CDL-v1_5.md");
  const expected = [];
  for (const [start, end] of [["B.2", "B.3"], ["B.3", "B.4"]]) {
    const section = source.split("### " + start + " ")[1].split("### " + end + " ")[0];
    for (const match of section.matchAll(/^\| `([^`]+)`/gm)) expected.push(start + ":" + match[1]);
  }
  assert.deepEqual(table.appendixCoverage.map(r => r.section + ":" + r.row).sort(), expected.sort());
  for (const row of table.appendixCoverage) for (const id of row.rules) assert(rules.has(id), id);
});

test("rules, implications and cases have complete, unique references", () => {
  assert.equal(rules.size, table.rules.length);
  assert.equal(new Set(vectors.cases.map(c => c.id)).size, vectors.cases.length);
  const caps = new Set(table.capabilities);
  const covered = new Set();
  for (const c of vectors.cases) for (const id of c.ruleIds) { assert(rules.has(id), id); covered.add(id); }
  assert.deepEqual([...covered].sort(), [...rules.keys()].sort());
  for (const r of table.rules) {
    assert.equal(r.id, r.kind + ":" + r.term);
    if (r.kind === "class") assert(table.classes.includes(r.term));
    const referenced = ["requireAll", "requireAny", "conflictAny", "checkWhenAny"].flatMap(k => r[k] ?? []);
    if (r.conflictUnless) referenced.push(...r.conflictUnless.any, ...r.conflictUnless.unlessAny);
    for (const cap of referenced) assert(caps.has(cap), r.id + ":" + cap);
    assert(vectors.cases.some(c => c.ruleIds.includes(r.id) && c.expected.decision === "deny"), "Missing denial for " + r.id);
    if (!r.forbidProcessing) assert(vectors.cases.some(c => c.ruleIds.includes(r.id) && c.expected.decision === "allow"), "Missing allow for " + r.id);
  }
  for (const [cap, implied] of Object.entries(table.implications)) for (const term of [cap, ...implied]) assert(caps.has(term), term);
});

// This small algebra audit accepts ONLY already-resolved, synthetic matrix facts.
// It intentionally omits parsing, inheritance, authenticity, tenant/time binding,
// check execution and topology discovery. Do not use it as an authorization API.
function matrixExpectation(input) {
  const { classes, covenants, capabilities, checks, parameters, context } = input;
  const supported = { classes: new Set(table.classes), covenants: new Set(table.rules.filter(r => r.kind === "covenant").map(r => r.term)), capabilities: new Set(table.capabilities) };
  for (const [kind, values] of Object.entries({ classes, covenants, capabilities })) {
    if (values.some(t => !supported[kind].has(t))) return { decision: "unsupported", reasonCodes: ["UNSUPPORTED_TERM"] };
  }
  const caps = new Set(capabilities);
  for (const cap of caps) for (const implied of table.implications[cap] ?? []) caps.add(implied);
  if (context.processingJurisdictions && [...caps].some(c => c.startsWith("processes-in-jurisdiction-") && !context.processingJurisdictions.includes(c.slice("processes-in-jurisdiction-".length)))) {
    return { decision: "deny", reasonCodes: ["INVALID_CONTEXT"] };
  }
  const active = table.rules.filter(r => (r.kind === "class" ? classes : covenants).includes(r.term));
  const errors = new Set();
  const any = values => values.some(c => caps.has(c));
  const met = r => (!r.requireAll || r.requireAll.every(c => caps.has(c))) && (!r.requireAny || any(r.requireAny));
  for (const r of active) {
    if (r.forbidProcessing) errors.add("PROCESSING_PROHIBITED");
    if (any(r.conflictAny ?? []) || (r.conflictUnless && any(r.conflictUnless.any) && !any(r.conflictUnless.unlessAny))) errors.add("CAPABILITY_CONFLICT");
  }
  if (errors.size) return { decision: "deny", reasonCodes: table.reasonStages[5].filter(e => errors.has(e)) };
  for (const r of active.filter(r => !r.group)) {
    if (r.parameter === "roles") {
      if (!parameters.allowedRoles?.length || !context.roles) { errors.add("MISSING_CONTEXT"); continue; }
      if (!context.roles.some(role => parameters.allowedRoles.includes(role))) { errors.add("ROLE_MISMATCH"); continue; }
    }
    if (r.parameter === "jurisdictions") {
      if (!parameters.allowedJurisdictions?.length || !context.processingJurisdictions?.length) { errors.add("MISSING_CONTEXT"); continue; }
      if (context.processingJurisdictions.some(j => !parameters.allowedJurisdictions.includes(j))) { errors.add("JURISDICTION_MISMATCH"); continue; }
      if (context.processingJurisdictions.some(j => !caps.has("processes-in-jurisdiction-" + j))) { errors.add("REQUIREMENT_UNSATISFIED"); continue; }
    }
    if (!met(r)) { errors.add("REQUIREMENT_UNSATISFIED"); continue; }
    if (r.check && (!r.checkWhenAny || any(r.checkWhenAny)) && checks[r.check] !== "satisfied") errors.add("CHECK_UNSATISFIED");
  }
  const bases = active.filter(r => r.group === "article6");
  if (bases.length && !bases.some(r => met(r) && checks[r.check] === "satisfied")) errors.add("LEGAL_BASIS_UNSATISFIED");
  return { decision: errors.size ? "deny" : "allow", reasonCodes: table.reasonStages[6].filter(e => errors.has(e)) };
}
for (const c of vectors.cases.filter(c => c.operation === "evaluate")) {
  test("matrix fixture algebra: " + c.id, () => assert.deepEqual(matrixExpectation(c.input), c.expected));
}
test("batch fixture retains legal-basis groups per resource", () => {
  const c = vectors.cases.find(c => c.id === "legal-basis-separate-resources");
  const decisions = c.input.resources.map(matrixExpectation);
  assert.equal(decisions[0].decision, "allow");
  assert.deepEqual(decisions[1], c.expected);
});
test("a child legal basis cannot widen its parent group", () => {
  const c = vectors.cases.find(c => c.id === "legal-basis-child-cannot-widen-parent");
  const decisions = c.input.resources.map(matrixExpectation);
  assert.deepEqual(decisions[0], c.expected);
  assert.equal(decisions[1].decision, "allow");
});
test("trust registry and topology tables do not assert engine isolation", () => {
  assert.deepEqual(enforcement.levels.map(l => l.level), [0, 1, 2, 3, 4, 5]);
  assert.equal(enforcement.signatureDefaults.priority, 50);
  for (const gate of enforcement.requiredGates.B) assert(enforcement.requiredGates.C.includes(gate));
  for (const c of vectors.cases.filter(c => c.operation === "enforcement")) {
    const { topology, minimumTopology, gates } = c.input;
    const index = value => enforcement.topologyOrder.indexOf(value);
    const reason = index(topology) < Math.max(index(minimumTopology), index("B")) ? "TOPOLOGY_INSUFFICIENT"
      : enforcement.requiredGates[topology].some(g => !gates.includes(g)) ? "MEDIATION_INCOMPLETE" : null;
    assert.deepEqual(c.expected, { decision: reason ? "deny" : "allow", reasonCodes: reason ? [reason] : [] });
  }
});
