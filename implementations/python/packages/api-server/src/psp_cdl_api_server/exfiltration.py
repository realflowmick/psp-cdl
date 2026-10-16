# SPDX-License-Identifier: Apache-2.0
"""PSP-EXFIL-0.1: keyed lexical fingerprints and optional embeddings of protected sections.

The store never holds protected plaintext. Shingles and chunk digests are HMACs under a
host-owned key; embeddings are float32 vectors. Assessment output carries counts, ratios
and token ranges only. Scores are heuristic signals for host threat accumulation, not proof
that text was or was not disclosed.
"""
import hashlib
import hmac
import math
import sqlite3
import struct
import time
import unicodedata
from .service import identifier

EXFIL_PROFILE = "PSP-EXFIL-0.1"
SHINGLE_TOKENS = 5
WINDOW_TOKENS = 24
WINDOW_STRIDE = 12
MAX_POSITIONS = 16
MAX_SECTION_BYTES = 262_144
MAX_OUTPUT_BYTES = 1_048_576
MAX_TEXT_FIELD = 256
APP_ID = 0x50535045
HASH_EMBEDDER_ID = "psp-exfil-hash-384-v1"
DEFAULT_THRESHOLDS = {"minRunTokens": 8, "leakRunTokens": 16, "leakCoverage": 0.5, "leakChunks": 2, "leakBreadth": 3, "neighbors": 4, "maxChunks": 512}
_BATCH = 400
_SCHEMA = """
CREATE TABLE exfil_meta(name TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE exfil_section(
  section_id TEXT PRIMARY KEY,
  application TEXT NOT NULL,
  session_id TEXT,
  section_type TEXT NOT NULL CHECK(section_type IN ('system','context')),
  version TEXT,
  label TEXT,
  token_count INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX exfil_section_application ON exfil_section(application, token_count);
CREATE TABLE exfil_chunk(
  chunk_id INTEGER PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES exfil_section(section_id),
  ordinal INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  embedding BLOB,
  UNIQUE(section_id, ordinal)
);
CREATE TABLE exfil_shingle(
  application TEXT NOT NULL,
  shingle TEXT NOT NULL,
  section_id TEXT NOT NULL REFERENCES exfil_section(section_id),
  position INTEGER NOT NULL,
  PRIMARY KEY(application, shingle, section_id, position)
) WITHOUT ROWID;
CREATE INDEX exfil_shingle_section ON exfil_shingle(section_id);
"""
_SEVERITY = {"clear": 0, "suspicious": 1, "leak": 2}


class ExfiltrationError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise ExfiltrationError(code)


def _token_char(c):
    return unicodedata.category(c)[0] in "LNM"


def _utf8(text, limit):
    if type(text) is not str:
        _fail("INVALID_INPUT")
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError:
        _fail("INVALID_INPUT")
    if size > limit:
        _fail("INPUT_TOO_LARGE")


def tokenize(text):
    """Return [(token, start, end)]: normalized tokens with code point offsets into the original text."""
    out, start = [], None
    for i, c in enumerate(text):
        if _token_char(c):
            if start is None:
                start = i
        elif start is not None:
            _split(out, text[start:i], start, i)
            start = None
    if start is not None:
        _split(out, text[start:], start, len(text))
    return out


def _split(out, raw, start, end):
    piece = []
    for c in unicodedata.normalize("NFKC", raw).lower():
        if _token_char(c):
            piece.append(c)
        elif piece:
            out.append(("".join(piece), start, end))
            piece = []
    if piece:
        out.append(("".join(piece), start, end))


def windows(count):
    """Token windows [start, end) for semantic chunks."""
    if count <= 0:
        return []
    if count <= WINDOW_TOKENS:
        return [(0, count)]
    starts = list(range(0, count - WINDOW_TOKENS, WINDOW_STRIDE))
    if starts[-1] != count - WINDOW_TOKENS:
        starts.append(count - WINDOW_TOKENS)
    return [(s, s + WINDOW_TOKENS) for s in starts]


