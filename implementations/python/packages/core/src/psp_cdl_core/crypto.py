# SPDX-License-Identifier: Apache-2.0
"""Cryptographic adapter; no network discovery or implicit trust store."""
import hashlib
import hmac
from typing import TypedDict, NotRequired

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .json_codec import PspError, validate_json
from .signatures import decode_signature, encode_signature, envelope_from_object, signature_input, validate_time, integer
from .markup import Document, document_to_object


class TrustedKey(TypedDict):
    id: str
    algorithm: str
    material: bytes
    status: str
    trustLevels: list[int]
    sectionTypes: list[str]
    scope: dict[str, str]
    allowUnscoped: bool


class VerificationPolicy(TypedDict):
    keys: list[TrustedKey]
    now: float
    context: dict[str, str]
    allowedAttributes: list[str]
    clockSkew: NotRequired[int]


def _key(raw: bytes, length: int | None = None) -> bytes:
    if type(raw) is not bytes or (len(raw) != length if length else len(raw) < 32):
        raise PspError("INVALID_KEY")
    return raw


def sign_envelope(data: object, metadata: dict, private_key: bytes) -> dict:
    value = encode_signature(bytes(64 if metadata.get("algorithm") == "ed25519" else 32))
    e = envelope_from_object({"signature": {**metadata, "value": value}, "data": data})
    s = e["signature"]
    if validate_time(s["timestamp"], s["expires"], s["timestamp"]) != "valid":
        raise PspError("INVALID_TIME")
    message = signature_input(e)
    output = Ed25519PrivateKey.from_private_bytes(_key(private_key, 32)).sign(message) if s["algorithm"] == "ed25519" else hmac.digest(_key(private_key), message, hashlib.sha256)
    s["value"] = encode_signature(output)
    return e


def verify_signature(value: dict, public_key_or_secret: bytes) -> bool:
    """Crypto only; verify_envelope additionally enforces time, scope and key authority."""
    e = envelope_from_object(value)
    s = e["signature"]
    signature = decode_signature(s["value"], s["algorithm"])
    message = signature_input(e)
    if s["algorithm"] == "hmac-sha256":
        return hmac.compare_digest(signature, hmac.digest(_key(public_key_or_secret), message, hashlib.sha256))
    key = Ed25519PublicKey.from_public_bytes(_key(public_key_or_secret, 32))
    try:
        key.verify(signature, message)
        return True
    except InvalidSignature:
        return False


def sign_document(document: Document, metadata: dict, private_key: bytes, preserve_source: bool = True) -> dict:
    return sign_envelope(document_to_object(document, preserve_source), {**metadata, "contentType": "json"}, private_key)


def verify_envelope(value: dict, policy: VerificationPolicy) -> dict:
    """Host-owned policy is required. Returning an envelope is not tool authorization."""
    e = envelope_from_object(value)
    s = e["signature"]
    if type(policy) is not dict or type(policy.get("keys")) is not list or type(policy.get("allowedAttributes")) is not list or type(policy.get("context")) is not dict:
        raise PspError("INVALID_POLICY")
    validate_json(policy["context"])
    if any(type(v) is not str for v in policy["context"].values()) or any(type(v) is not str for v in policy["allowedAttributes"]):
        raise PspError("INVALID_POLICY")
    if any(type(k) is not dict or type(k.get("id")) is not str for k in policy["keys"]):
        raise PspError("INVALID_POLICY")
    matches = [k for k in policy["keys"] if k.get("id") == s.get("kid", s.get("secretId"))]
    if len(matches) != 1:
        raise PspError("INVALID_POLICY" if matches else "UNKNOWN_KEY")
    key = matches[0]
    if key.get("status") != "active":
        raise PspError("REVOKED_KEY")
    if key.get("algorithm") != s["algorithm"]:
        raise PspError("KEY_ALGORITHM_MISMATCH")
    if not verify_signature(e, key.get("material")):
        raise PspError("INVALID_SIGNATURE")
    temporal = validate_time(s["timestamp"], s["expires"], policy.get("now"), policy.get("clockSkew", 0))
    if temporal != "valid":
        raise PspError("INVALID_TIME" if temporal == "invalid" else temporal.upper())
    if type(key.get("trustLevels")) is not list or any(not integer(v, 0, 5) for v in key["trustLevels"]) or type(key.get("sectionTypes")) is not list or any(type(v) is not str for v in key["sectionTypes"]) or type(key.get("scope")) is not dict or type(key.get("allowUnscoped")) is not bool:
        raise PspError("INVALID_POLICY")
    if s.get("trustLevel", 2) not in key["trustLevels"] or s["sectionType"] not in key["sectionTypes"]:
        raise PspError("UNAUTHORIZED_KEY")
    attrs = s.get("attributes", {})
    if set(attrs) - set(policy["allowedAttributes"]):
        raise PspError("UNSUPPORTED_ATTRIBUTE")
    if any(type(v) is not str or policy["context"].get(k) != v for k, v in key["scope"].items()):
        raise PspError("SCOPE_MISMATCH")
    for k, v in policy["context"].items():
        if (attrs[k] != v) if k in attrs else not key["allowUnscoped"]:
            raise PspError("SCOPE_MISMATCH")
    if not key["allowUnscoped"] and not policy["context"]:
        raise PspError("SCOPE_MISMATCH")
    return e
