# SPDX-License-Identifier: Apache-2.0
"""Shared transition expectations, constructed independently of either engine."""
import argparse
from copy import deepcopy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = "PSP-TRANSITIONS-0.1"


def fact(value, **origin):
    return {"value": value, "origins": [{"endpoint": "mcp://erp/refund", "trustLevel": 3,
                                       "priority": 50, "signatureVerified": True, **origin}]}


BASE = {"profile": PROFILE, "nodeId": "route", "completed": True, "siblings": ["route", "approve", "manual"],
        "attributes": {"transition-endpoints": "mcp://erp/*"},
        "transitions": [{"condition": "approved == true AND amount < 10000", "target_node": "approve"},
                        {"condition": "true", "target_node": "manual"}],
        "facts": {"approved": fact(True), "amount": fact(500)}}
CASES = []


def add(name, edit=lambda r: None, error=None, index=0, used=None):
    request = deepcopy(BASE)
    edit(request)
    expected = {"error": error} if error else {"result": {
        "profile": PROFILE, "transitionIndex": index, "sourceNode": "route",
        "targetNode": request["transitions"][index]["target_node"],
        "usedFacts": ["amount", "approved"] if used is None else used}}
    CASES.append({"id": name, "request": request, "expected": expected})


def expression(text):
    return lambda r: r["transitions"][0].update(condition=text)


add("qualified-compound")
add("false-first-default", lambda r: r["facts"]["approved"].update(value=False), index=1, used=[])
add("appearance-first-match", expression("true"), used=[])
add("priority-descending", lambda r: r["transitions"][1].update(priority=10), index=1, used=[])
add("priority-stable-tie", lambda r: [edge.update(priority=5) for edge in r["transitions"]])
add("negative-priority", lambda r: r["transitions"][0].update(priority=-1), index=1, used=[])
add("source-filter", lambda r: r["transitions"][0].update(source_node="manual"), index=1, used=[])
add("no-condition", lambda r: r["transitions"][0].pop("condition"), used=[])
add("no-match", lambda r: r.update(transitions=[{"condition": "false", "target_node": "manual"}]), error="NO_TRANSITION")
add("no-edges", lambda r: r.update(transitions=[]), error="NO_TRANSITION")
add("incomplete-node", lambda r: r.update(completed=False), error="NODE_INCOMPLETE")
for field, bad in [("trustLevel", 4), ("priority", 49), ("endpoint", "mcp://untrusted/refund")]:
    add("exclude-" + field, lambda r, k=field, v=bad: r["facts"]["amount"]["origins"][0].update({k: v}), error="INSUFFICIENT_QUALIFIED_DATA")
