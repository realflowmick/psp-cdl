# SPDX-License-Identifier: Apache-2.0
"""Deterministic host-side transitions; facts must have authenticated provenance."""
import re
from .json_codec import PspError, canonical_json, parse_json, validate_json

TRANSITION_PROFILE = "PSP-TRANSITIONS-0.1"


def _fail(code):
    raise PspError(code)


def _id(value):
    return type(value) is str and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,127}", value) is not None


def _path(value):
    return (len(value) <= 256 and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*", value) is not None
            and len(value.split(".")) <= 16 and not {"__proto__", "prototype", "constructor"}.intersection(value.split(".")))


def _exact(value, required, optional=()):
    return type(value) is dict and set(required) <= value.keys() and value.keys() <= set(required) | set(optional)


def _tokens(source):
    if len(source.encode("utf-8")) > 4096:
        _fail("TRANSITION_LIMIT_EXCEEDED")
    tokens, i = [], 0
    while i < len(source):
        c = source[i]
        if c in " \t\r\n":
            i += 1
            continue
        if len(tokens) >= 512:
            _fail("TRANSITION_LIMIT_EXCEEDED")
        if c in "\"'":
            start, quote = i, c
            i += 1
            value, closed = "", False
            while i < len(source):
                next_char = source[i]
                i += 1
                if next_char == quote:
                    closed = True
                    break
                if next_char == "\\":
                    if i == len(source):
                        _fail("UNSUPPORTED_CONDITION")
                    escaped = source[i]
                    i += 1
                    if quote == "'" and escaped not in "'\\":
                        _fail("UNSUPPORTED_CONDITION")
                    value += escaped
                else:
                    if ord(next_char) < 32:
                        _fail("UNSUPPORTED_CONDITION")
                    value += next_char
            if not closed:
                _fail("UNSUPPORTED_CONDITION")
            if quote == '"':
                try:
                    value = parse_json(source[start:i])
                except PspError:
                    _fail("UNSUPPORTED_CONDITION")
            tokens.append(("literal", value))
            continue
        rest = source[i:]
        number = re.match(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", rest)
        if number:
            try:
                value = parse_json(number[0])
            except PspError:
                _fail("UNSUPPORTED_CONDITION")
            tokens.append(("literal", value))
            i += len(number[0])
            continue
        word = re.match(r"[A-Za-z_][A-Za-z0-9_.]*", rest)
        if word:
            value = word[0]
            i += len(value)
            if value in ("true", "false", "null"):
                tokens.append(("literal", None if value == "null" else value == "true"))
            elif value in ("AND", "OR", "NOT"):
                tokens.append(("symbol", value))
            else:
                if not _path(value):
                    _fail("UNSUPPORTED_CONDITION")
                tokens.append(("fact", value))
            continue
        symbol = re.match(r"(?:==|!=|<=|>=|[<>()])", rest)
        if not symbol:
            _fail("UNSUPPORTED_CONDITION")
        tokens.append(("symbol", symbol[0]))
        i += len(symbol[0])
    return tokens


def _compile(source):
    tokens, references, i = _tokens(source), set(), 0

    def accept(op):
        nonlocal i
        if i < len(tokens) and tokens[i] == ("symbol", op):
            i += 1
            return True
        return False

    def primary(depth):
        nonlocal i
        if depth > 32:
            _fail("TRANSITION_LIMIT_EXCEEDED")
        if accept("NOT"):
            return ("operator", "NOT", primary(depth + 1))
        if accept("("):
            result = disjunction(depth + 1)
            if not accept(")"):
                _fail("UNSUPPORTED_CONDITION")
            return result
        token = tokens[i] if i < len(tokens) else None
        i += 1
        if token and token[0] == "literal":
            return token
        if token and token[0] == "fact":
            references.add(token[1])
            return token
        _fail("UNSUPPORTED_CONDITION")

    def compare(depth):
        nonlocal i
        left = primary(depth)
        op = tokens[i] if i < len(tokens) else None
        if op and op[0] == "symbol" and op[1] in ("==", "!=", "<", "<=", ">", ">="):
            i += 1
            return ("operator", op[1], left, primary(depth))
        return left

    def conjunction(depth):
        left = compare(depth)
        while accept("AND"):
            left = ("operator", "AND", left, compare(depth))
        return left

    def disjunction(depth):
        left = conjunction(depth)
        while accept("OR"):
            left = ("operator", "OR", left, conjunction(depth))
        return left

    expression = disjunction(0)
    if i != len(tokens):
        _fail("UNSUPPORTED_CONDITION")
    return expression, sorted(references)


def _evaluate(expression, values):
    kind, value = expression[:2]
    if kind == "literal":
        return value
    if kind == "fact":
        return values[value]
    a = _evaluate(expression[2], values)
    if value == "NOT":
        if type(a) is not bool:
            _fail("INVALID_CONDITION_TYPE")
        return not a
    b = _evaluate(expression[3], values)
    if value in ("AND", "OR"):
        if type(a) is not bool or type(b) is not bool:
            _fail("INVALID_CONDITION_TYPE")
        return (a and b) if value == "AND" else (a or b)
    if value in ("==", "!="):
        same_type = type(a) is type(b) or (type(a) in (int, float) and type(b) in (int, float))
        equal = same_type and a == b
        return equal if value == "==" else not equal
    if type(a) not in (int, float) or type(b) not in (int, float):
        _fail("INVALID_CONDITION_TYPE")
    return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[value]


def _endpoint(value, pattern=False):
    if type(value) is not str or len(value) > 2048 or re.search(r"[^\x21-\x7e]|[?#]", value):
        _fail("INVALID_TRANSITION_REQUEST")
    match = re.fullmatch(r"([A-Za-z][A-Za-z0-9+.-]*)://([^/*]+)/([^*]+|\*)", value)
    if not match or (not pattern and match[3] == "*"):
        _fail("INVALID_TRANSITION_REQUEST")
    return (match[1].lower(), match[2], match[3])


def _constraints(attributes):
    names = {"transition-trust", "transition-endpoints", "transition-max-trust-level", "transition-min-priority", "transition-require-signature"}
    if any(type(v) is not str or (k.startswith("transition-") and k not in names) for k, v in attributes.items()):
        _fail("INVALID_TRANSITION_REQUEST")
    presets = {"governance-only": (2, 70, True), "verified": (3, 50, False),
               "include-user": (4, 30, False), "permissive": (5, 0, False)}
    preset = attributes.get("transition-trust", "verified")
    if preset not in presets:
        _fail("INVALID_TRANSITION_REQUEST")
    trust, priority, signed = presets[preset]

    def integer(key, fallback, maximum):
        if key not in attributes:
            return fallback
        value = attributes[key]
        if not re.fullmatch(r"0|[1-9][0-9]*", value) or len(value) > 3 or int(value) > maximum:
            _fail("INVALID_TRANSITION_REQUEST")
        return int(value)

    trust = integer("transition-max-trust-level", trust, 5)
    priority = integer("transition-min-priority", priority, 100)
    if "transition-require-signature" in attributes:
        value = attributes["transition-require-signature"]
        if value not in ("true", "false"):
            _fail("INVALID_TRANSITION_REQUEST")
        signed = value == "true"
    endpoints = None
    if "transition-endpoints" in attributes:
        text = attributes["transition-endpoints"]
        endpoints = [] if text == "" else [_endpoint(x.strip(" \t\r\n"), True) for x in text.split(",")]
        if len(endpoints) > 1024:
            _fail("TRANSITION_LIMIT_EXCEEDED")
    return trust, priority, signed, endpoints


def _prepare_transition_definitions(node_id, siblings, transitions):
    compiled = []
    for index, edge in enumerate(transitions):
        if (not _exact(edge, ("target_node",), ("source_node", "condition", "priority")) or not _id(edge["target_node"])
                or ("source_node" in edge and not _id(edge["source_node"]))
                or ("condition" in edge and type(edge["condition"]) is not str)
                or ("priority" in edge and (type(edge["priority"]) not in (int, float) or edge["priority"] % 1 != 0))):
            _fail("INVALID_TRANSITION_REQUEST")
        source = edge.get("source_node", node_id)
        if source not in siblings or edge["target_node"] not in siblings:
            _fail("TRANSITION_SCOPE_VIOLATION")
        expression, references = _compile(edge.get("condition", "true"))
        compiled.append((edge.get("priority", 0), index, source, edge["target_node"], expression, references))
    return compiled


def select_transition(value):
    """Select a same-scope edge; no state mutation, I/O or model authority."""
    value = validate_json(value)
    if len(canonical_json(value).encode("utf-8")) > 1_048_576:
        _fail("TRANSITION_LIMIT_EXCEEDED")
    if (not _exact(value, ("profile", "nodeId", "completed", "siblings", "attributes", "transitions", "facts"))
            or value["profile"] != TRANSITION_PROFILE or not _id(value["nodeId"]) or type(value["completed"]) is not bool
            or type(value["siblings"]) is not list or type(value["attributes"]) is not dict
            or type(value["transitions"]) is not list or type(value["facts"]) is not dict):
        _fail("INVALID_TRANSITION_REQUEST")
    node_id, siblings, transitions, facts = (value[k] for k in ("nodeId", "siblings", "transitions", "facts"))
    if len(siblings) > 1024 or len(transitions) > 256 or len(facts) > 1024:
        _fail("TRANSITION_LIMIT_EXCEEDED")
    if not siblings or any(not _id(x) for x in siblings) or len(set(siblings)) != len(siblings) or node_id not in siblings:
        _fail("INVALID_TRANSITION_REQUEST")
    trust, priority, signed, endpoints = _constraints(value["attributes"])
    admitted = {}
    for name, fact in facts.items():
        if (not _path(name) or not _exact(fact, ("value", "origins"))
                or type(fact["origins"]) is not list or not fact["origins"]):
            _fail("INVALID_TRANSITION_REQUEST")
        if len(fact["origins"]) > 32:
            _fail("TRANSITION_LIMIT_EXCEEDED")
        qualified = True
        for origin in fact["origins"]:
            if (not _exact(origin, ("endpoint", "trustLevel", "priority", "signatureVerified"))
                    or type(origin["trustLevel"]) not in (int, float) or origin["trustLevel"] % 1 != 0 or not 0 <= origin["trustLevel"] <= 5
                    or type(origin["priority"]) not in (int, float) or origin["priority"] % 1 != 0 or not 0 <= origin["priority"] <= 100
                    or type(origin["signatureVerified"]) is not bool):
                _fail("INVALID_TRANSITION_REQUEST")
            uri = _endpoint(origin["endpoint"])
            qualified = (qualified and origin["trustLevel"] <= trust and origin["priority"] >= priority
                         and (not signed or origin["signatureVerified"])
                         and (endpoints is None or any(p[:2] == uri[:2] and p[2] in ("*", uri[2]) for p in endpoints)))
        admitted[name] = (fact["value"], qualified)
    compiled = _prepare_transition_definitions(node_id, siblings, transitions)
    if not value["completed"]:
        _fail("NODE_INCOMPLETE")
    compiled.sort(key=lambda edge: (-edge[0], edge[1]))
    for _, index, source, target, expression, references in compiled:
        if source != node_id:
            continue
        values = {}
        for name in references:
            if name not in admitted or not admitted[name][1]:
                _fail("INSUFFICIENT_QUALIFIED_DATA")
            fact = admitted[name][0]
            if fact is not None and type(fact) not in (str, int, float, bool):
                _fail("INVALID_CONDITION_TYPE")
            values[name] = fact
        result = _evaluate(expression, values)
        if type(result) is not bool:
            _fail("INVALID_CONDITION_TYPE")
        if result:
            return {"profile": TRANSITION_PROFILE, "transitionIndex": index, "sourceNode": node_id,
                    "targetNode": target, "usedFacts": references}
    _fail("NO_TRANSITION")
