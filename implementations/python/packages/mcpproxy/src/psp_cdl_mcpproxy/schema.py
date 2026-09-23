# SPDX-License-Identifier: Apache-2.0
"""Finite JSON Schema subset: unsupported keywords are never ignored."""
import math
from psp_cdl_core import canonical_json


def check_schema(schema, depth=0):
    fields = {"object":{"properties", "required", "additionalProperties"}, "array":{"items", "minItems", "maxItems"}, "string":{"minLength", "maxLength"}, "number":{"minimum", "maximum"}, "integer":{"minimum", "maximum"}, "boolean":set(), "null":set()}
    if type(schema) is not dict or depth > 16 or type(schema.get("type")) is not str or schema["type"] not in fields or set(schema) - ({"type", "enum"} | fields[schema["type"]]):
        raise ValueError("UNSUPPORTED_SCHEMA")
    if "enum" in schema and (type(schema["enum"]) is not list or not 1 <= len(schema["enum"]) <= 1024):
        raise ValueError("UNSUPPORTED_SCHEMA")
    if schema["type"] == "object":
        props, required = schema.get("properties"), schema.get("required")
        if type(props) is not dict or schema.get("additionalProperties") is not False or type(required) is not list or any(type(k) is not str or k not in props for k in required) or len(set(required)) != len(required):
            raise ValueError("UNSUPPORTED_SCHEMA")
        for child in props.values(): check_schema(child, depth + 1)
    if schema["type"] == "array": check_schema(schema.get("items"), depth + 1)
    for lo, hi in (("minItems", "maxItems"), ("minLength", "maxLength"), ("minimum", "maximum")):
        for k in (lo, hi):
            if k in schema:
                v = schema[k]
                if type(v) not in (int, float) or not math.isfinite(v) or (k not in ("minimum", "maximum") and (v < 0 or v > 9007199254740991 or int(v) != v)):
                    raise ValueError("UNSUPPORTED_SCHEMA")
        if lo in schema and hi in schema and schema[lo] > schema[hi]: raise ValueError("UNSUPPORTED_SCHEMA")


def matches(schema, value):
    if "enum" in schema and not any(canonical_json(v) == canonical_json(value) for v in schema["enum"]): return False
    def in_range(n, lo, hi): return (lo not in schema or n >= schema[lo]) and (hi not in schema or n <= schema[hi])
    kind = schema["type"]
    if kind == "object": return type(value) is dict and all(k in value for k in schema["required"]) and all(k in schema["properties"] and matches(schema["properties"][k], v) for k, v in value.items())
    if kind == "array": return type(value) is list and in_range(len(value), "minItems", "maxItems") and all(matches(schema["items"], v) for v in value)
    if kind == "string": return type(value) is str and in_range(len(value), "minLength", "maxLength")
    if kind in ("number", "integer"): return type(value) in (int, float) and math.isfinite(value) and (kind != "integer" or int(value) == value) and in_range(value, "minimum", "maximum")
    if kind == "boolean": return type(value) is bool
    if kind == "null": return value is None
    return False
