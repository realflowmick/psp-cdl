# SPDX-License-Identifier: Apache-2.0
"""Local durable adapter. One connection per worker; shared Node/Python format."""
import sqlite3
import time
from psp_cdl_core import canonical_json, parse_json
from .service import identifier
from .persistence import StoreError, bounded, integer, validate_batch
from .storage_schema import STORAGE_SCHEMA

APP_ID = 1347637297


def translated(error):
    if isinstance(error, StoreError):
        return error
    code = getattr(error, "sqlite_errorcode", 0) & 255
    return StoreError("STORE_BUSY" if code in (5, 6) else "STORE_FAILURE")


class SqliteBackend:
    def __init__(self, path: str, epoch: str, clock=None):
        if not identifier(epoch) or type(path) is not str or not path or "\0" in path or path.startswith("file:") or path == ":memory:" or (clock is not None and not callable(clock)):
            raise StoreError("INVALID_CONFIGURATION")
        self.epoch = epoch
        self._clock = clock or (lambda: int(time.time()))
        db = None
        try:
            db = sqlite3.connect(path, timeout=5, isolation_level=None)
            self._db = db
            initial_app = db.execute("PRAGMA application_id").fetchone()[0]
            initial_version = db.execute("PRAGMA user_version").fetchone()[0]
            empty = initial_app == 0 and initial_version == 0 and not db.execute("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
            if not empty and (initial_app != APP_ID or initial_version != 1):
                raise StoreError("UNSUPPORTED_SCHEMA")
            db.execute("PRAGMA synchronous=FULL")
            if db.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                raise StoreError("INVALID_CONFIGURATION")
            db.execute("BEGIN IMMEDIATE")
            app = db.execute("PRAGMA application_id").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if app == 0 and version == 0 and not db.execute("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall():
                # execute(), not executescript(): preserve the initialization transaction.
                db.execute(STORAGE_SCHEMA)
                db.execute(f"PRAGMA application_id={APP_ID}")
                db.execute("PRAGMA user_version=1")
            elif app != APP_ID or version != 1:
                raise StoreError("UNSUPPORTED_SCHEMA")
            db.execute("COMMIT")
        except Exception as exc:
            if db is not None:
                db.close()
            raise translated(exc) from None

    def now(self):
        now = self._clock()
        if not integer(now):
            raise StoreError("INVALID_CLOCK")
        return now

    def read(self, tenant_id, key):
        if not identifier(tenant_id) or not identifier(key.get("id")) or key.get("kind") not in ("node", "session", "checkpoint", "receipt"):
            raise StoreError("INVALID_STATE")
        try:
            r = self._db.execute("SELECT revision,body FROM psp_records WHERE epoch=? AND tenant_id=? AND kind=? AND record_key=?", (self.epoch, tenant_id, key["kind"], key["id"])).fetchone()
            if r is None:
                return None
            body = parse_json(r[1])
            if type(body) is not dict or not integer(r[0]) or r[0] < 1:
                raise StoreError("STORE_CORRUPT")
            return {"kind": key["kind"], "id": key["id"], "revision": r[0], "body": bounded(body)}
        except Exception as exc:
            raise translated(exc) from None

    def commit(self, tenant_id, checks, writes, expires_at):
        checks, writes = bounded([checks, writes])
        validate_batch(tenant_id, checks, writes, expires_at)
        begun = False
        try:
            self._db.execute("BEGIN IMMEDIATE")
            begun = True
            for c in checks:
                current = self.read(tenant_id, c)
                if (current["revision"] if current else None) != c["revision"]:
                    self._db.execute("ROLLBACK")
                    begun = False
                    return False
            for w in writes:
                self._db.execute("INSERT INTO psp_records(epoch,tenant_id,kind,record_key,revision,body) VALUES(?,?,?,?,?,?) ON CONFLICT(epoch,tenant_id,kind,record_key) DO UPDATE SET revision=excluded.revision,body=excluded.body", (self.epoch, tenant_id, w["kind"], w["id"], w["revision"], canonical_json(w["body"])))
            if self.now() >= expires_at:
                raise StoreError("EXPIRED")
            self._db.execute("COMMIT")
            begun = False
            return True
        except Exception as exc:
            if begun:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
            raise translated(exc) from None

    def close(self):
        try:
            self._db.close()
        except Exception as exc:
            raise translated(exc) from None
