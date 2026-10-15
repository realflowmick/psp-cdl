# SPDX-License-Identifier: Apache-2.0
"""Run the shared PSP-EXFIL-0.1 vectors through the Python library. Public synthetic key; never use it for real data."""
import hashlib
import json
import os
import shutil
import struct
import tempfile
from pathlib import Path
from psp_cdl_api_server.exfiltration import ExfiltrationError, ExfiltrationStore, HashingEmbedder, fingerprint, tokenize, windows

ROOT = Path(__file__).resolve().parents[1]
SUITE = json.loads((ROOT / "conformance/vectors/exfiltration/exfiltration-0.1.json").read_text(encoding="utf-8"))
KEY = bytes.fromhex(SUITE["key"])


def sqlite_vec_path():
    """The sqlite-vec loadable path, or None when the package or this Python's extension loading is unavailable."""
    try:
        import sqlite3
        import sqlite_vec
    except ImportError:
        return None
    if not hasattr(sqlite3.Connection, "enable_load_extension"):
        return None
    return sqlite_vec.loadable_path()


def embedding_digest(text):
    v = HashingEmbedder().embed([text])[0]
    return {"sha256": hashlib.sha256(struct.pack("<384f", *v)).hexdigest(), "nonzero": sum(1 for x in v if x != 0.0)}


def primitives():
    return {"tokenize": [[list(t) for t in tokenize(c["text"])] for c in SUITE["tokenize"]],
            "windows": [[list(w) for w in windows(v["tokens"])] for v in SUITE["windows"]],
            "fingerprints": [fingerprint(f["text"], KEY) for f in SUITE["fingerprints"]],
            "embeddings": [embedding_digest(e["text"]) for e in SUITE["embeddings"]]}


def open_store(case, path, vector=None):
    vector = vector or case["vector"]
    if vector == "sqlite-vec":
        loadable = sqlite_vec_path()
        if loadable is None:
            raise ExfiltrationError("VECTOR_UNAVAILABLE")
        vector = {"sqliteVec": loadable}
    return ExfiltrationStore(path, key=KEY, embedder=HashingEmbedder() if case["embedder"] == "hash" else None,
                             vector=vector, thresholds=case.get("thresholds"), clock=lambda: 1000)


def assess(store, case):
    application = case["sections"][0]["application"]
    return [store.assess({"application": application, "text": o["text"]}) for o in case["outputs"]]


def run_case(case, path=None, vector=None):
    """Protect the case's sections in a new store and assess every output."""
    directory = None if path else tempfile.mkdtemp(prefix="exfil-")
    store = open_store(case, path or os.path.join(directory, "store.sqlite"), vector)
    try:
        return {"protected": [store.protect(dict(s)) for s in case["sections"]], "assessments": assess(store, case)}
    finally:
        store.close()
        if directory:
            shutil.rmtree(directory, ignore_errors=True)


def assess_existing(case, path, vector=None):
    store = open_store(case, path, vector)
    try:
        return assess(store, case)
    finally:
        store.close()


def _subset(actual, expected):
    if isinstance(expected, dict):
        return {k: _subset(actual.get(k) if isinstance(actual, dict) else None, v) for k, v in expected.items()}
    return actual


def project(actual, expected):
    """Reduce an assessment to the fields a shared expectation names; sections are keyed by label."""
    result = _subset(actual, {k: v for k, v in expected.items() if k != "sections"})
    if "sections" in expected:
        result["sections"] = {s["label"]: _subset(s, expected["sections"].get(s["label"], {})) for s in actual["sections"]}
    return result