def _mac(key, purpose, payload):
    return hmac.new(key, (EXFIL_PROFILE + "\0" + purpose + "\0" + payload).encode("utf-8"), hashlib.sha256).hexdigest()


def _shingles(key, tokens, width):
    if width < 1 or len(tokens) < width:
        return []
    return [_mac(key, "shingle", " ".join(tokens[i:i + width]))[:16] for i in range(len(tokens) - width + 1)]


def _key(key):
    if type(key) not in (bytes, bytearray) or len(key) < 32 or len(key) > 1024:
        _fail("INVALID_CONFIGURATION")
    return bytes(key)


def fingerprint(text, key):
    """Pure lexical fingerprint used by the store and by the shared vectors."""
    key = _key(key)
    _utf8(text, MAX_SECTION_BYTES)
    tokens = [t for t, _, _ in tokenize(text)]
    width = min(SHINGLE_TOKENS, len(tokens))
    return {"tokens": len(tokens), "width": width, "shingles": _shingles(key, tokens, width),
            "chunks": [{"start": s, "end": e, "digest": _mac(key, "chunk", " ".join(tokens[s:e]))} for s, e in windows(len(tokens))]}


def _fnv1a(data):
    h = 0x811C9DC5
    for b in data:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


class HashingEmbedder:
    """Deterministic feature-hashing embedder. Lexical similarity only; it does not model paraphrase."""
    id = HASH_EMBEDDER_ID
    dimensions = 384
    thresholds = {"strongDistance": 0.2, "suspiciousDistance": 0.35}

    def embed(self, texts):
        return [self._vector(t) for t in texts]

    def _vector(self, text):
        v = [0.0] * self.dimensions
        def add(feature, weight):
            h = _fnv1a(feature.encode("utf-8"))
            v[h % self.dimensions] += -weight if h & 0x80000000 else weight
        tokens = text.split(" ")
        for i, t in enumerate(tokens):
            add("w\0" + t, 1.0)
            padded = "<" + t + ">"
            for j in range(max(1, len(padded) - 2)):
                add("c\0" + padded[j:j + 3], 0.5)
            if i:
                add("b\0" + tokens[i - 1] + " " + t, 1.0)
        total = 0.0
        for x in v:
            total += x * x
        if total == 0.0:
            return v
        norm = math.sqrt(total)
        return [x / norm for x in v]


MINILM_ONNX = {
    "repository": "Xenova/all-MiniLM-L6-v2", "revision": "751bff37182d3f1213fa05d7196b954e230abad9",
    "modelSha256": "759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e",
    "tokenizerSha256": "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    "dimensions": 384, "maxTokens": 128,
}


