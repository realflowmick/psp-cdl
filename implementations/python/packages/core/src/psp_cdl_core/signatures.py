# SPDX-License-Identifier: Apache-2.0
"""Signature profile data conversion; cryptography is a separate module."""
import base64
import math
import re
from typing import Any

from .json_codec import MAX_INTEGER, PspError, canonical_json, parse_json, validate_json
from .markup import Document, Section, document_from_object, document_to_object

SIGNATURE_PROFILE = "PSP-SIGNATURE-2.0"
ATTRIBUTE_MAP = {"signature": "value", "signature-algorithm": "algorithm", "signature-version": "signatureVersion", "kid": "kid", "secret-id": "secretId", "timestamp": "timestamp", "expires": "expires", "version": "version", "trust-level": "trustLevel", "priority": "priority", "type": "sectionType", "content-type": "contentType"}
RESERVED = set(ATTRIBUTE_MAP) | set(ATTRIBUTE_MAP.values()) | {"attributes"}
SEMVER = re.compile(r"v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?")


def integer(value: Any, minimum: int, maximum: int) -> bool:
    if type(value) is int:
        return minimum <= value <= maximum
    return type(value) is float and math.isfinite(value) and value == int(value) and minimum <= value <= maximum


def canonical_version(value: str) -> str:
    if type(value) is not str or SEMVER.fullmatch(value) is None:
        raise PspError("INVALID_VERSION")
    return value.removeprefix("v")


def envelope_from_object(value: Any) -> dict:
    e = validate_json(value)
    if type(e) is not dict:
        raise PspError("INVALID_ENVELOPE")
    sk, dk = ("x-signature", "x-data") if "x-signature" in e else ("signature", "data")
    if set(e) != {sk, dk} or type(e[sk]) is not dict:
        raise PspError("INVALID_ENVELOPE")
    s = e[sk]
    if set(s) - (set(ATTRIBUTE_MAP.values()) | {"attributes"}):
        raise PspError("INVALID_ENVELOPE")
    if s.get("signatureVersion") != "2.0":
        raise PspError("UNSUPPORTED_PROFILE")
    if s.get("algorithm") not in ("ed25519", "hmac-sha256"):
        raise PspError("UNSUPPORTED_ALGORITHM")
    if type(s.get("value")) is not str or re.fullmatch(r"[A-Za-z0-9_-]+", s["value"]) is None:
        raise PspError("INVALID_ENCODING")
    key, forbidden = ("kid", "secretId") if s["algorithm"] == "ed25519" else ("secretId", "kid")
    if type(s.get(key)) is not str or not s[key] or forbidden in s:
        raise PspError("INVALID_ENVELOPE")
    if not integer(s.get("timestamp"), 0, MAX_INTEGER) or not integer(s.get("expires"), 0, MAX_INTEGER):
        raise PspError("INVALID_TIME")
    canonical_version(s.get("version"))
    if type(s.get("sectionType")) is not str or re.fullmatch(r"[a-z][a-z0-9-]*", s["sectionType"]) is None:
        raise PspError("INVALID_SECTION_TYPE")
    if "trustLevel" in s and not integer(s["trustLevel"], 0, 5):
        raise PspError("INVALID_TRUST_LEVEL")
    if "priority" in s and (type(s["priority"]) not in (int, float) or not math.isfinite(s["priority"]) or not 0 <= s["priority"] <= 100):
        raise PspError("INVALID_PRIORITY")
    if "attributes" in s and (type(s["attributes"]) is not dict or any(k in RESERVED or type(v) is not str for k, v in s["attributes"].items())):
        raise PspError("INVALID_ATTRIBUTE")
    if s.get("contentType") == "text":
        if type(e[dk]) is not str:
            raise PspError("INVALID_CONTENT")
    elif s.get("contentType") != "json" or type(e[dk]) not in (dict, list):
        raise PspError("INVALID_CONTENT")
    return {"signature": s, "data": e[dk]}


def parse_envelope(source: str) -> dict:
    return envelope_from_object(parse_json(source))


