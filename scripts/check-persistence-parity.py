# SPDX-License-Identifier: Apache-2.0
"""Real mixed-language database interchange, races and process-crash recovery."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from persistence_fixtures import FIXTURE

ROOT = Path(__file__).resolve().parents[1]
PEERS = {"ts": ["node", "scripts/persistence-probe.mjs"], "py": [sys.executable, "scripts/persistence_probe.py"]}
ACTOR = FIXTURE["actor"]
NODE = next(s["command"] for s in FIXTURE["steps"] if s["id"] == "node")
CREATE = next(s["command"] for s in FIXTURE["steps"] if s["id"] == "session")


def call(lang, path, command=None, **options):
    p = subprocess.run([*PEERS[lang], str(path)], cwd=ROOT, input=json.dumps({"actor": ACTOR, "command": command, **options}, ensure_ascii=False), text=True, encoding="utf-8", capture_output=True, timeout=20, check=True)
    return json.loads(p.stdout) if p.stdout else None


def race(path, directory, commands):
    processes = []
    gate = directory / "go"
    try:
        for lang, command in zip(("ts", "py"), commands):
            ready = directory / (lang + ".ready")
            p = subprocess.Popen([*PEERS[lang], str(path)], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
            processes.append((p, ready))
            p.stdin.write(json.dumps({"actor": ACTOR, "command": command, "barrier": {"ready": str(ready), "go": str(gate)}}))
            p.stdin.close()
            p.stdin = None
        deadline = time.monotonic() + 12
        while not all(ready.exists() for _, ready in processes):
            if any(p.poll() is not None for p, _ in processes) or time.monotonic() > deadline:
                raise AssertionError("Peer did not reach the pre-commit barrier")
            time.sleep(0.02)
        gate.write_text("go", encoding="utf-8")
        results = []
        for p, _ in processes:
            out, err = p.communicate(timeout=15)
            assert p.returncode == 0, err
            results.append(json.loads(out))
        return results
    finally:
        for p, _ in processes:
            if p.poll() is None:
                p.kill()
            p.communicate(timeout=5)


def main():
    with tempfile.TemporaryDirectory(prefix="psp-parity-") as temp:
        directory = Path(temp)
        ts = call("ts", directory / "ts.sqlite", mode="fixture")
        py = call("py", directory / "py.sqlite", mode="fixture")
        assert ts == py
        for creator, consumer in (("ts", "py"), ("py", "ts")):
            path = directory / (creator + "-shared.sqlite")
            node = call(creator, path, NODE)["result"]
            assert call(consumer, path, {"action": "getNode", "nodeId": "entry", "nodeVersion": "1"})["result"] == node
            session = call(creator, path, CREATE, crashAfterCommit=True)["result"]
            get = {"action": "getSession", "sessionId": session["sessionId"]}
            assert call(consumer, path, get)["result"] == session
            assert call(consumer, path, CREATE)["result"] == session  # Lost acknowledgement retry.
            cp_command = {"action": "createCheckpoint", "requestId": "cp", "sessionId": session["sessionId"], "expectedVersion": 1, "expiresAt": 150}
            cp = call(creator, path, cp_command)["result"]
            assert call(consumer, path, cp_command)["result"] == cp  # Identical HMAC token across languages.
            waiting = call(consumer, path, get)["result"]
            original_bytes = path.read_bytes()
            call(creator, path, mode="crashUncommitted")
            assert path.read_bytes() != original_bytes, "Crash probe must spill dirty pages before exit"
            assert Path(str(path) + "-journal").stat().st_size > 512
            assert call(consumer, path, get)["result"] == waiting  # Recover hot rollback journal.
            resume = {"action": "resumeCheckpoint", "requestId": "resume", "checkpointId": cp["checkpointId"], "resumeToken": cp["resumeToken"], "state": session["state"]}
            resumed = call(consumer, path, resume)["result"]
            assert resumed["state"] == session["state"] and resumed["version"] == 3
            assert call(creator, path, get)["result"] == resumed
            assert call(creator, path, resume)["result"] == resumed
            assert call(creator, path, {**resume, "requestId": "replay"}) == {"error": "CHECKPOINT_CONSUMED"}

        # Both peers have read the same revision before either can commit.
        for scenario in ("update", "resume", "identical-resume"):
            local = directory / scenario
            local.mkdir()
            path = local / "race.sqlite"
            call("ts", path, NODE)
            session = call("py", path, CREATE)["result"]
            if scenario == "update":
                command = {"action": "updateSession", "requestId": "update", "sessionId": session["sessionId"], "expectedVersion": 1, "nodeId": "entry", "nodeVersion": "1", "policyVersion": "p2", "status": "running", "state": {"result": "🧪"}}
            else:
                cp = call("ts", path, {"action": "createCheckpoint", "requestId": "cp", "sessionId": session["sessionId"], "expectedVersion": 1, "expiresAt": 150})["result"]
                command = {"action": "resumeCheckpoint", "requestId": "resume", "checkpointId": cp["checkpointId"], "resumeToken": cp["resumeToken"], "state": {"result": "🧪"}}
            other = command if scenario == "identical-resume" else {**command, "requestId": "competitor"}
            results = race(path, local, [command, other])
            if scenario == "identical-resume":
                assert results[0] == results[1] and "result" in results[0], results
            else:
                assert sum("result" in r for r in results) == 1, results
                expected_error = "STATE_CONFLICT" if scenario == "update" else "CHECKPOINT_CONSUMED"
                assert {"error": expected_error} in results, results
            current = call("py", path, {"action": "getSession", "sessionId": session["sessionId"]})["result"]
            assert current["version"] == (2 if scenario == "update" else 3)
            assert current["state"] == {"result": "🧪"}
        print(f"{len(ts)} shared persistence cases agree; bidirectional file/token interchange, abrupt-exit recovery and three mixed-language commit races passed.")


if __name__ == "__main__":
    main()
