# SPDX-License-Identifier: Apache-2.0
"""Seeded bounded differential testing and two-way producer/consumer exchange."""
import argparse
import copy
import hashlib
import json
import random
import subprocess
import time
from pathlib import Path
import psp_cdl_core as core
from psp_cdl_core import crypto
import psp_cdl_cdl as cdl

ROOT = Path(__file__).resolve().parents[1]
SUITE = json.loads((ROOT / "conformance/vectors/signatures/profile-2.0.json").read_text(encoding="utf-8"))
SEED = bytes.fromhex(SUITE["testKeys"]["ed25519"]["seedHex"])
PUBLIC = bytes.fromhex(SUITE["testKeys"]["ed25519"]["publicKeyHex"])


def execute(case):
    try:
        op = case["op"]
        if op == "json":
            return {"status": "ok", "canonical": core.canonical_json(core.parse_json(case["source"]))}
        if op == "markup":
            doc = core.parse_markup(case["source"])
            canonical = core.serialize_markup(doc, "canonical")
            semantic = core.document_to_object(doc, False)
            assert core.document_to_object(core.parse_markup(canonical), False) == semantic, "ROUNDTRIP"
            return {"status": "ok", "canonical": canonical, "semantic": semantic}
        if op == "policy":
            return {"status": "ok", "tokens": cdl.normalize_declaration("covenants", case["value"])}
        if op == "signature":
            metadata = {k: v for k, v in SUITE["vectors"][1]["envelope"]["signature"].items() if k != "value"}
            envelope = copy.deepcopy(case["envelope"]) if "envelope" in case else crypto.sign_envelope(case["data"], metadata, SEED)
            variant = case.get("variant", "clean")
            if "envelope" not in case:
                if variant == "tampered": envelope["data"] = {"tampered": True}
                if variant == "malformed": envelope["signature"]["value"] += "="
            decision = "valid"
            try:
                crypto.verify_envelope(envelope, {"now": metadata["expires"] if variant == "expired" else metadata["timestamp"],
                    "keys": [{"id": metadata["kid"], "algorithm": "ed25519", "material": PUBLIC,
                              "status": "revoked" if variant == "revoked" else "active", "trustLevels": [2],
                              "sectionTypes": ["context"], "scope": {}, "allowUnscoped": True}], "context": {}, "allowedAttributes": []})
            except core.PspError as error:
                decision = error.code
            try:
                input_hex = core.signature_input(envelope).hex()
            except core.PspError:
                input_hex = None
            return {"status": "ok", "envelope": envelope, "decision": decision, "inputHex": input_hex}
        raise AssertionError("UNKNOWN_FUZZ_OPERATION")
    except core.PspError as error:
        return {"status": "error", "code": error.code}


def peer(cases, timeout=30):
    wire = json.dumps(cases, ensure_ascii=True, separators=(",", ":"))
    assert len(wire.encode()) <= 16*1024*1024 and len(cases) <= 64
    # communicate() drains both pipes; cap inputs/case count and use a fixed trusted peer.
    result = subprocess.run(["node", "scripts/fuzz-peer.mjs"], cwd=ROOT, input=wire,
                            capture_output=True, text=True, encoding="utf-8", timeout=timeout, check=True)
    assert len(result.stdout.encode()) <= 32*1024*1024, "FUZZ_OUTPUT_LIMIT"
    output = json.loads(result.stdout)
    assert len(output) == len(cases)
    return output


