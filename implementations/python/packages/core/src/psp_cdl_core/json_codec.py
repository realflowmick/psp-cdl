# SPDX-License-Identifier: Apache-2.0
"""Bounded, duplicate-aware JSON and RFC 8785 canonical serialization."""
import json
import math
import re
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
    # Validate tokens as encountered, before consuming later syntax. Native
    # object_pairs_hook runs too late to preserve duplicate/Unicode precedence.
    position = count = 0

    def fail(code="INVALID_JSON"):
        raise PspError(code, offset=len(source[:position].encode("utf-8")))

    def whitespace():
        nonlocal position
        while position < len(source) and source[position] in "\t\n\r ":
            position += 1

    def string():
        nonlocal position
        start = position
        position += 1
        while position < len(source):
            char = source[position]
            position += 1
            if char == '"':
                try:
                    result = json.loads(source[start:position])
                except json.JSONDecodeError:
                    fail()
                unicode_valid(result)
                return result
            if char == "\\":
                position += 1
        fail()

    def value(depth):
        nonlocal position, count
        count += 1
        if depth > MAX_DEPTH or count > MAX_VALUES:
            fail("LIMIT_EXCEEDED")
        whitespace()
        char = source[position:position+1]
        if char == '"':
            return string()
        if char in ("{", "["):
            position += 1
            whitespace()
            is_object = char == "{"
            end = "}" if is_object else "]"
            result = {} if is_object else []
            if source[position:position+1] == end:
                position += 1
                return result
            while position < len(source):
                whitespace()
                if is_object:
                    if source[position:position+1] != '"': fail()
                    key = string()
                    if key in result: fail("DUPLICATE_KEY")
                    whitespace()
                    char = source[position:position+1]
                    position += 1
                    if char != ":": fail()
                    result[key] = value(depth + 1)
                else:
                    result.append(value(depth + 1))
                whitespace()
                char = source[position:position+1]
                position += 1
                if char == end: return result
                if char != ",": fail()
            fail()
        for literal, parsed in (("true", True), ("false", False), ("null", None)):
            if source.startswith(literal, position):
                position += len(literal)
                return parsed
        match = re.match(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", source[position:])
        if not match: fail()
        token = match[0]
        position += len(token)
        fractional = any(c in token for c in ".eE")
        if not fractional and len(token.lstrip("-")) > 16: fail("INVALID_NUMBER")
        return validate_json(float(token) if fractional else int(token))

    result = value(0)
    whitespace()
    if position != len(source): fail()
    return result


def canonical_json(value: Any) -> str:
    try:
        output = rfc8785.dumps(validate_json(value))
        if len(output) > MAX_BYTES:
            raise PspError("LIMIT_EXCEEDED")
        return output.decode("utf-8")
    except rfc8785.CanonicalizationError as exc:
        raise PspError("INVALID_JSON_VALUE") from exc
