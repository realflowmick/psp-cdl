# SPDX-License-Identifier: Apache-2.0
"""Reusable PSP markup/tree/object codec. Parsing conveys no authority."""
import json
import re
from typing import Any, Literal, NotRequired, TypedDict

from .json_codec import PspError, canonical_json, parse_json, unicode_valid, validate_json

CODEC_PROFILE = "PSP-CODEC-1.0"
MARKUP_LIMITS = {"maxBytes": 4_194_304, "maxDepth": 64, "maxNodes": 10_000, "maxAttributes": 256, "maxAttributeBytes": 65_536}
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.:-]*")
UNQUOTED = re.compile(r"[A-Za-z0-9_.-]+")
WHITE = "\t\n\r "


class TextNode(TypedDict):
    kind: Literal["text"]
    value: str


class Section(TypedDict):
    kind: Literal["section"]
    attributes: dict[str, str]
    children: list["TextNode | Section"]


class Document(TypedDict):
    kind: Literal["document"]
    profile: NotRequired[Literal["PSP-CODEC-1.0"]]
    children: list[TextNode | Section]
    source: NotRequired[str]


def _append(nodes: list, text: str) -> None:
    if text:
        if nodes and nodes[-1]["kind"] == "text":
            nodes[-1]["value"] += text
        else:
            nodes.append({"kind": "text", "value": text})


def _opening(source: str, pos: int) -> bool:
    return source.startswith("${psp", pos) and (pos + 5 == len(source) or source[pos + 5] in WHITE + "}/")


def parse_markup(source: str) -> Document:
    if type(source) is not str:
        raise PspError("INVALID_MARKUP")
    unicode_valid(source)
    if len(source.encode("utf-8")) > MARKUP_LIMITS["maxBytes"]:
        raise PspError("LIMIT_EXCEEDED")
    document: Document = {"kind": "document", "profile": CODEC_PROFILE, "children": [], "source": source}
    stack: list[dict] = [document]
    pos = count = 0
    fragments: list[str] = []

    def fail(code: str = "INVALID_MARKUP") -> Any:
        raise PspError(code, offset=len(source[:pos].encode("utf-8")))

    def flush() -> None:
        nonlocal count
        if fragments:
            _append(stack[-1]["children"], "".join(fragments))
            fragments.clear()
            count += 1
            if count > MARKUP_LIMITS["maxNodes"]:
                fail("LIMIT_EXCEEDED")

    while pos < len(source):
        if source[pos] == "\\" and (source.startswith("\\", pos + 1) or source.startswith("${psp", pos + 1) or source.startswith("${/psp", pos + 1)):
            fragments.append(source[pos + 1])
            pos += 2
            continue
        if source.startswith("${/psp", pos):
            flush()
            if not source.startswith("${/psp}", pos) or len(stack) == 1:
                fail("UNEXPECTED_CLOSE")
            stack.pop()
            pos += 7
            continue
        if not _opening(source, pos):
            fragments.append(source[pos])
            pos += 1
            continue
        flush()
        pos += 5
        attrs: dict[str, str] = {}
        self_closing = False
        while True:
            spaced = pos < len(source) and source[pos] in WHITE
            while pos < len(source) and source[pos] in WHITE:
                pos += 1
            if source.startswith("}", pos):
                pos += 1
                break
            if source.startswith("/}", pos):
                pos += 2
                self_closing = True
                break
            if not spaced:
                fail()
            match = NAME.match(source, pos)
            if match is None:
                fail()
            key = match[0]
            pos = match.end()
            if key in attrs:
                fail("DUPLICATE_ATTRIBUTE")
            if not source.startswith("=", pos):
                fail()
            pos += 1
            if source.startswith('"', pos):
                start = pos
                pos += 1
                ended = False
                while pos < len(source):
                    char = source[pos]
                    pos += 1
                    if char == '"':
                        ended = True
                        break
                    if char == "\\":
                        pos += 1
                if not ended:
                    fail()
                value = parse_json(source[start:pos])
            else:
                match = UNQUOTED.match(source, pos)
                if match is None:
                    fail()
                value = match[0]
                pos = match.end()
            if len(value.encode("utf-8")) > MARKUP_LIMITS["maxAttributeBytes"] or len(attrs) >= MARKUP_LIMITS["maxAttributes"]:
                fail("LIMIT_EXCEEDED")
            attrs[key] = value
        if "type" not in attrs or re.fullmatch(r"[a-z][a-z0-9-]*", attrs["type"]) is None:
            fail("INVALID_SECTION_TYPE")
        count += 1
        if count > MARKUP_LIMITS["maxNodes"] or len(stack) > MARKUP_LIMITS["maxDepth"]:
            fail("LIMIT_EXCEEDED")
        section: Section = {"kind": "section", "attributes": attrs, "children": []}
        stack[-1]["children"].append(section)
        if not self_closing:
            stack.append(section)
    flush()
    if len(stack) != 1:
        fail("UNCLOSED_SECTION")
    return document


