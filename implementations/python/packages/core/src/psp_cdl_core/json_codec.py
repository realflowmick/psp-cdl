# SPDX-License-Identifier: Apache-2.0
"""Bounded, duplicate-aware JSON and RFC 8785 canonical serialization."""
import json
import math
from typing import Any

import rfc8785

MAX_BYTES = 4_194_304
MAX_DEPTH = 256
MAX_VALUES = 100_000
MAX_INTEGER = 9_007_199_254_740_991


class PspError(ValueError):
    def __init__(self, code: str, message: str | None = None, offset: int | None = None):
        super().__init__(message or code)
        self.code = code
        self.offset = offset


def unicode_valid(value: str) -> None:
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise PspError("INVALID_UNICODE") from exc


def validate_json(value: Any) -> Any:
    count = 0
    size = 0
    active: set[int] = set()

    def walk(item: Any, depth: int) -> Any:
        nonlocal count, size
        count += 1
        if depth > MAX_DEPTH or count > MAX_VALUES:
            raise PspError("LIMIT_EXCEEDED")
        if item is None or type(item) is bool:
            return item
        if type(item) is str:
            unicode_valid(item)
            size += len(item.encode("utf-8"))
            if size > MAX_BYTES:
                raise PspError("LIMIT_EXCEEDED")
            return item
        if type(item) in (int, float):
            if type(item) is int:
                valid = abs(item) <= MAX_INTEGER
            else:
                valid = math.isfinite(item) and (not item.is_integer() or abs(item) <= MAX_INTEGER)
            if not valid:
                raise PspError("INVALID_NUMBER")
            return 0 if item == 0 else item
        if type(item) not in (dict, list):
            raise PspError("INVALID_JSON_VALUE")
        if id(item) in active:
            raise PspError("CYCLIC_VALUE")
        active.add(id(item))
        if type(item) is list:
            result = [walk(v, depth + 1) for v in item]
        else:
            result = {}
            for key, val in item.items():
                if type(key) is not str:
                    raise PspError("INVALID_JSON_VALUE")
                unicode_valid(key)
                size += len(key.encode("utf-8"))
                if size > MAX_BYTES:
                    raise PspError("LIMIT_EXCEEDED")
                result[key] = walk(val, depth + 1)
        active.remove(id(item))
        return result

    return walk(value, 0)


def parse_json(source: str) -> Any:
    if type(source) is not str:
        raise PspError("INVALID_JSON")
    unicode_valid(source)
    if len(source.encode("utf-8")) > MAX_BYTES:
        raise PspError("LIMIT_EXCEEDED")
    # Bound nesting before the native decoder sees adversarial nesting.
    quoted = escaped = False
    depth = 0
    for char in source:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > MAX_DEPTH + 1:
                raise PspError("LIMIT_EXCEEDED")
        elif char in "]}":
            depth -= 1

    def pairs(items: list[tuple[str, Any]]) -> dict:
        result = {}
        for key, value in items:
            if key in result:
                raise PspError("DUPLICATE_KEY")
            result[key] = value
        return result

    def number(token: str) -> int | float:
        if not any(c in token for c in ".eE") and len(token.lstrip("-")) > 16:
            raise PspError("INVALID_NUMBER")
        value = float(token) if any(c in token for c in ".eE") else int(token)
        return validate_json(value)

    def constant(_token: str) -> Any:
        raise PspError("INVALID_JSON")

    try:
        value = json.loads(source, object_pairs_hook=pairs, parse_int=number, parse_float=number, parse_constant=constant)
    except (json.JSONDecodeError, RecursionError) as exc:
        offset = len(source[:exc.pos].encode("utf-8")) if isinstance(exc, json.JSONDecodeError) else None
        raise PspError("INVALID_JSON", offset=offset) from exc
    return validate_json(value)


def canonical_json(value: Any) -> str:
    try:
        output = rfc8785.dumps(validate_json(value))
        if len(output) > MAX_BYTES:
            raise PspError("LIMIT_EXCEEDED")
        return output.decode("utf-8")
    except rfc8785.CanonicalizationError as exc:
        raise PspError("INVALID_JSON_VALUE") from exc
