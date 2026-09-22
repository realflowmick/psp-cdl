# SPDX-License-Identifier: Apache-2.0
"""Finite, deterministic CDL policy functions. Callers supply authenticated facts."""
import re
from typing import Any, Literal, TypedDict

from psp_cdl_core import PspError, canonical_json, parse_json, validate_json
from ._tables import TABLE, ENFORCEMENT

CDL_PROFILE = "CDL-DETERMINISTIC-1.0"
KINDS = ("classes", "covenants", "capabilities")
REGISTRY = {"classes": set(TABLE["classes"]), "covenants": {r["term"] for r in TABLE["rules"] if r["kind"] == "covenant"}, "capabilities": set(TABLE["capabilities"])}
MISSING = object()


class Decision(TypedDict):
    decision: Literal["allow", "deny", "unsupported"]
    reasonCodes: list[str]


def _result(codes: list[str]) -> Decision:
    return {"decision": ("unsupported" if any(c in ("UNSUPPORTED_TERM", "UNSUPPORTED_SCHEMA") for c in codes) else "deny") if codes else "allow", "reasonCodes": codes}


def _ordered(codes) -> Decision:
    values = set(codes)
    for stage in TABLE["reasonStages"]:
        found = [c for c in stage if c in values]
        if found:
            return _result(found)
    return _result(["INVALID_CONTEXT"] if values else [])