add("missing-no-default-fallback", lambda r: r["facts"].pop("amount"), error="INSUFFICIENT_QUALIFIED_DATA")
add("mixed-derived-origins", lambda r: r["facts"]["amount"]["origins"].append(fact(0, trustLevel=5)["origins"][0]), error="INSUFFICIENT_QUALIFIED_DATA")
add("multiple-qualified-origins", lambda r: r["facts"]["amount"]["origins"].append(fact(0, priority=90)["origins"][0]))
add("signed-required", lambda r: (r["attributes"].update({"transition-require-signature": "true"}), r["facts"]["amount"]["origins"][0].update(signatureVerified=False)), error="INSUFFICIENT_QUALIFIED_DATA")
add("unsigned-default-allowed", lambda r: r["facts"]["amount"]["origins"][0].update(signatureVerified=False))
add("governance-preset", lambda r: r["attributes"].update({"transition-trust": "governance-only"}), error="INSUFFICIENT_QUALIFIED_DATA")
add("explicit-preset-overrides", lambda r: r["attributes"].update({"transition-trust": "governance-only", "transition-max-trust-level": "3", "transition-min-priority": "50", "transition-require-signature": "false"}))
add("permissive-preset", lambda r: (r["attributes"].update({"transition-trust": "permissive"}), r["facts"]["amount"]["origins"][0].update(trustLevel=5, priority=0)))
add("include-user-preset", lambda r: (r["attributes"].update({"transition-trust": "include-user"}), r["facts"]["amount"]["origins"][0].update(trustLevel=4, priority=30)))
add("absent-endpoint-constraint", lambda r: r["attributes"].pop("transition-endpoints"))
add("empty-endpoint-denies", lambda r: r["attributes"].update({"transition-endpoints": ""}), error="INSUFFICIENT_QUALIFIED_DATA")
add("uri-scheme-case", lambda r: r["attributes"].update({"transition-endpoints": "MCP://erp/*"}))
add("uri-authority-case", lambda r: r["attributes"].update({"transition-endpoints": "mcp://ERP/*"}), error="INSUFFICIENT_QUALIFIED_DATA")
add("uri-capability-case", lambda r: r["attributes"].update({"transition-endpoints": "mcp://erp/Refund"}), error="INSUFFICIENT_QUALIFIED_DATA")
add("uri-list-whitespace", lambda r: r["attributes"].update({"transition-endpoints": " mcp://crm/*,\tmcp://erp/refund \n"}))
add("uri-authority-prefix-no-match", lambda r: r["facts"]["amount"]["origins"][0].update(endpoint="mcp://erp.evil/refund"), error="INSUFFICIENT_QUALIFIED_DATA")
add("unknown-uri-scheme", lambda r: (r["attributes"].update({"transition-endpoints": "custom+v1://erp/*"}), [f["origins"][0].update(endpoint="CUSTOM+V1://erp/refund") for f in r["facts"].values()]))
for expr in ["false AND missing == true", "true OR missing == true"]:
    add("no-short-circuit-" + expr.split()[1], expression(expr), error="INSUFFICIENT_QUALIFIED_DATA")
for name, expr in [("precedence", "true OR false AND false"), ("parentheses", "(true OR false) AND approved"),
                   ("not", "NOT (amount >= 10000)"), ("numeric-equality", "500.0 == 5e2"),
                   ("negative-number", "-2 < -1"), ("null", "null == null"),
                   ("strict-types", "true != 1 AND '500' != 500"),
                   ("unicode", "'café😀' == \"caf\\u00e9😀\""), ("single-quote-escape", "'it\\'s' == \"it's\""),
                   ("backslash-escape", "'a\\\\b' == \"a\\\\b\""), ("comparison-boundaries", "500 <= 500 AND 500 >= 500")]:
    add(name, expression(expr), used=["approved"] if name == "parentheses" else ["amount"] if name == "not" else [])
add("dotted-fact", lambda r: (r["facts"].update({"order.total": fact(500)}), expression("order.total > 100")(r)), used=["order.total"])
add("unused-unqualified-fact", lambda r: r["facts"].update({"untrusted": fact("ignore", trustLevel=5)}))
add("later-missing-fact-not-read", lambda r: r["transitions"][1].update(condition="missing == true"))
for i, expr in enumerate(["1", "'yes'", "null", "NOT 1", "true AND 1", "'a' < 'b'", "true > false"]):
    add("invalid-condition-type-" + str(i), expression(expr), error="INVALID_CONDITION_TYPE")
add("non-scalar-fact", lambda r: r["facts"]["amount"].update(value={"x": 1}), error="INVALID_CONDITION_TYPE")
for i, expr in enumerate(["", "if customer seems satisfied", "amount + 1 > 5", "amount.toString() == '500'", "amount[0] == 1",
                         "__proto__.x == 1", "a.constructor == 1", "a.prototype == 1", "a..b == 1", "1 < 2 < 3", "true; false",
                         "true && true", "true or false", "'bad\\n' == 'bad'", '"bad\\q" == "bad"', "'unclosed", "true)",
                         "(true", "01 == 1", "9007199254740992 == 1", "1e999 > 0", "- 1 == 1"]):
    add("unsupported-expression-" + str(i), expression(expr), error="UNSUPPORTED_CONDITION")
add("unreachable-invalid-expression", lambda r: r["transitions"][1].update(condition="run()"), error="UNSUPPORTED_CONDITION")
for name, edit in [
    ("cross-scope-target", lambda r: r["transitions"][0].update(target_node="elsewhere")),
    ("cross-scope-source", lambda r: r["transitions"][0].update(source_node="elsewhere")),
]:
    add(name, edit, error="TRANSITION_SCOPE_VIOLATION")