def serialize_envelope(value: dict, aliases: bool = False) -> str:
    e = envelope_from_object(value)
    return canonical_json({"x-signature": e["signature"], "x-data": e["data"]} if aliases else e)


def protected_content(value: dict) -> str:
    e = envelope_from_object(value)
    s = e["signature"]
    metadata = {k: v for k, v in s.items() if k not in ("value", "timestamp", "version")}
    metadata.setdefault("trustLevel", 2)
    metadata.setdefault("priority", 50)
    metadata.setdefault("attributes", {})
    data = e["data"]
    if s["contentType"] == "text":
        data = data.replace("\r\n", "\n").replace("\r", "\n").strip("\t\n ")
    return canonical_json({"data": data, "metadata": metadata})


def signature_input(value: dict) -> bytes:
    e = envelope_from_object(value)
    return (protected_content(e) + "|" + str(int(e["signature"]["timestamp"])) + "|" + canonical_version(e["signature"]["version"])).encode("utf-8")


def encode_signature(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode_signature(value: str, algorithm: str) -> bytes:
    if type(value) is not str or re.fullmatch(r"[A-Za-z0-9_-]+", value) is None or algorithm not in ("ed25519", "hmac-sha256"):
        raise PspError("INVALID_ENCODING")
    try:
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except ValueError as exc:
        raise PspError("INVALID_ENCODING") from exc
    if len(decoded) != (64 if algorithm == "ed25519" else 32) or encode_signature(decoded) != value:
        raise PspError("INVALID_ENCODING")
    return decoded


def validate_time(timestamp: Any, expires: Any, now: float, skew: int = 0) -> str:
    if not integer(timestamp, 0, MAX_INTEGER) or not integer(expires, 0, MAX_INTEGER) or expires <= timestamp or not integer(skew, 0, 300) or type(now) not in (int, float) or abs(now) > MAX_INTEGER or not math.isfinite(now):
        return "invalid"
    if now >= expires:
        return "expired"
    return "not_yet_valid" if now < timestamp - skew else "valid"


def section_to_envelope(value: Section) -> dict:
    children = document_from_object({"kind": "document", "children": [value]})["children"]
    if not children or children[0]["kind"] != "section":
        raise PspError("INVALID_SECTION_TYPE")
    section = children[0]
    if any(n["kind"] != "text" for n in section["children"]):
        raise PspError("NESTED_ENVELOPE_CONVERSION", "Use document-object transport for nested markup; flattening changes its interpretation.")
    s, attrs = {}, {}
    for key, val in section["attributes"].items():
        if key not in ATTRIBUTE_MAP:
            attrs[key] = val
            continue
        target = ATTRIBUTE_MAP[key]
        if target in ("timestamp", "expires", "trustLevel"):
            if re.fullmatch(r"0|[1-9][0-9]*", val) is None:
                raise PspError("INVALID_NUMBER")
            s[target] = parse_json(val)
        elif target == "priority":
            s[target] = parse_json(val)
        else:
            s[target] = val
    if attrs:
        s["attributes"] = attrs
    body = "".join(n["value"] for n in section["children"])
    return envelope_from_object({"signature": s, "data": parse_json(body) if s.get("contentType") == "json" else body})


def envelope_to_section(value: dict) -> Section:
    e = envelope_from_object(value)
    s = e["signature"]
    attrs = {k: canonical_json(s[v]) if type(s[v]) in (int, float) else s[v] for k, v in ATTRIBUTE_MAP.items() if v in s}
    attrs.update(s.get("attributes", {}))
    body = e["data"] if s["contentType"] == "text" else canonical_json(e["data"])
    children = [{"kind": "text", "value": body}] if body else []
    return document_from_object({"kind": "document", "children": [{"kind": "section", "attributes": attrs, "children": children}]})["children"][0]


def document_envelope_data(document: Document, preserve_source: bool = True) -> dict:
    return document_to_object(document, preserve_source)


def envelope_to_document(value: dict) -> Document:
    e = envelope_from_object(value)
    if e["signature"]["contentType"] != "json":
        raise PspError("INVALID_CONTENT")
    return document_from_object(e["data"])