class OnnxEmbedder:
    """Local mean-pooled sentence embeddings from a pinned ONNX file.

    Requires the optional onnxruntime, tokenizers and numpy packages. Files are read from the
    host's directory and checked against SHA-256 digests; nothing is downloaded. Thresholds are
    starting points from the design note and must be calibrated on benign traffic per workflow.
    """

    def __init__(self, model_dir, model_sha256=None, tokenizer_sha256=None, thresholds=None, batch_size=16):
        if type(model_dir) is not str or not model_dir or type(batch_size) is not int or not 1 <= batch_size <= 256:
            _fail("INVALID_CONFIGURATION")
        try:
            import numpy
            import onnxruntime
            import tokenizers
        except ImportError:
            _fail("EMBEDDER_UNAVAILABLE")
        import os
        try:
            with open(os.path.join(model_dir, "onnx", "model.onnx"), "rb") as f:
                model = f.read()
            with open(os.path.join(model_dir, "tokenizer.json"), "rb") as f:
                tokenizer_json = f.read()
        except OSError:
            _fail("EMBEDDER_UNAVAILABLE")
        model_sha = hashlib.sha256(model).hexdigest()
        if model_sha != (model_sha256 or MINILM_ONNX["modelSha256"]) or hashlib.sha256(tokenizer_json).hexdigest() != (tokenizer_sha256 or MINILM_ONNX["tokenizerSha256"]):
            _fail("MODEL_MISMATCH")
        try:
            self._session = onnxruntime.InferenceSession(model, providers=["CPUExecutionProvider"])
            self._tokenizer = tokenizers.Tokenizer.from_str(tokenizer_json.decode("utf-8"))
            # Match the JavaScript tokenizer: ignore the file's own 128-token padding/truncation and apply ours.
            self._tokenizer.no_truncation()
            self._tokenizer.no_padding()
        except Exception:
            _fail("EMBEDDER_UNAVAILABLE")
        self._np = numpy
        self._batch = batch_size
        self.id = "minilm-l6-v2-onnx:" + model_sha[:16]
        self.dimensions = MINILM_ONNX["dimensions"]
        self.thresholds = thresholds or {"strongDistance": 0.15, "suspiciousDistance": 0.3}

    def embed(self, texts):
        np, limit, dims, out = self._np, MINILM_ONNX["maxTokens"], self.dimensions, []
        for b in range(0, len(texts), self._batch):
            batch = []
            for text in texts[b:b + self._batch]:
                ids = self._tokenizer.encode(text).ids
                batch.append(ids[:limit - 1] + [ids[-1]] if len(ids) > limit else ids)
            seq = max(len(ids) for ids in batch)
            input_ids = np.zeros((len(batch), seq), dtype=np.int64)
            mask = np.zeros((len(batch), seq), dtype=np.int64)
            for r, ids in enumerate(batch):
                input_ids[r, :len(ids)] = ids
                mask[r, :len(ids)] = 1
            hidden = self._session.run(["last_hidden_state"], {"input_ids": input_ids, "attention_mask": mask, "token_type_ids": np.zeros_like(input_ids)})[0]
            if hidden.dtype != np.float32 or hidden.shape != (len(batch), seq, dims):
                _fail("EMBEDDER_FAILED")
            for r, ids in enumerate(batch):
                # Row-by-row accumulation in float64, the same order as the TypeScript adapter.
                total = np.zeros(dims, dtype=np.float64)
                for c in range(len(ids)):
                    total += hidden[r, c].astype(np.float64)
                mean = [float(x) / len(ids) for x in total]
                squares = 0.0
                for x in mean:
                    squares += x * x
                norm = math.sqrt(squares)
                out.append(mean if norm == 0.0 else [x / norm for x in mean])
        return out


def _pack(vector, dimensions):
    if type(vector) not in (list, tuple) or len(vector) != dimensions:
        _fail("EMBEDDER_FAILED")
    values = []
    for x in vector:
        if type(x) not in (int, float) or not math.isfinite(x):
            _fail("EMBEDDER_FAILED")
        values.append(float(x))
    try:
        return struct.pack("<%df" % dimensions, *values)
    except (OverflowError, struct.error):
        _fail("EMBEDDER_FAILED")


def _unpack(blob, dimensions):
    if type(blob) is not bytes or len(blob) != 4 * dimensions:
        _fail("STORE_CORRUPT")
    return struct.unpack("<%df" % dimensions, blob)


def _norm(values):
    total = 0.0
    for x in values:
        total += x * x
    return math.sqrt(total)


def _distance(a, a_norm, b, b_norm):
    if a_norm == 0.0 or b_norm == 0.0:
        return 1.0
    dot = 0.0
    for x, y in zip(a, b):
        dot += x * y
    return min(2.0, max(0.0, 1.0 - dot / (a_norm * b_norm)))


def _round(x):
    return math.floor(x * 1_000_000 + 0.5) / 1_000_000


def _number(value, low, high, integer=False):
    if type(value) is bool or type(value) not in ((int,) if integer else (int, float)) or not math.isfinite(value) or value < low or value > high:
        _fail("INVALID_CONFIGURATION")
    return value