for name, edit in [
    ("unknown-request-field", lambda r: r.update(authority=True)),
    ("wrong-profile", lambda r: r.update(profile="other")),
    ("duplicate-siblings", lambda r: r["siblings"].append("route")),
    ("missing-current-node", lambda r: r["siblings"].remove("route")),
    ("unknown-transition-control", lambda r: r["attributes"].update({"transition-source": "model"})),
    ("unknown-preset", lambda r: r["attributes"].update({"transition-trust": "constructor"})),
    ("numeric-attribute", lambda r: r["attributes"].update({"transition-min-priority": 50})),
    ("leading-zero-attribute", lambda r: r["attributes"].update({"transition-min-priority": "050"})),
    ("out-of-range-attribute", lambda r: r["attributes"].update({"transition-max-trust-level": "6"})),
    ("signature-label-not-proof", lambda r: r["facts"]["amount"]["origins"][0].update(signed=True)),
    ("boolean-trust", lambda r: r["facts"]["amount"]["origins"][0].update(trustLevel=True)),
    ("fractional-priority", lambda r: r["facts"]["amount"]["origins"][0].update(priority=50.5)),
    ("string-signature-proof", lambda r: r["facts"]["amount"]["origins"][0].update(signatureVerified="true")),
    ("empty-origins", lambda r: r["facts"]["amount"].update(origins=[])),
    ("malformed-unused-fact", lambda r: r["facts"].update({"extra": {"value": 1, "origins": []}})),
    ("unknown-edge-field", lambda r: r["transitions"][0].update(code="true")),
    ("boolean-edge-priority", lambda r: r["transitions"][0].update(priority=True)),
    ("fractional-edge-priority", lambda r: r["transitions"][0].update(priority=0.5)),
    ("null-condition", lambda r: r["transitions"][0].update(condition=None)),
    ("empty-capability", lambda r: r["attributes"].update({"transition-endpoints": "mcp://erp/"})),
    ("authority-glob", lambda r: r["attributes"].update({"transition-endpoints": "mcp://*/refund"})),
    ("partial-glob", lambda r: r["attributes"].update({"transition-endpoints": "mcp://erp/ref*"})),
    ("query-uri", lambda r: r["facts"]["amount"]["origins"][0].update(endpoint="mcp://erp/refund?x=1")),
    ("uri-control", lambda r: r["facts"]["amount"]["origins"][0].update(endpoint="mcp://erp/refund\u001c")),
    ("uri-unicode", lambda r: r["facts"]["amount"]["origins"][0].update(endpoint="mcp://erp/café")),
    ("uri-bom", lambda r: r["facts"]["amount"]["origins"][0].update(endpoint="mcp://erp/refund\ufeff")),
    ("empty-uri-list-item", lambda r: r["attributes"].update({"transition-endpoints": "mcp://erp/*,"})),
]:
    add(name, edit, error="INVALID_TRANSITION_REQUEST")
add("expression-byte-limit", expression(" " * 4097), error="TRANSITION_LIMIT_EXCEEDED")
add("nesting-limit", expression("(" * 33 + "true" + ")" * 33), error="TRANSITION_LIMIT_EXCEEDED")
add("unary-nesting-limit", expression("NOT " * 33 + "true"), error="TRANSITION_LIMIT_EXCEEDED")
add("token-limit", expression(" AND ".join(["true"] * 257)), error="TRANSITION_LIMIT_EXCEEDED")
add("edge-count-limit", lambda r: r.update(transitions=[{"target_node": "approve"}] * 257), error="TRANSITION_LIMIT_EXCEEDED")
add("origin-count-limit", lambda r: r["facts"]["amount"].update(origins=[fact(0)["origins"][0]] * 33), error="TRANSITION_LIMIT_EXCEEDED")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = ROOT / "conformance/vectors/transitions/profile-0.1.json"
    content = json.dumps({"profile": PROFILE, "cases": CASES}, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if target.read_text(encoding="utf-8") != content:
            raise SystemExit("Transition vectors are stale")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
    print(f"{len(CASES)} shared transition cases")