def _tokens(kind: str, value: Any) -> list[str]:
    if kind not in KINDS:
        raise PspError("INVALID_DECLARATION")
    if value is MISSING:
        return []
    if type(value) is str:
        raw = [t for t in re.split(r"[\t\n\v\f\r ]+", value) if t]
        text = value
    elif type(value) is list and all(type(v) is str for v in value):
        raw, text = value, "".join(value)
    else:
        raise PspError("INVALID_DECLARATION")
    try:
        if len(text.encode("utf-8")) > 65_536 or len(raw) > 1_024:
            raise PspError("LIMIT_EXCEEDED")
    except UnicodeError as exc:
        raise PspError("INVALID_DECLARATION") from exc
    out = set()
    for token in raw:
        token = token.strip("\t\n\v\f\r ").translate(str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"))
        if not token:
            continue
        if len(token) > 128:
            raise PspError("LIMIT_EXCEEDED")
        if re.fullmatch(r"!?[a-z0-9]+(?:-[a-z0-9]+)*", token) is None or (token.startswith("!") and kind != "covenants"):
            raise PspError("INVALID_DECLARATION")
        out.add(token)
    if any(t.startswith("!") and t[1:] in out for t in out):
        raise PspError("CONTRADICTORY_DECLARATION")
    return sorted(out)


def _supported(kind: str, values: list[str]) -> None:
    if any(t.removeprefix("!") not in REGISTRY[kind] for t in values):
        raise PspError("UNSUPPORTED_TERM")


def normalize_declaration(kind: str, value: Any = MISSING) -> list[str]:
    terms = _tokens(kind, value)
    _supported(kind, terms)
    return terms


def serialize_declaration(kind: str, value: Any, format: str = "string") -> str | list[str]:
    if format not in ("string", "array"):
        raise PspError("INVALID_OPTION")
    terms = normalize_declaration(kind, value)
    return terms if format == "array" else " ".join(terms)


def parse_declarations(value: Any) -> dict[str, list[str]]:
    if type(value) is not dict:
        raise PspError("INVALID_DECLARATION")
    data = validate_json(value)
    output = {k: _tokens(k, data.get("x-cdl-" + k, MISSING)) for k in KINDS}
    for kind, terms in output.items():
        _supported(kind, terms)
    return output


def with_declarations(value: Any, declarations: dict, format: str = "array") -> dict:
    result = validate_json(value)
    if type(result) is not dict:
        raise PspError("INVALID_DECLARATION")
    for kind in KINDS:
        result["x-cdl-" + kind] = serialize_declaration(kind, declarations.get(kind, MISSING), format)
    return result


def parse_cdl_json(source: str) -> dict:
    value = parse_json(source)
    if type(value) is not dict:
        raise PspError("INVALID_DECLARATION")
    return value


def serialize_cdl_json(value: Any) -> str:
    if type(value) is not dict:
        raise PspError("INVALID_DECLARATION")
    return canonical_json(value)


def valid_pointer(value: str) -> bool:
    return type(value) is str and (value == "" or (value.startswith("/") and re.search(r"~(?![01])", value) is None))


def inherit_policy(path: list[dict], grants: list[dict] | None = None) -> dict:
    grants = [] if grants is None else grants
    validate_json({"path": path, "grants": grants})
    if type(path) is not list or type(grants) is not list:
        raise PspError("INVALID_DECLARATION")
    if len(path) > 64:
        raise PspError("LIMIT_EXCEEDED")
    seen = set()
    parsed = []
    for node in path:
        if type(node) is not dict or type(node.get("id")) is not str or not node["id"] or not valid_pointer(node.get("path")) or node["id"] in seen:
            raise PspError("INVALID_CONTEXT")
        seen.add(node["id"])
        parsed.append({**node, "classes": _tokens("classes", node.get("classes", MISSING)), "covenants": _tokens("covenants", node.get("covenants", MISSING))})
    for node in parsed:
        _supported("classes", node["classes"])
        _supported("covenants", node["covenants"])
    for grant in grants:
        if type(grant) is not dict or type(grant.get("sourceId")) is not str or type(grant.get("term")) is not str or not valid_pointer(grant.get("atPath")):
            raise PspError("INVALID_CONTEXT")
    classes: set[str] = set()
    origins: dict[str, set[str]] = {}
    for node in parsed:
        classes.update(node["classes"])
        for negation in (t for t in node["covenants"] if t.startswith("!")):
            term = negation[1:]
            if not origins.get(term):
                raise PspError("INVALID_NEGATION")
            if any(not any(g["sourceId"] == origin and g["term"] == term and g["atPath"] == node["path"] for g in grants) for origin in origins[term]):
                raise PspError("UNAUTHORIZED_NEGATION")
            del origins[term]
        for term in (t for t in node["covenants"] if not t.startswith("!")):
            origins.setdefault(term, set()).add(node["id"])
    basis_terms = {r["term"] for r in TABLE["rules"] if r.get("group") == "article6"}
    groups: dict[str, set[str]] = {}
    for term, sources in origins.items():
        if term in basis_terms:
            for origin in sources:
                groups.setdefault(origin, set()).add(term)
    return {"classes": sorted(classes), "covenants": sorted(origins), "origins": {t: sorted(v) for t, v in sorted(origins.items())}, "basisGroups": [{"origin": origin, "terms": sorted(terms)} for origin, terms in sorted(groups.items())]}


def aggregate_capabilities(sources: list[dict], complete: bool) -> list[str]:
    validate_json({"sources": sources, "complete": complete})
    if type(sources) is not list or type(complete) is not bool:
        raise PspError("INVALID_DECLARATION")
    if len(sources) > 1_024:
        raise PspError("LIMIT_EXCEEDED")
    all_terms = []
    for source in sources:
        if type(source) is not dict or type(source.get("id")) is not str:
            raise PspError("INVALID_DECLARATION")
        all_terms.append(_tokens("capabilities", source.get("capabilities", MISSING)))
    for terms in all_terms:
        _supported("capabilities", terms)
    if not complete:
        raise PspError("INCOMPLETE_CAPABILITIES")
    caps = {t for terms in all_terms for t in terms}
    todo = list(caps)
    while todo:
        term = todo.pop()
        for implied in TABLE["implications"].get(term, []):
            if implied not in caps:
                caps.add(implied)
                todo.append(implied)
    return sorted(caps)


def evaluate_policy(value: dict) -> Decision:
    try:
        return _evaluate(value)
    except PspError as exc:
        known = {r for stage in TABLE["reasonStages"] for r in stage}
        return _ordered([exc.code if exc.code in known else "INVALID_DECLARATION"])


def _evaluate(value: dict) -> Decision:
    data = validate_json(value)
    if type(data) is not dict:
        raise PspError("INVALID_DECLARATION")
    classes = _tokens("classes", data.get("classes", MISSING))
    covenants = _tokens("covenants", data.get("covenants", MISSING))
    capabilities = _tokens("capabilities", data.get("capabilities", MISSING))
    for kind, terms in (("classes", classes), ("covenants", covenants), ("capabilities", capabilities)):
        _supported(kind, terms)
    checks, params, context = (data.get(k) for k in ("checks", "parameters", "context"))
    if any(type(v) is not dict for v in (checks, params, context)) or any(v not in ("satisfied", "failed", "unknown") for v in checks.values()):
        raise PspError("INVALID_CONTEXT")
    for record, allowed in ((params, {"allowedRoles", "allowedJurisdictions"}), (context, {"roles", "processingJurisdictions"})):
        if set(record) - allowed or any(type(v) is not list or any(type(t) is not str or not t for t in v) for v in record.values()):
            raise PspError("INVALID_CONTEXT")
    if any(t.startswith("!") for t in covenants):
        raise PspError("INVALID_NEGATION")
    caps = set(aggregate_capabilities([{"id": "bound-invocation", "capabilities": capabilities}], True))
    roles, places = context.get("roles"), context.get("processingJurisdictions")
    allowed_roles, allowed_places = params.get("allowedRoles"), params.get("allowedJurisdictions")
    if places is not None and (any(c.startswith("processes-in-jurisdiction-") and c.removeprefix("processes-in-jurisdiction-") not in places for c in caps) or any(p not in ("eu", "us") for p in places)):
        raise PspError("INVALID_CONTEXT")
    active = [r for r in TABLE["rules"] if r["term"] in (classes if r["kind"] == "class" else covenants)]
    errors: set[str] = set()

    def any_cap(terms):
        return bool(caps.intersection(terms))

    def met(rule):
        return (not rule.get("requireAll") or caps.issuperset(rule["requireAll"])) and (not rule.get("requireAny") or any_cap(rule["requireAny"]))

    for rule in active:
        if rule.get("forbidProcessing"):
            errors.add("PROCESSING_PROHIBITED")
        conditional = rule.get("conflictUnless")
        if any_cap(rule.get("conflictAny", [])) or (conditional and any_cap(conditional["any"]) and not any_cap(conditional["unlessAny"])):
            errors.add("CAPABILITY_CONFLICT")
    if errors:
        return _ordered(errors)
    for rule in (r for r in active if not r.get("group")):
        if rule.get("parameter") == "roles":
            if not allowed_roles or roles is None:
                errors.add("MISSING_CONTEXT")
                continue
            if not set(roles).intersection(allowed_roles):
                errors.add("ROLE_MISMATCH")
                continue
        if rule.get("parameter") == "jurisdictions":
            if not allowed_places or not places:
                errors.add("MISSING_CONTEXT")
                continue
            if not set(places).issubset(allowed_places):
                errors.add("JURISDICTION_MISMATCH")
                continue
            if any("processes-in-jurisdiction-" + p not in caps for p in places):
                errors.add("REQUIREMENT_UNSATISFIED")
                continue
        if not met(rule):
            errors.add("REQUIREMENT_UNSATISFIED")
            continue
        if rule.get("check") and (not rule.get("checkWhenAny") or any_cap(rule["checkWhenAny"])) and checks.get(rule["check"]) != "satisfied":
            errors.add("CHECK_UNSATISFIED")
    bases = [r for r in active if r.get("group") == "article6"]
    if bases and not any(met(r) and checks.get(r["check"]) == "satisfied" for r in bases):
        errors.add("LEGAL_BASIS_UNSATISFIED")
    return _ordered(errors)


def evaluate_batch(resources: list[dict]) -> Decision:
    if type(resources) is not list or not resources:
        return _result(["INVALID_DECLARATION"])
    if len(resources) > 1_024:
        return _result(["LIMIT_EXCEEDED"])
    return _ordered(c for resource in resources for c in evaluate_policy(resource)["reasonCodes"])


def check_enforcement(topology: str, minimum_topology: str, gates: list[str]) -> Decision:
    order = ENFORCEMENT["topologyOrder"]
    if topology not in order or minimum_topology not in order or type(gates) is not list or any(type(g) is not str or g not in ENFORCEMENT["requiredGates"]["C"] for g in gates):
        return _result(["INVALID_CONTEXT"])
    if order.index(topology) < max(1, order.index(minimum_topology)):
        return _result(["TOPOLOGY_INSUFFICIENT"])
    return _result(["MEDIATION_INCOMPLETE"] if set(ENFORCEMENT["requiredGates"][topology]) - set(gates) else [])


def evaluate_resolved_policy(state: dict, facts_by_origin: dict[str, dict], class_facts: dict) -> Decision:
    """Keep inherited origin groups and parameters separate; never flatten permissions."""
    try:
        validate_json({"state": state, "factsByOrigin": facts_by_origin, "classFacts": class_facts})
        if type(state) is not dict or type(state.get("classes")) is not list or type(state.get("covenants")) is not list or type(state.get("origins")) is not dict or type(facts_by_origin) is not dict or type(class_facts) is not dict or any(type(t) is not str for t in state["classes"] + state["covenants"]) or any(type(f) is not dict for f in facts_by_origin.values()):
            return _result(["INVALID_CONTEXT"])
        if set(state["origins"]) - set(state["covenants"]):
            return _result(["INVALID_CONTEXT"])
        grouped: dict[str, list[str]] = {}
        for term in state["covenants"]:
            origins = state["origins"].get(term)
            if type(origins) is not list or not origins or any(type(o) is not str or not o for o in origins):
                return _result(["INVALID_CONTEXT"])
            for origin in origins:
                grouped.setdefault(origin, []).append(term)
        decisions = [evaluate_policy({**class_facts, "classes": state["classes"], "covenants": []})]
        for origin, covenants in grouped.items():
            decisions.append(evaluate_policy({**facts_by_origin[origin], "classes": [], "covenants": covenants}) if origin in facts_by_origin else _result(["MISSING_CONTEXT"]))
        return _ordered(c for decision in decisions for c in decision["reasonCodes"])
    except PspError as exc:
        return _ordered([exc.code])


def resolve_schema_policy(value: Any, data_pointer: str, grants: list[dict] | None = None, source_id: str = "schema") -> dict:
    schema = validate_json(value)
    if type(source_id) is not str or not source_id or not valid_pointer(data_pointer):
        raise PspError("INVALID_CONTEXT")
    segments = [] if data_pointer == "" else [s.replace("~1", "/").replace("~0", "~") for s in data_pointer[1:].split("/")]
    unsupported = {"$ref", "$dynamicRef", "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "dependentSchemas", "prefixItems", "contains", "patternProperties", "unevaluatedProperties", "unevaluatedItems", "additionalItems", "dependencies", "propertyNames", "contentSchema"}
    current, pointer, path = schema, "", []
    for i in range(len(segments) + 1):
        if current is True:
            current = {}
        if type(current) is not dict or set(current).intersection(unsupported) or type(current.get("items")) is list or type(current.get("additionalProperties")) is dict:
            raise PspError("UNSUPPORTED_SCHEMA")
        node = {"id": source_id + "#" + pointer, "path": pointer}
        for kind in ("classes", "covenants"):
            if "x-cdl-" + kind in current:
                node[kind] = current["x-cdl-" + kind]
        path.append(node)
        if i == len(segments):
            break
        part = segments[i]
        if current.get("type") == "array" or "items" in current:
            if re.fullmatch(r"0|[1-9][0-9]*", part) is None:
                raise PspError("INVALID_CONTEXT")
            current = current.get("items", {})
            pointer += "/items"
        else:
            props = current.get("properties", {})
            if type(props) is not dict:
                raise PspError("UNSUPPORTED_SCHEMA")
            if part not in props and current.get("additionalProperties") is False:
                raise PspError("INVALID_CONTEXT")
            current = props.get(part, {})
            pointer += "/properties/" + part.replace("~", "~0").replace("/", "~1")
    return inherit_policy(path, grants)


def policy_table() -> dict:
    return validate_json(TABLE)
