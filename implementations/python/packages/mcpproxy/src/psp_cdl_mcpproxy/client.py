# SPDX-License-Identifier: Apache-2.0
"""Dedicated, bounded MCP stdio child; no shell, inherited credentials or retries."""
import os
import queue
import subprocess
import threading
import time
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_api_server.persistence import integer
from .peer import PinnedMcpClient, PeerError, json_copy

LIMIT = 1_048_576


class StdioMcpClient(PinnedMcpClient):
    def __init__(self, config):
        self._config = config
        self._closed = threading.Event()
        self._fault = None
        self._state_lock, self._request_lock = threading.Lock(), threading.Lock()
        self._expected, self._id = None, 0
        self._responses, self._writes = queue.Queue(maxsize=1), queue.Queue(maxsize=1)
        self._catalog, self._fingerprint = [], ""
        try:
            self._child = subprocess.Popen([config["executable"], *config["args"]], env=config["env"], shell=False, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except Exception: raise PeerError("PEER_CLOSED") from None
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._writer = threading.Thread(target=self._write, daemon=True)
        self._reader.start()
        self._writer.start()

    @classmethod
    def connect(cls, config):
        c = json_copy(config)
        if type(c) is not dict or set(c) != {"executable","args","env","serverInfo","timeoutMs"} or type(c["serverInfo"]) is not dict or set(c["serverInfo"]) != {"name","version"}: raise PeerError("INVALID_CONFIGURATION")
        if type(c) is not dict or type(c.get("executable")) is not str or not os.path.isabs(c["executable"]) or type(c.get("args")) is not list or any(type(v) is not str or "\0" in v for v in c["args"]) or type(c.get("env")) is not dict or any(type(v) is not str or not k or "=" in k or "\0" in k or "\0" in v for k,v in c["env"].items()) or type(c.get("serverInfo")) is not dict or any(type(c["serverInfo"].get(k)) is not str for k in ("name", "version")) or not integer(c.get("timeoutMs")) or not 1 <= c["timeoutMs"] <= 30_000:
            raise PeerError("INVALID_CONFIGURATION")
        peer = cls(c)
        try:
            peer._initialize(c["serverInfo"])
            return peer
        except Exception:
            peer.close()
            raise

    @property
    def catalog_digest(self): return self._fingerprint

    def _stop(self, code):
        with self._state_lock:
            if self._fault is None: self._fault = code
            self._closed.set()
        try:
            if self._child.poll() is None: self._child.kill()
        except OSError: pass

    def close(self):
        self._stop("PEER_CLOSED")
        self._child.wait(timeout=5)
        self._reader.join(timeout=5)
        self._writer.join(timeout=5)
        for stream in (self._child.stdin, self._child.stdout):
            try: stream.close()
            except OSError: pass  # A killed child may leave a buffered pipe write.

    def _read(self):
        try:
            while not self._closed.is_set():
                frame = self._child.stdout.readline(LIMIT + 2)
                if not frame: raise PeerError("PEER_CLOSED")
                if len(frame.rstrip(b"\n")) > LIMIT: raise PeerError("FRAME_TOO_LARGE")
                if not frame.endswith(b"\n"): raise PeerError("INVALID_RESPONSE")
                value = parse_json(frame[:-1].decode("utf-8", errors="strict"))
                with self._state_lock: expected = self._expected
                if type(value) is not dict or value.get("jsonrpc") != "2.0" or expected is None or type(value.get("id")) not in (int,float) or value["id"] != expected or set(value)-{"jsonrpc","id","result","error"} or ("result" in value) == ("error" in value):
                    raise PeerError("INVALID_RESPONSE")
                if "error" in value: raise PeerError("REMOTE_ERROR")
                with self._state_lock: self._expected = None
                self._responses.put_nowait(value["result"])
        except Exception as exc: self._stop(exc.code if isinstance(exc,PeerError) else "INVALID_RESPONSE")

    def _write(self):
        while not self._closed.is_set():
            try: wire, done = self._writes.get(timeout=0.05)
            except queue.Empty: continue
            try:
                self._child.stdin.write(wire)
                self._child.stdin.flush()
                done.set()
            except Exception:
                self._stop("PEER_CLOSED")
                return

    def _enqueue(self, value):
        wire = (canonical_json(json_copy(value)) + "\n").encode("utf-8")
        done = threading.Event()
        try: self._writes.put_nowait((wire, done))
        except queue.Full: raise PeerError("PEER_BUSY") from None
        return done

    def _check(self, expires, cancelled):
        if self._closed.is_set(): raise PeerError(self._fault)
        if cancelled():
            self._stop("PEER_CANCELLED")
            raise PeerError("PEER_CANCELLED")
        if time.monotonic() >= expires:
            self._stop("PEER_TIMEOUT")
            raise PeerError("PEER_TIMEOUT")

    def _notify(self, method, params):
        expires = time.monotonic() + self._config["timeoutMs"] / 1000
        done = self._enqueue({"jsonrpc":"2.0", "method":method, "params":params})
        while not done.wait(0.01): self._check(expires, lambda:False)
        self._check(expires, lambda:False)

    def _request(self, method, params, cancelled=lambda:False):
        if not self._request_lock.acquire(blocking=False): raise PeerError("PEER_BUSY")
        try:
            expires = time.monotonic() + self._config["timeoutMs"] / 1000
            self._check(expires, cancelled)
            self._id += 1
            with self._state_lock: self._expected = self._id
            self._enqueue({"jsonrpc":"2.0", "id":self._id, "method":method, "params":params})
            while True:
                self._check(expires, cancelled)
                try: result = self._responses.get(timeout=0.01)
                except queue.Empty: continue
                self._check(expires, cancelled)
                return result
        finally: self._request_lock.release()
