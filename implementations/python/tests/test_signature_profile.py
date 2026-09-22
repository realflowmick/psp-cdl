# SPDX-License-Identifier: Apache-2.0
"""Independent fixture oracle; not a production PSP verifier or trust registry."""
import base64
from copy import deepcopy
import hashlib
import hmac
import json
import math
import re
import unittest
from pathlib import Path

import rfc8785
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = json.loads((ROOT / "conformance/vectors/signatures/profile-2.0.json").read_text(encoding="utf-8"))
VECTORS = {v["id"]: v for v in FIXTURES["vectors"]}
PRIVATE = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(FIXTURES["testKeys"]["ed25519"]["seedHex"]))
PUBLIC = Ed25519PublicKey.from_public_bytes(bytes.fromhex(FIXTURES["testKeys"]["ed25519"]["publicKeyHex"]))
HMAC_KEY = bytes.fromhex(FIXTURES["testKeys"]["hmac"]["keyHex"])


def fields(envelope):
    return (envelope["signature"], envelope["data"]) if "signature" in envelope else (envelope["x-signature"], envelope["x-data"])


def content(envelope):
    s, original = fields(envelope)
    metadata = {k: v for k, v in s.items() if k not in ("value", "timestamp", "version")}
    metadata.setdefault("trustLevel", 2)
    metadata.setdefault("priority", 50)
    metadata.setdefault("attributes", {})
    data = original.replace("\r\n", "\n").replace("\r", "\n").strip("\t\n ") if s["contentType"] == "text" else original
    return rfc8785.dumps({"data": data, "metadata": metadata})


def message(envelope):
    s, _ = fields(envelope)
    return content(envelope) + b"|" + str(s["timestamp"]).encode() + b"|" + s["version"].removeprefix("v").encode()


def decode(value, algorithm):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Non-base64url characters")
    raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if base64.urlsafe_b64encode(raw).decode().rstrip("=") != value:
        raise ValueError("Noncanonical base64url")
    if len(raw) != (64 if algorithm == "ed25519" else 32):
        raise ValueError("Wrong signature length")
    return raw


def crypto_valid(vector, data):
    s = vector["envelope"]["signature"]
    raw = decode(s["value"], s["algorithm"])
    if s["algorithm"] == "hmac-sha256":
        return hmac.compare_digest(raw, hmac.digest(HMAC_KEY, data, "sha256"))
    try:
        PUBLIC.verify(raw, data)
        return True
    except InvalidSignature:
        return False


def time_decision(case):
    timestamp, expires, now, skew = (case[k] for k in ("timestamp", "expires", "now", "skew"))
    if any(type(v) is not int or abs(v) > 9007199254740991 for v in (timestamp, expires, skew)):
        return "invalid"
    if timestamp < 0 or expires <= timestamp or not 0 <= skew <= 300 or not math.isfinite(now):
        return "invalid"
    if now >= expires:
        return "expired"
    if now < timestamp - skew:
        return "not_yet_valid"
    return "valid"


class SignatureProfileTests(unittest.TestCase):
    def test_exact_bytes_and_deterministic_signatures(self):
        for vector in FIXTURES["vectors"]:
            with self.subTest(id=vector["id"]):
                data = message(vector["envelope"])
                self.assertEqual(content(vector["envelope"]).decode(), vector["canonicalContent"])
                self.assertEqual(data.hex(), vector["inputUtf8Hex"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), vector["inputSha256"])
                self.assertTrue(crypto_valid(vector, data))
                s = vector["envelope"]["signature"]
                generated = PRIVATE.sign(data) if s["algorithm"] == "ed25519" else hmac.digest(HMAC_KEY, data, "sha256")
                self.assertEqual(base64.urlsafe_b64encode(generated).decode().rstrip("="), s["value"])

    def test_metadata_body_and_unicode_mutations(self):
        for mutation in FIXTURES["mutations"]:
            with self.subTest(id=mutation["id"]):
                vector = VECTORS[mutation["vector"]]
                changed = deepcopy(vector["envelope"])
                parent = changed
                for key in mutation["path"][:-1]:
                    parent = parent[key]
                parent[mutation["path"][-1]] = mutation["value"]
                self.assertFalse(crypto_valid(vector, message(changed)))

    def test_equivalent_representations(self):
        for case in FIXTURES["equivalents"]:
            with self.subTest(id=case["id"]):
                vector = VECTORS[case["vector"]]
                self.assertEqual(message(case["envelope"]).hex(), vector["inputUtf8Hex"])
                self.assertTrue(crypto_valid(vector, message(case["envelope"])))

    def test_expiration_boundaries(self):
        for case in FIXTURES["expirationCases"]:
            with self.subTest(id=case["id"]):
                self.assertEqual(time_decision(case), case["expected"])

    def test_noncanonical_signature_encoding(self):
        for case in FIXTURES["invalidEncodings"]:
            with self.subTest(id=case["id"]):
                with self.assertRaises(ValueError):
                    decode(case["value"], "ed25519")

    def test_ascii_only_trimming(self):
        envelope = deepcopy(FIXTURES["vectors"][0]["envelope"])
        envelope["data"] = "\u00a0text\u00a0"
        self.assertEqual(json.loads(content(envelope))["data"], envelope["data"])

    def test_jcs_rejects_lone_surrogates(self):
        with self.assertRaises(rfc8785.CanonicalizationError):
            rfc8785.dumps({"text": "\ud800"})