def _thresholds(embedder, override):
    base = dict(DEFAULT_THRESHOLDS)
    if embedder is not None:
        base.update(getattr(embedder, "thresholds", None) or {})
    if override is not None:
        if type(override) is not dict or not set(override) <= set(DEFAULT_THRESHOLDS) | {"strongDistance", "suspiciousDistance"}:
            _fail("INVALID_CONFIGURATION")
        base.update(override)
    for name in ("minRunTokens", "leakRunTokens"):
        _number(base[name], 1, 10_000, True)
    for name in ("leakChunks", "leakBreadth"):
        _number(base[name], 1, 10_000, True)
    _number(base["neighbors"], 1, 64, True)
    _number(base["maxChunks"], 1, 100_000, True)
    _number(base["leakCoverage"], 0.01, 1.0)
    if base["minRunTokens"] > base["leakRunTokens"]:
        _fail("INVALID_CONFIGURATION")
    if embedder is not None:
        if "strongDistance" not in base or "suspiciousDistance" not in base:
            _fail("INVALID_CONFIGURATION")
        _number(base["strongDistance"], 0.0, 2.0)
        _number(base["suspiciousDistance"], 0.0, 2.0)
        if base["strongDistance"] >= base["suspiciousDistance"]:
            _fail("INVALID_CONFIGURATION")
    else:
        base.pop("strongDistance", None)
        base.pop("suspiciousDistance", None)
    return base


def _optional_text(value):
    if value is not None and (type(value) is not str or not value or len(value) > MAX_TEXT_FIELD):
        _fail("INVALID_INPUT")
    return value


def _translated(error):
    if isinstance(error, ExfiltrationError):
        return error
    code = getattr(error, "sqlite_errorcode", 0) & 255
    return ExfiltrationError("STORE_BUSY" if code in (5, 6) else "STORE_FAILURE")