def generated(seed, count):
    rng = random.Random(seed)
    alphabet = ['a', ' ', '\t', '\r\n', 'é', 'e\u0301', '😀', '𝄞', '\\', '"', '${psp', '${/psp}', '|', '\u0000']
    variants = ["clean", "expired", "revoked", "tampered", "malformed"]
    for index in range(count):
        text = ''.join(rng.choice(alphabet) for _ in range(rng.randrange(0, 30)))
        op = index % 4
        if op == 0:
            source = json.dumps({text: [rng.randrange(-100000, 100000), rng.choice([1e-7, 1e-6, -0.0, 1.5]), text]}, ensure_ascii=rng.choice([True, False]))
            if rng.randrange(3) == 0:
                at = rng.randrange(len(source))
                source = source[:at] + rng.choice(['"', ',', '\\', '\ud800', '0', '${psp']) + source[at+1:]
            yield {"op": "json", "source": source}
        elif op == 1:
            escaped = text.replace('\\', '\\\\').replace('${', '\\${')
            source = '${psp type=context a=' + json.dumps(text, ensure_ascii=True) + '}' + escaped + '${/psp}'
            if rng.randrange(3) == 0:
                at = rng.randrange(len(source))
                source = source[:at] + rng.choice(['}', '${/psp}', '\\', ' type=context ', '"']) + source[at:]
            yield {"op": "markup", "source": source}
        elif op == 2:
            tokens = [rng.choice(['no-persist', 'no-training', '!no-persist', 'UNKNOWN', 'NO-TRAINING', 'no-persist\u00a0', 'can-send-email']) for _ in range(rng.randrange(0, 8))]
            yield {"op": "policy", "value": rng.choice([tokens, ' \t'.join(tokens)])}
        else:
            yield {"op": "signature", "data": {"text": text, "value": rng.randrange(-9007199254740991, 9007199254740992)}, "variant": variants[(index // 4) % 5]}


def boundaries():
    for depth in (63, 64, 65):
        yield {"op": "markup", "source": '${psp type=context}' * depth + '${/psp}' * depth}
    for depth in (255, 256, 257):
        yield {"op": "json", "source": '[' * depth + '0' + ']' * depth}
    for number in ('9007199254740991', '9007199254740992', '-9007199254740992', '1e309', '1e-400', '-0', '0.000001', '1e-7'):
        yield {"op": "json", "source": number}
    for size in (128, 129, 65536, 65537):
        yield {"op": "policy", "value": 'a' * size}
    for attrs in (256, 257):
        yield {"op": "markup", "source": '${psp type=context ' + ' '.join(f'a{i}=x' for i in range(attrs-1)) + '/}'}
    yield {"op": "json", "source": ' ' * (4*1024*1024) + '0'}
    yield {"op": "markup", "source": 'a' * (4*1024*1024+1)}


def minimize(case, budget=60):
    """Bounded deletion reduction; retain only failures that still differ across runtimes."""
    if "source" not in case: return case
    result = copy.deepcopy(case)
    width = max(1, len(result["source"]) // 2)
    while width and budget:
        for start in range(0, len(result["source"]), width):
            candidate = {**result, "source": result["source"][:start] + result["source"][start+width:]}
            budget -= 1
            if execute(candidate) != peer([candidate])[0]:
                result = candidate
                break
            if not budget: break
        else:
            width //= 2
    return result


def run(seed, count, seconds):
    deadline = time.monotonic() + seconds
    corpus = json.loads((ROOT / "conformance/vectors/fuzz/regressions-0.1.json").read_text(encoding="utf-8"))
    cases = [r["case"] for r in corpus["cases"]] + list(boundaries()) + list(generated(seed, count))
    executed = exchanges = 0
    digest = hashlib.sha256()
    for offset in range(0, len(cases), 32):
        if time.monotonic() >= deadline: raise TimeoutError("FUZZ_RUN_DEADLINE; incomplete run is not a pass")
        batch = cases[offset:offset+32]
        actual = peer(batch, min(30, max(1, deadline-time.monotonic())))
        for case, ts in zip(batch, actual):
            py = execute(case)
            if py != ts:
                failure = {"seed": seed, "index": executed, "original": case, "minimized": minimize(case), "python": py, "typescript": ts}
                path = ROOT / ".artifacts/fuzz-failure.json"
                path.parent.mkdir(exist_ok=True)
                path.write_text(json.dumps(failure, indent=2, ensure_ascii=True), encoding="utf-8")
                raise AssertionError(f"Differential mismatch at {executed}; synthetic reproducer: {path}")
            if executed < len(corpus["cases"]):
                expected = corpus["cases"][executed]["expected"]
                assert all(py.get(k) == v for k, v in expected.items()), (corpus["cases"][executed]["id"], py, expected)
            if case["op"] == "signature":
                expected = {"clean": "valid", "expired": "EXPIRED", "revoked": "REVOKED_KEY", "tampered": "INVALID_SIGNATURE", "malformed": "INVALID_ENCODING"}[case.get("variant", "clean")]
                assert py["decision"] == expected, py
            digest.update(json.dumps(py, sort_keys=True, ensure_ascii=True).encode())
            executed += 1
        # Feed each independently produced wire representation to the other runtime.
        requests, expected = [], []
        for case, ts in zip(batch, actual):
            py = execute(case)
            if case["op"] in ("markup", "json") and py["status"] == "ok":
                assert execute({"op": case["op"], "source": ts["canonical"]}) == py
                requests.append({"op": case["op"], "source": py["canonical"]})
                expected.append(py)
                exchanges += 2
            elif case["op"] == "signature":
                assert execute({**case, "envelope": ts["envelope"]}) == py
                requests.append({**case, "envelope": py["envelope"]})
                expected.append(py)
                exchanges += 2
        if requests:
            assert peer(requests, min(30, max(1, deadline-time.monotonic()))) == expected, "TWO_WAY_INTERCHANGE"
    return {"seed": seed, "generated": count, "executed": executed, "twoWayChecks": exchanges, "resultSha256": digest.hexdigest(), "status": "passed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=360034)
    parser.add_argument("--cases", type=int, default=512)
    parser.add_argument("--seconds", type=int, default=120)
    args = parser.parse_args()
    if not 1 <= args.cases <= 10000 or not 1 <= args.seconds <= 600:
        parser.error("cases must be 1..10000; seconds must be 1..600")
    print(json.dumps(run(args.seed, args.cases, args.seconds), sort_keys=True))