def document_from_object(value: Any) -> Document:
    data = validate_json(value)
    if type(data) is not dict or data.get("kind") != "document" or type(data.get("children")) is not list or set(data) - {"kind", "profile", "children", "source"}:
        raise PspError("INVALID_DOCUMENT")
    if "profile" in data and data["profile"] != CODEC_PROFILE:
        raise PspError("UNSUPPORTED_PROFILE")
    count = 0

    def children(values: list, depth: int) -> list:
        nonlocal count
        if depth > MARKUP_LIMITS["maxDepth"]:
            raise PspError("LIMIT_EXCEEDED")
        result: list = []
        for node in values:
            count += 1
            if count > MARKUP_LIMITS["maxNodes"]:
                raise PspError("LIMIT_EXCEEDED")
            if type(node) is not dict:
                raise PspError("INVALID_DOCUMENT")
            if node.get("kind") == "text" and type(node.get("value")) is str and set(node) == {"kind", "value"}:
                _append(result, node["value"])
                continue
            if node.get("kind") != "section" or type(node.get("attributes")) is not dict or type(node.get("children")) is not list or set(node) != {"kind", "attributes", "children"}:
                raise PspError("INVALID_DOCUMENT")
            attrs = node["attributes"]
            if len(attrs) > MARKUP_LIMITS["maxAttributes"]:
                raise PspError("LIMIT_EXCEEDED")
            for key, item in attrs.items():
                if NAME.fullmatch(key) is None or type(item) is not str:
                    raise PspError("INVALID_ATTRIBUTE")
                if len(item.encode("utf-8")) > MARKUP_LIMITS["maxAttributeBytes"]:
                    raise PspError("LIMIT_EXCEEDED")
            if "type" not in attrs or re.fullmatch(r"[a-z][a-z0-9-]*", attrs["type"]) is None:
                raise PspError("INVALID_SECTION_TYPE")
            result.append({"kind": "section", "attributes": attrs, "children": children(node["children"], depth + 1)})
        return result

    document: Document = {"kind": "document", "profile": CODEC_PROFILE, "children": children(data["children"], 0)}
    if "source" in data:
        if type(data["source"]) is not str:
            raise PspError("INVALID_DOCUMENT")
        document["source"] = data["source"]
    return document


def document_to_object(document: Document, preserve_source: bool = True) -> Document:
    result = document_from_object(document)
    if not preserve_source:
        result.pop("source", None)
    return result


def document_to_json(document: Document, preserve_source: bool = True) -> str:
    return canonical_json(document_to_object(document, preserve_source))


def document_from_json(source: str) -> Document:
    return document_from_object(parse_json(source))


def serialize_markup(value: Document, mode: Literal["preserve", "canonical"] = "preserve") -> str:
    if mode not in ("preserve", "canonical"):
        raise PspError("INVALID_OPTION")
    document = document_from_object(value)
    if mode == "preserve" and "source" in document:
        try:
            if document_to_object(parse_markup(document["source"]), False) == document_to_object(document, False):
                return document["source"]
        except PspError:
            pass

    def emit(node: dict) -> str:
        if node["kind"] == "text":
            return re.sub(r"\$\{/?psp", lambda m: "\\" + m[0], node["value"].replace("\\", "\\\\"))
        attrs = " ".join(k + "=" + json.dumps(v, ensure_ascii=False, separators=(",", ":")) for k, v in sorted(node["attributes"].items()))
        if not node["children"]:
            return "${psp " + attrs + " /}"
        return "${psp " + attrs + "}" + "".join(emit(n) for n in node["children"]) + "${/psp}"

    result = "".join(emit(n) for n in document["children"])
    if len(result.encode("utf-8")) > MARKUP_LIMITS["maxBytes"]:
        raise PspError("LIMIT_EXCEEDED")
    return result