class ExfiltrationStore:
    """One SQLite file of protected-section fingerprints. One connection per worker; shared Node/Python format."""

    def __init__(self, path, key, embedder=None, vector=None, thresholds=None, clock=None):
        if type(path) is not str or not path or "\0" in path or path.startswith("file:") or path == ":memory:" or (clock is not None and not callable(clock)):
            _fail("INVALID_CONFIGURATION")
        self._key = _key(key)
        if embedder is not None:
            if not callable(getattr(embedder, "embed", None)) or not identifier(getattr(embedder, "id", None)) or type(getattr(embedder, "dimensions", None)) is not int or not 1 <= embedder.dimensions <= 4096:
                _fail("INVALID_CONFIGURATION")
        self._embedder = embedder
        self.thresholds = _thresholds(embedder, thresholds)
        if vector is None or vector == "portable":
            extension = None
        elif type(vector) is dict and set(vector) == {"sqliteVec"} and type(vector["sqliteVec"]) is str and vector["sqliteVec"] and embedder is not None:
            extension = vector["sqliteVec"]
        else:
            _fail("INVALID_CONFIGURATION")
        self.vector = "sqlite-vec" if extension else "portable"
        self._clock = clock or (lambda: int(time.time()))
        self._cache = {}
        self._writes = 0
        db = None
        try:
            db = sqlite3.connect(path, timeout=5, isolation_level=None)
            self._db = db
            if extension:
                # Some Python builds omit extension loading; the host then uses portable mode.
                try:
                    db.enable_load_extension(True)
                    db.load_extension(extension)
                    db.enable_load_extension(False)
                except (sqlite3.Error, AttributeError):
                    _fail("VECTOR_UNAVAILABLE")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            app = db.execute("PRAGMA application_id").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            check = _mac(self._key, "check", "")
            dims = str(embedder.dimensions) if embedder else "0"
            if app == 0 and version == 0 and not db.execute("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall():
                for statement in _SCHEMA.split(";"):
                    if statement.strip():
                        db.execute(statement)
                db.executemany("INSERT INTO exfil_meta(name, value) VALUES(?, ?)", [("profile", EXFIL_PROFILE), ("keyCheck", check), ("embedder", embedder.id if embedder else ""), ("dimensions", dims)])
                db.execute(f"PRAGMA application_id={APP_ID}")
                db.execute("PRAGMA user_version=1")
            elif app != APP_ID or version != 1:
                _fail("UNSUPPORTED_SCHEMA")
            meta = dict(db.execute("SELECT name, value FROM exfil_meta").fetchall())
            if meta.get("profile") != EXFIL_PROFILE:
                _fail("UNSUPPORTED_SCHEMA")
            if not hmac.compare_digest(meta.get("keyCheck", ""), check):
                _fail("KEY_MISMATCH")
            if meta.get("embedder") != (embedder.id if embedder else "") or meta.get("dimensions") != dims:
                _fail("EMBEDDER_MISMATCH")
            self._indexed = db.execute("SELECT 1 FROM sqlite_master WHERE name='exfil_vec'").fetchone() is not None
            if extension:
                if not self._indexed:
                    db.execute(f"CREATE VIRTUAL TABLE exfil_vec USING vec0(chunk_id INTEGER PRIMARY KEY, application TEXT PARTITION KEY, embedding FLOAT[{embedder.dimensions}] distance_metric=cosine)")
                    self._indexed = True
                    meta["vectorIndex"] = "stale"
                if meta.get("vectorIndex") != "current":
                    db.execute("DELETE FROM exfil_vec")
                    db.execute("INSERT INTO exfil_vec(chunk_id, application, embedding) SELECT c.chunk_id, s.application, c.embedding FROM exfil_chunk c JOIN exfil_section s ON s.section_id=c.section_id")
                    db.execute("INSERT INTO exfil_meta(name, value) VALUES('vectorIndex', 'current') ON CONFLICT(name) DO UPDATE SET value=excluded.value")
            db.execute("COMMIT")
        except Exception as exc:
            if db is not None:
                db.close()
            raise _translated(exc) from None

    @property
    def embedder_id(self):
        return self._embedder.id if self._embedder else None

    def close(self):
        self._db.close()

    def _embed(self, texts):
        if not texts:
            return []
        try:
            vectors = self._embedder.embed(list(texts))
        except ExfiltrationError:
            raise
        except Exception:
            _fail("EMBEDDER_FAILED")
        if type(vectors) not in (list, tuple) or len(vectors) != len(texts):
            _fail("EMBEDDER_FAILED")
        return [_pack(v, self._embedder.dimensions) for v in vectors]

    def _write(self, fn):
        try:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                result = fn()
                if self._indexed and self.vector == "portable":
                    self._db.execute("INSERT INTO exfil_meta(name, value) VALUES('vectorIndex', 'stale') ON CONFLICT(name) DO UPDATE SET value=excluded.value")
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._writes += 1
            return result
        except Exception as exc:
            raise _translated(exc) from None

    def protect(self, section):
        """Register a protected SYSTEM or CONTEXT body. Idempotent per application, session, type and normalized text."""
        if type(section) is not dict or not set(section) <= {"application", "sectionType", "text", "sessionId", "version", "label", "expiresAt"} or not {"application", "sectionType", "text"} <= set(section):
            _fail("INVALID_INPUT")
        application, session_id, section_type = section["application"], section.get("sessionId"), section["sectionType"]
        if not identifier(application) or session_id is not None and not identifier(session_id) or section_type not in ("system", "context"):
            _fail("INVALID_INPUT")
        version, label, expires = _optional_text(section.get("version")), _optional_text(section.get("label")), section.get("expiresAt")
        if expires is not None and (type(expires) is not int or expires < 0 or expires > 2**53 - 1):
            _fail("INVALID_INPUT")
        _utf8(section["text"], MAX_SECTION_BYTES)
        tokens = [t for t, _, _ in tokenize(section["text"])]
        if not tokens:
            _fail("INVALID_INPUT")
        joined = " ".join(tokens)
        section_id = _mac(self._key, "section", "\0".join((application, session_id or "", section_type, joined)))
        width = min(SHINGLE_TOKENS, len(tokens))
        hashes = _shingles(self._key, tokens, width)
        spans = windows(len(tokens))
        texts = [" ".join(tokens[s:e]) for s, e in spans]
        embeddings = self._embed(texts) if self._embedder else [None] * len(spans)
        now = self._clock()
        if type(now) is not int:
            _fail("INVALID_CLOCK")

        def write():
            if self._db.execute("SELECT 1 FROM exfil_section WHERE section_id=?", (section_id,)).fetchone():
                self._db.execute("UPDATE exfil_section SET version=?, label=?, expires_at=? WHERE section_id=?", (version, label, expires, section_id))
                return False
            self._db.execute("INSERT INTO exfil_section(section_id, application, session_id, section_type, version, label, token_count, chunk_count, expires_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (section_id, application, session_id, section_type, version, label, len(tokens), len(spans), expires, now))
            seen = {}
            rows = []
            for position, h in enumerate(hashes):
                if seen.get(h, 0) < MAX_POSITIONS:
                    seen[h] = seen.get(h, 0) + 1
                    rows.append((application, h, section_id, position))
            self._db.executemany("INSERT INTO exfil_shingle(application, shingle, section_id, position) VALUES(?,?,?,?)", rows)
            for ordinal, (text, blob) in enumerate(zip(texts, embeddings)):
                chunk_id = self._db.execute("INSERT INTO exfil_chunk(section_id, ordinal, chunk_hash, embedding) VALUES(?,?,?,?)",
                                            (section_id, ordinal, _mac(self._key, "chunk", text), blob)).lastrowid
                if blob is not None and self.vector == "sqlite-vec":
                    self._db.execute("INSERT INTO exfil_vec(chunk_id, application, embedding) VALUES(?,?,?)", (chunk_id, application, blob))
            return True
        created = self._write(write)
        return {"sectionId": section_id, "created": created, "tokens": len(tokens), "shingles": len(hashes), "chunks": len(spans)}

    def _delete(self, where, args):
        ids = [r[0] for r in self._db.execute("SELECT section_id FROM exfil_section WHERE " + where, args).fetchall()]
        for section_id in ids:
            if self.vector == "sqlite-vec":
                self._db.execute("DELETE FROM exfil_vec WHERE chunk_id IN (SELECT chunk_id FROM exfil_chunk WHERE section_id=?)", (section_id,))
            self._db.execute("DELETE FROM exfil_chunk WHERE section_id=?", (section_id,))
            self._db.execute("DELETE FROM exfil_shingle WHERE section_id=?", (section_id,))
            self._db.execute("DELETE FROM exfil_section WHERE section_id=?", (section_id,))
        return len(ids)

    def remove(self, section_id):
        if type(section_id) is not str or len(section_id) != 64:
            _fail("INVALID_INPUT")
        return self._write(lambda: self._delete("section_id=?", (section_id,))) == 1

    def remove_session(self, application, session_id):
        if not identifier(application) or not identifier(session_id):
            _fail("INVALID_INPUT")
        return self._write(lambda: self._delete("application=? AND session_id=?", (application, session_id)))

    def purge(self, now=None):
        """Delete sections whose expires_at is at or before now."""
        now = self._clock() if now is None else now
        if type(now) is not int:
            _fail("INVALID_INPUT")
        return self._write(lambda: self._delete("expires_at IS NOT NULL AND expires_at<=?", (now,)))

    def sections(self, application):
        if not identifier(application):
            _fail("INVALID_INPUT")
        try:
            rows = self._db.execute("SELECT section_id, session_id, section_type, version, label, token_count, chunk_count, expires_at, created_at FROM exfil_section WHERE application=? ORDER BY section_id", (application,)).fetchall()
        except Exception as exc:
            raise _translated(exc) from None
        return [{"sectionId": r[0], "sessionId": r[1], "sectionType": r[2], "version": r[3], "label": r[4], "tokens": r[5], "chunks": r[6], "expiresAt": r[7], "createdAt": r[8]} for r in rows]

    def assess(self, request):
        """Compare outbound text with every protected section of one application."""
        if type(request) is not dict or set(request) != {"application", "text"} or not identifier(request["application"]):
            _fail("INVALID_INPUT")
        _utf8(request["text"], MAX_OUTPUT_BYTES)
        application, th = request["application"], self.thresholds
        tokens = [t for t, _, _ in tokenize(request["text"])]
        spans = windows(len(tokens))
        complete = len(spans) <= th["maxChunks"]
        spans = spans[:th["maxChunks"]]
        try:
            info = {r[0]: {"sessionId": r[1], "sectionType": r[2], "version": r[3], "label": r[4], "tokens": r[5], "chunks": r[6]}
                    for r in self._db.execute("SELECT section_id, session_id, section_type, version, label, token_count, chunk_count FROM exfil_section WHERE application=?", (application,))}
            lexical = self._lexical(application, tokens, info)
            semantic = self._semantic(application, tokens, spans, info) if self._embedder and spans and info else {}
        except Exception as exc:
            raise _translated(exc) from None
        sections = []
        for section_id in sorted(set(lexical) | set(semantic)):
            meta = info[section_id]
            lex = lexical.get(section_id) or {"disposition": "clear", "score": 0.0, "longestRunTokens": 0, "coverage": 0.0, "runs": 0, "ranges": []}
            sem = semantic.get(section_id) if self._embedder else None
            if self._embedder and sem is None:
                sem = {"disposition": "clear", "score": 0.0, "bestDistance": None, "strongChunks": 0, "suspiciousChunks": 0, "longestRun": 0}
            disposition = max((lex["disposition"], sem["disposition"] if sem else "clear"), key=_SEVERITY.get)
            sections.append({"sectionId": section_id, "sectionType": meta["sectionType"], "sessionId": meta["sessionId"], "version": meta["version"], "label": meta["label"],
                             "tokens": meta["tokens"], "chunks": meta["chunks"], "disposition": disposition, "signal": max(lex["score"], sem["score"] if sem else 0.0),
                             "lexical": {k: lex[k] for k in ("disposition", "score", "longestRunTokens", "coverage", "runs", "ranges")},
                             "semantic": None if sem is None else {k: sem[k] for k in ("disposition", "score", "bestDistance", "strongChunks", "suspiciousChunks", "longestRun")}})
        sections.sort(key=lambda s: (-s["signal"], s["sectionId"]))
        disposition = max([s["disposition"] for s in sections] or ["clear"], key=_SEVERITY.get)
        flags = set()
        for s in sections:
            if s["disposition"] == "leak":
                flags.add("system_prompt_disclosure" if s["sectionType"] == "system" else "context_disclosure")
            elif s["disposition"] == "suspicious":
                flags.add("protected_content_overlap")
        if not complete:
            flags.add("assessment_incomplete")
        lexical_max = max([s["lexical"]["score"] for s in sections] or [0.0])
        semantic_max = max([s["semantic"]["score"] for s in sections] or [0.0]) if self._embedder else None
        return {"profile": EXFIL_PROFILE, "application": application, "embedder": self.embedder_id, "vector": self.vector if self._embedder else None,
                "disposition": disposition, "signal": max(lexical_max, semantic_max or 0.0), "sources": {"pattern_match": lexical_max, "external_classifier": semantic_max},
                "flags": sorted(flags), "complete": complete, "output": {"tokens": len(tokens), "chunks": len(spans)}, "sections": sections}

    def _lexical(self, application, tokens, info):
        widths = sorted({min(SHINGLE_TOKENS, m["tokens"]) for m in info.values()})
        occurrences = {}
        for width in widths:
            for i, h in enumerate(_shingles(self._key, tokens, width)):
                found = occurrences.setdefault(h, [])
                if len(found) < MAX_POSITIONS:
                    found.append(i)
        pairs = {}
        hashes = sorted(occurrences)
        for b in range(0, len(hashes), _BATCH):
            batch = hashes[b:b + _BATCH]
            sql = "SELECT shingle, section_id, position FROM exfil_shingle WHERE application=? AND shingle IN (" + ",".join("?" * len(batch)) + ")"
            for h, section_id, j in self._db.execute(sql, (application, *batch)):
                if section_id in info:
                    target = pairs.setdefault(section_id, set())
                    for i in occurrences[h]:
                        target.add((i, j))
        th, result = self.thresholds, {}
        for section_id, found in pairs.items():
            n = info[section_id]["tokens"]
            width = min(SHINGLE_TOKENS, n)
            qualify, target = min(th["minRunTokens"], n), min(th["leakRunTokens"], n)
            runs, covered, ranges = [], set(), []
            for i, j in sorted(found):
                if (i - 1, j - 1) in found:
                    continue
                length = 1
                while (i + length, j + length) in found:
                    length += 1
                size = length + width - 1
                if size >= qualify:
                    runs.append(size)
                    covered.update(range(j, j + size))
                    ranges.append([i, i + size])
            if not runs:
                continue
            longest, coverage = max(runs), _round(len(covered) / n)
            leak = longest >= target or len(covered) / n >= th["leakCoverage"]
            score = 1.0 if leak else _round(min(1.0, max(longest / target, (len(covered) / n) / th["leakCoverage"])))
            result[section_id] = {"disposition": "leak" if leak else "suspicious", "score": score, "longestRunTokens": longest, "coverage": coverage,
                                  "runs": len(runs), "ranges": _merge(ranges)[:32]}
        return result

    def _semantic(self, application, tokens, spans, info):
        th = self.thresholds
        outbound = self._embed([" ".join(tokens[s:e]) for s, e in spans])
        dims = self._embedder.dimensions
        hits = {}
        if self.vector == "sqlite-vec":
            names = {}
            for blob in outbound:
                rows = self._db.execute("SELECT chunk_id, distance FROM exfil_vec WHERE embedding MATCH ? AND k = ? AND application = ?", (blob, th["neighbors"], application)).fetchall()
                missing = [r[0] for r in rows if r[0] not in names]
                for b in range(0, len(missing), _BATCH):
                    part = missing[b:b + _BATCH]
                    for chunk_id, section_id, ordinal in self._db.execute("SELECT chunk_id, section_id, ordinal FROM exfil_chunk WHERE chunk_id IN (" + ",".join("?" * len(part)) + ")", part):
                        names[chunk_id] = (section_id, ordinal)
                ranked = sorted((min(2.0, max(0.0, float(d))), names[c][0], names[c][1]) for c, d in rows)
                self._hits(hits, ranked, info)
        else:
            chunks = self._chunks(application, dims)
            for blob in outbound:
                values = _unpack(blob, dims)
                norm = _norm(values)
                ranked = sorted((_distance(values, norm, vec, vnorm), sid, ordinal) for sid, ordinal, vec, vnorm in chunks)[:th["neighbors"]]
                self._hits(hits, ranked, info)
        result = {}
        for section_id, found in hits.items():
            chunks = info[section_id]["chunks"]
            strong = sorted({o for o, d in found if d <= th["strongDistance"]})
            best = min(d for _, d in found)
            longest = run = 0
            for k, ordinal in enumerate(strong):
                run = run + 1 if k and strong[k - 1] == ordinal - 1 else 1
                longest = max(longest, run)
            breadth = len({o for o, _ in found})
            leak = bool(strong) and (longest >= min(th["leakChunks"], chunks) or len(strong) / chunks >= th["leakCoverage"]) or breadth >= th["leakBreadth"]
            closeness = min(1.0, max(0.0, (th["suspiciousDistance"] - best) / (th["suspiciousDistance"] - th["strongDistance"])))
            result[section_id] = {"disposition": "leak" if leak else "suspicious", "score": 1.0 if leak else _round(0.25 + 0.5 * closeness),
                                  "bestDistance": _round(best), "strongChunks": len(strong), "suspiciousChunks": breadth, "longestRun": longest}
        return result

    def _hits(self, hits, ranked, info):
        for d, section_id, ordinal in ranked[:self.thresholds["neighbors"]]:
            if d <= self.thresholds["suspiciousDistance"] and section_id in info:
                hits.setdefault(section_id, []).append((ordinal, d))

    def _chunks(self, application, dims):
        version = (self._db.execute("PRAGMA data_version").fetchone()[0], self._writes)
        cached = self._cache.get(application)
        if cached and cached[0] == version:
            return cached[1]
        chunks = []
        for section_id, ordinal, blob in self._db.execute("SELECT c.section_id, c.ordinal, c.embedding FROM exfil_chunk c JOIN exfil_section s ON s.section_id=c.section_id WHERE s.application=? ORDER BY c.section_id, c.ordinal", (application,)):
            values = _unpack(blob, dims)
            chunks.append((section_id, ordinal, values, _norm(values)))
        self._cache[application] = (version, chunks)
        return chunks


def _merge(ranges):
    merged = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged
