# SPDX-License-Identifier: Apache-2.0
"""Pinned HTTP resource; verified TLS, bounded JSON/SSE and explicit cancellation."""
import http.client
import queue
import re
import socket
import ssl
import threading
import time
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_mcp_server import MCP_VERSION
from psp_cdl_mcp_server.http import endpoint_url, HTTP_LIMIT
from psp_cdl_mcp_server.revision import REVISION_PROFILE
from .peer import PinnedMcpClient, PeerError, json_copy

def parse_sse(source):
    data, event, found, result = [], "", False, None
    normalized=source.replace("\r\n","\n").replace("\r","\n")
    lines=normalized.split("\n")
    if normalized.endswith("\n"): lines.pop()
    for line in lines:
        if not line:
            payload = "\n".join(data)
            if payload:
                if found or event not in ("","message"): raise PeerError("INVALID_RESPONSE")
                result,found = parse_json(payload),True
            data,event = [],""
            continue
        if line.startswith(":"): continue
        field,_,value = line.partition(":")
        if value.startswith(" "): value = value[1:]
        if field == "data": data.append(value)
        elif field == "event": event = value
        elif field not in ("id","retry"): raise PeerError("INVALID_RESPONSE")
    if data or not found: raise PeerError("INVALID_RESPONSE")
    return result

