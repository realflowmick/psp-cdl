# SPDX-License-Identifier: Apache-2.0
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from persistence_fixtures import FIXTURE, SECRET, run_fixture
from psp_cdl_api_server.persistence import WorkflowStore, StoreError
from psp_cdl_api_server.sqlite import SqliteBackend
from psp_cdl_api_server.storage_schema import STORAGE_SCHEMA

ACTOR = FIXTURE["actor"]
NODE = next(s["command"] for s in FIXTURE["steps"] if s["id"] == "node")
CREATE = next(s["command"] for s in FIXTURE["steps"] if s["id"] == "session")


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="psp-storage-")
        self.path = str(Path(self.directory.name) / "state.sqlite")
        self.now = 100
        self.permit = lambda *_: True
        self.backend = SqliteBackend(self.path, "epoch-1", lambda: self.now)
        self.store = WorkflowStore(self.backend, resume_secret=SECRET, authorize_persistence=lambda *args: self.permit(*args))

    def tearDown(self):
        self.backend.close()
        self.directory.cleanup()

    def execute(self, command):
        return self.store.execute(ACTOR, command)

    def error(self, code, callback):
        with self.assertRaises(StoreError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def checkpoint(self):
        self.execute(NODE)
        session = self.execute(CREATE)
        command = {"action": "createCheckpoint", "requestId": "cp", "sessionId": session["sessionId"], "expectedVersion": 1, "expiresAt": 150}
        return session, command, self.execute(command)

    def test_shared_vectors(self):
        self.assertEqual(len(run_fixture(self.path)), len([s for s in FIXTURE["steps"] if "control" not in s]))

    def test_schema_copy(self):
        self.assertEqual(STORAGE_SCHEMA, (ROOT / "schemas/persistence/sqlite-0.1.sql").read_text(encoding="utf-8"))

    def test_failure_rollback(self):
        session, _, cp = self.checkpoint()
        raw = sqlite3.connect(self.path, isolation_level=None)
        try:
            raw.execute("CREATE TRIGGER synthetic_failure BEFORE INSERT ON psp_records WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'public synthetic fault'); END")
            command = {"action": "resumeCheckpoint", "requestId": "resume", "checkpointId": cp["checkpointId"], "resumeToken": cp["resumeToken"], "state": {"done": True}}
            self.error("STORE_FAILURE", lambda: self.execute(command))
            self.assertEqual(self.execute({"action": "getSession", "sessionId": session["sessionId"]})["status"], "waiting")
            self.assertFalse(json.loads(raw.execute("SELECT body FROM psp_records WHERE kind='checkpoint'").fetchone()[0])["consumed"])
            raw.execute("DROP TRIGGER synthetic_failure")
            self.assertEqual(self.execute(command)["version"], 3)
            self.assertNotIn(cp["resumeToken"].encode(), Path(self.path).read_bytes())
        finally:
            raw.close()

    def test_expiry_and_detached_copies(self):
        self.execute(NODE)
        def expire(_actor, writes):
            writes[0]["body"]["state"] = {"tampered": True}
            self.now = 200
            return True
        self.permit = expire
        self.error("EXPIRED", lambda: self.execute(CREATE))
        self.now = 100
        def mutate(_actor, writes):
            writes[0]["body"]["state"] = {"tampered": True}
            return True
        self.permit = mutate
        session = self.execute(CREATE)
        self.assertEqual(session["state"], CREATE["state"])
        self.backend.read(ACTOR["tenantId"], {"kind": "session", "id": session["sessionId"]})["body"]["state"] = {}
        self.assertEqual(self.execute({"action": "getSession", "sessionId": session["sessionId"]})["state"], CREATE["state"])

    def test_guard_failures(self):
        def throwing(*_):
            raise RuntimeError("private details")
        for guard in (lambda *_: "true", throwing, lambda *_: False):
            self.permit = guard
            self.error("PERSISTENCE_DENIED", lambda: self.execute(NODE))
        with closing(sqlite3.connect(self.path)) as raw:
            self.assertEqual(raw.execute("SELECT count(*) FROM psp_records").fetchone()[0], 0)

    def test_bounds_and_invalid_commands(self):
        for state in ({"big": "x" * 1_048_576}, {"bad": float("nan")}, {"bad": {1, 2}}):
            self.error("INVALID_STATE", lambda: self.execute({**CREATE, "state": state}))
        for action in ("constructor", "__proto__", "toString"):
            self.error("INVALID_COMMAND", lambda: self.execute({"action": action}))

    def test_epoch_and_secret_rotation(self):
        session, command, cp = self.checkpoint()
        other = SqliteBackend(self.path, "epoch-2", lambda: 100)
        try:
            store = WorkflowStore(other, resume_secret=SECRET, authorize_persistence=lambda *_: True)
            self.error("NOT_FOUND", lambda: store.execute(ACTOR, {"action": "getSession", "sessionId": session["sessionId"]}))
            rotated = WorkflowStore(self.backend, resume_secret=bytes([43]) * 32, authorize_persistence=lambda *_: True)
            self.error("CHECKPOINT_KEY_CHANGED", lambda: rotated.execute(ACTOR, command))
            self.error("INVALID_TOKEN", lambda: rotated.execute(ACTOR, {"action": "resumeCheckpoint", "requestId": "resume", "checkpointId": cp["checkpointId"], "resumeToken": cp["resumeToken"], "state": {}}))
        finally:
            other.close()

    def test_schema_and_batch_validation(self):
        self.error("INVALID_STATE", lambda: self.backend.commit(ACTOR["tenantId"], [], [{"kind": "session", "id": "x", "revision": 1, "body": {}}], 200))
        with closing(sqlite3.connect(self.path)) as raw:
            raw.execute("PRAGMA user_version=99")
        self.error("UNSUPPORTED_SCHEMA", lambda: SqliteBackend(self.path, "epoch-1"))
        for path in (":memory:", "file:test", ""):
            self.error("INVALID_CONFIGURATION", lambda: SqliteBackend(path, "epoch-1"))

    def test_retry_after_receipt_miss(self):
        session, _, cp = self.checkpoint()
        command = {"action": "resumeCheckpoint", "requestId": "resume", "checkpointId": cp["checkpointId"], "resumeToken": cp["resumeToken"], "state": {"done": True}}
        owner = self
        class Delayed:
            epoch = owner.backend.epoch
            armed = True
            winner = None
            def now(self):
                return owner.backend.now()
            def read(self, tenant, key):
                prior = owner.backend.read(tenant, key)
                if self.armed and key["kind"] == "receipt" and prior is None:
                    self.armed = False
                    self.winner = owner.execute(command)
                return prior
            def commit(self, *args):
                return owner.backend.commit(*args)
        delayed = Delayed()
        peer = WorkflowStore(delayed, resume_secret=SECRET, authorize_persistence=lambda *_: True)
        self.assertEqual(peer.execute(ACTOR, command), delayed.winner)
        self.assertEqual(self.execute({"action": "getSession", "sessionId": session["sessionId"]})["version"], 3)


if __name__ == "__main__":
    unittest.main()