class HttpMcpClient(PinnedMcpClient):
    def __init__(self, config, credential):
        self.config,self.credential = config,credential
        self.url = endpoint_url(config["endpoint"],config["allowLoopbackHttp"])
        self._closed,self._lock = threading.Event(),threading.Lock()
        self._session,self._id,self._connection = None,0,None

    @classmethod
    def connect(cls, value, credential):
        c = json_copy(value)
        if type(c) is not dict or set(c)-{"endpoint","allowLoopbackHttp","serverInfo","timeoutMs","caPem","revisionProfile"} or type(c.get("endpoint")) is not str or type(c.get("allowLoopbackHttp")) is not bool or type(c.get("serverInfo")) is not dict or set(c["serverInfo"]) != {"name","version"} or any(type(v) is not str for v in c["serverInfo"].values()) or type(c.get("timeoutMs")) is not int or not 1 <= c["timeoutMs"] <= 30_000 or "caPem" in c and type(c["caPem"]) is not str or not callable(credential): raise PeerError("INVALID_CONFIGURATION")
        if "revisionProfile" in c and c["revisionProfile"]!=REVISION_PROFILE: raise PeerError("INVALID_CONFIGURATION")
        try: peer = cls(c,credential)
        except Exception: raise PeerError("INVALID_CONFIGURATION") from None
        try:
            peer._initialize(c["serverInfo"],c.get("revisionProfile"))
            return peer
        except Exception:
            peer._closed.set()
            peer._abort(peer._connection)
            raise

    @staticmethod
    def _abort(conn):
        if conn is not None:
            try:
                if conn.sock is not None: conn.sock.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            conn.close()

    def close(self):
        if self._lock.acquire(blocking=False):
            try:
                if not self._closed.is_set() and self._session:
                    try: self._exchange(None,"DELETE")
                    except Exception: pass
            finally: self._lock.release()
        self._closed.set()
        self._abort(self._connection)

    def _exchange(self, message, method="POST", cancelled=lambda:False, cancellation=False):
        if cancelled(): raise PeerError("PEER_CANCELLED")
        stopped, results = threading.Event(), queue.Queue(maxsize=1)
        timeout = min(1000,self.config["timeoutMs"]) if cancellation else self.config["timeoutMs"]
        expires = time.monotonic()+timeout/1000
        connection = [None]
        def work():
            conn = None
            try:
                token = self.credential(self.config["endpoint"])
                if stopped.is_set(): return
                if type(token) is not str or not re.fullmatch(r"[\x21-\x7e]{1,4096}",token): raise PeerError("INVALID_CREDENTIAL")
                wire = b"" if message is None else canonical_json(json_copy(message)).encode("utf-8")
                if self.url.scheme == "https":
                    context = ssl.create_default_context(cadata=self.config.get("caPem"))
                    conn = http.client.HTTPSConnection(self.url.hostname,self.url.port,timeout=timeout/1000,context=context)
                else: conn = http.client.HTTPConnection(self.url.hostname,self.url.port,timeout=timeout/1000)
                connection[0] = conn
                if not cancellation: self._connection = conn
                headers = {"Authorization":"Bearer "+token,"Accept":"application/json, text/event-stream","Content-Type":"application/json","Content-Length":str(len(wire)),"MCP-Protocol-Version":MCP_VERSION}
                if self._session: headers["MCP-Session-Id"] = self._session
                # Resolve/connect and authenticate TLS before sending any credential or data.
                conn.connect()
                if stopped.is_set(): return
                conn.request(method,self.url.path,body=wire,headers=headers)
                response = conn.getresponse()
                h = {}
                for k,v in response.getheaders():
                    k = k.lower()
                    if k in h: raise PeerError("INVALID_RESPONSE")
                    h[k] = v
                if sum(len(k)+len(v)+4 for k,v in h.items())>8192: raise PeerError("INVALID_RESPONSE")
                if not 200 <= response.status < 300: raise PeerError({401:"PEER_UNAUTHENTICATED",403:"PEER_FORBIDDEN",404:"PEER_SESSION_EXPIRED"}.get(response.status,"PEER_HTTP_ERROR"))
                if "content-encoding" in h: raise PeerError("INVALID_RESPONSE")
                session = h.get("mcp-session-id")
                if session is not None and (not re.fullmatch(r"[\x21-\x7e]{1,128}",session) or self._session is not None and session != self._session or self._session is None and (message or {}).get("method") != "initialize"): raise PeerError("INVALID_SESSION")
                body = response.read(HTTP_LIMIT+1)
                if len(body) > HTTP_LIMIT: raise PeerError("FRAME_TOO_LARGE")
                if response.length not in (0,None): raise PeerError("INVALID_RESPONSE")
                source = body.decode("utf-8",errors="strict")
                if method == "DELETE":
                    if source: raise PeerError("INVALID_RESPONSE")
                    value = None
                elif "id" not in message:
                    if response.status != 202 or source: raise PeerError("INVALID_RESPONSE")
                    value = None
                else:
                    if response.status != 200: raise PeerError("INVALID_RESPONSE")
                    media = h.get("content-type","")
                    if re.fullmatch(r"application/json(?:;\s*charset=utf-8)?",media,re.I): v = parse_json(source)
                    elif re.fullmatch(r"text/event-stream(?:;\s*charset=utf-8)?",media,re.I): v = parse_sse(source)
                    else: raise PeerError("INVALID_RESPONSE")
                    if type(v) is not dict or v.get("jsonrpc") != "2.0" or type(v.get("id")) not in (int,float) or v["id"] != message["id"] or set(v)-{"jsonrpc","id","result","error"} or ("result" in v) == ("error" in v): raise PeerError("INVALID_RESPONSE")
                    if "error" in v: raise PeerError("REMOTE_ERROR")
                    value = v["result"]
                    if message["method"] == "initialize" and not stopped.is_set(): self._session = session
                results.put_nowait((value,None))
            except Exception as exc:
                results.put_nowait((None,exc if isinstance(exc,PeerError) else PeerError("PEER_TIMEOUT" if isinstance(exc,TimeoutError) else "PEER_CONNECTION_FAILED" if isinstance(exc,(OSError,ssl.SSLError)) else "INVALID_RESPONSE")))
            finally:
                if conn is not None: conn.close()
        worker = threading.Thread(target=work,daemon=True)
        worker.start()
        try:
            while True:
                try: is_cancelled = cancelled()
                except Exception: is_cancelled = True
                if is_cancelled: raise PeerError("PEER_CANCELLED")
                if time.monotonic() >= expires: raise PeerError("PEER_TIMEOUT")
                try: value,error = results.get(timeout=0.01)
                except queue.Empty: continue
                if error: raise error
                return value
        finally:
            stopped.set()
            self._abort(connection[0])
            worker.join(timeout=0.05)
            if not cancellation: self._connection = None

    def _notify(self, method, params): self._exchange({"jsonrpc":"2.0","method":method,"params":params})

    def _request(self, method, params, cancelled=lambda:False):
        if self._closed.is_set(): raise PeerError("PEER_CLOSED")
        if not self._lock.acquire(blocking=False): raise PeerError("PEER_BUSY")
        self._id += 1
        try: return self._exchange({"jsonrpc":"2.0","id":self._id,"method":method,"params":params},cancelled=cancelled)
        except Exception as exc:
            if method != "initialize" and isinstance(exc,PeerError) and exc.code in ("PEER_CANCELLED","PEER_TIMEOUT"):
                try: self._exchange({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":self._id}},cancellation=True)
                except Exception: pass
            self._closed.set()
            raise
        finally: self._lock.release()
