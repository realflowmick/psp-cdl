# SPDX-License-Identifier: Apache-2.0
"""Bounded, host-authenticated Streamable HTTP; request-local service ownership."""
import re
import threading
import time
import uuid
import socket
from http.server import BaseHTTPRequestHandler
from types import SimpleNamespace
from urllib.parse import urlsplit
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_api_server import SecurityService, ServiceError
from .server import McpServer, MCP_VERSION

HTTP_LIMIT = 1_048_576

def fail(code, status=400): raise ServiceError(code, status)

def endpoint_url(value, allow_loopback_http):
    try:
        u = urlsplit(value)
        valid = type(value) is str and u.geturl() == value and u.hostname and not u.username and not u.password and not u.query and not u.fragment and re.fullmatch(r"/[A-Za-z0-9/_-]*", u.path) and u.netloc == u.netloc.lower() and u.port != (443 if u.scheme == "https" else 80) and (u.scheme == "https" or allow_loopback_http and u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1"))
        if not valid: fail("INVALID_CONFIGURATION")
        return u
    except Exception: fail("INVALID_CONFIGURATION")

def owner(p): return canonical_json([p["tenantId"], p["subjectId"]])
def rpc_id(v): return type(v) is str and len(v.encode("utf-8"))<=128 or type(v) in (int,float) and v == int(v) and abs(v) <= 9_007_199_254_740_991

class McpHttpServer:
    def __init__(self, host, config):
        c = self.config = parse_json(canonical_json(config))
        if set(c) != {"endpoint","allowLoopbackHttp","authorizationServers","maxSessions","sessionTtlMs","callTimeoutMs"} or type(c["allowLoopbackHttp"]) is not bool or type(c["authorizationServers"]) is not list or not 1 <= len(c["authorizationServers"]) <= 16 or any(type(c[k]) is not int or not 1 <= c[k] <= limit for k,limit in (("maxSessions",1024),("sessionTtlMs",3_600_000),("callTimeoutMs",30_000))): fail("INVALID_CONFIGURATION")
        self.url = endpoint_url(c["endpoint"], c["allowLoopbackHttp"])
        for issuer in c["authorizationServers"]: endpoint_url(issuer, False)
        self.host = host
        self.auth = SecurityService(SimpleNamespace(authenticate=lambda token:host.authenticate(token,c["endpoint"])))
        self._closed=False
        self._sessions, self._lock = {}, threading.Lock()

    def _response(self, status, value=None):
        body = "" if value is None else canonical_json(value)
        if len(body.encode("utf-8")) > HTTP_LIMIT: fail("RESPONSE_TOO_LARGE",500)
        headers = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}
        if status == 405: headers["allow"] = "POST, DELETE"
        if status == 401: headers["www-authenticate"] = f'Bearer resource_metadata="{self.url.scheme}://{self.url.netloc}/.well-known/oauth-protected-resource{self.url.path}"'
        return {"status":status,"headers":headers,"body":body}

    def close(self):
        self._closed=True
        with self._lock:
            for s in self._sessions.values(): s["cancelled"].set()
            self._sessions.clear()

    def handle(self, request):
        slot, sid, opened, initializing, initialized = None, None, None, False, False
        try:
            if self._closed: fail("SERVICE_CLOSED",503)
            h = {}
            for name,value in request["headers"]:
                k = name.lower()
                if k in h or re.search(r"[\r\n]",value): fail("INVALID_REQUEST")
                h[k] = value
            if sum(len(k.encode("utf-8"))+len(v.encode("utf-8"))+4 for k,v in h.items())>8192: fail("INVALID_REQUEST")
            if h.get("host") != self.url.netloc: fail("HOST_REJECTED",403)
            if "origin" in h: fail("ORIGIN_REJECTED",403)
            if request["method"] == "GET" and request["path"] == "/.well-known/oauth-protected-resource" + self.url.path:
                return self._response(200,{"resource":self.config["endpoint"],"authorization_servers":self.config["authorizationServers"],"bearer_methods_supported":["header"]})
            auth = h.get("authorization", "")
            token = auth[7:] if re.fullmatch(r"Bearer [\x21-\x7e]+",auth,re.I) else None
            principal = self.auth.authenticate(token)
            if request["path"] != self.url.path: fail("NOT_FOUND",404)
            if request["method"] not in ("POST","DELETE"): fail("METHOD_NOT_ALLOWED",405)
            if "last-event-id" in h: fail("RESUMPTION_UNSUPPORTED")
            if "mcp-protocol-version" in h and h["mcp-protocol-version"] != MCP_VERSION: fail("UNSUPPORTED_PROTOCOL")
            sid = h.get("mcp-session-id")
            # Only session bookkeeping is locked. Cancellation can run during a tool call.
            with self._lock:
                if self._closed: fail("SERVICE_CLOSED",503)
                for key,s in list(self._sessions.items()):
                    if time.monotonic() >= s["expires"] and not s["busy"]: del self._sessions[key]
                existing = self._sessions.get(sid)
                if sid is not None and (existing is None or existing["owner"] != owner(principal) or time.monotonic() >= existing["expires"]): fail("NOT_FOUND",404)
                if request["method"] == "DELETE":
                    if existing is None: fail("SESSION_REQUIRED")
                    existing["cancelled"].set()
                    del self._sessions[sid]
                    return self._response(200)
                if not re.fullmatch(r"application/json(?:;\s*charset=utf-8)?", h.get("content-type",""), re.I) or "content-encoding" in h: fail("UNSUPPORTED_MEDIA_TYPE",415)
                accept = [v.strip().lower() for v in h.get("accept", "").split(",")]
                if not all(v in accept for v in ("application/json","text/event-stream")): fail("NOT_ACCEPTABLE",406)
                if len(request["body"]) > HTTP_LIMIT: fail("REQUEST_TOO_LARGE",413)
                try: m = parse_json(request["body"].decode("utf-8",errors="strict"))
                except Exception: fail("INVALID_REQUEST")
                if type(m) is not dict or m.get("jsonrpc") != "2.0" or type(m.get("method")) is not str or set(m)-{"jsonrpc","id","method","params"} or "id" in m and not rpc_id(m["id"]): fail("INVALID_REQUEST")
                if existing is None:
                    if m["method"] != "initialize" or "id" not in m: fail("SESSION_REQUIRED")
                    if len(self._sessions) >= self.config["maxSessions"]: fail("SESSION_CAPACITY",503)
                    sid = str(uuid.uuid4())
                    existing = {"owner":owner(principal),"expires":time.monotonic()+self.config["sessionTtlMs"]/1000,"busy":False,"cancelled":threading.Event(),"seen":set(),"server":None,"active":None}
                    self._sessions[sid] = existing
                    initializing = True
                elif m["method"] == "initialize": fail("ALREADY_INITIALIZED",409)
                if m["method"] == "notifications/cancelled" and "id" not in m:
                    params = m.get("params")
                    if type(params) is dict and not set(params)-{"requestId","reason","_meta"} and ("reason" not in params or type(params["reason"]) is str) and ("_meta" not in params or type(params["_meta"]) is dict) and rpc_id(params.get("requestId")) and existing["active"] is not None and canonical_json(params["requestId"]) == canonical_json(existing["active"]): existing["cancelled"].set()
                    return self._response(202)
                if existing["busy"]: fail("SESSION_BUSY",409)
                if "id" in m:
                    key = canonical_json(m["id"])
                    if key in existing["seen"]: fail("DUPLICATE_REQUEST",409)
                    if len(existing["seen"]) >= 4096:
                        del self._sessions[sid]
                        fail("NOT_FOUND",404)
                    existing["seen"].add(key)
                slot = existing
                slot["busy"] = True
                slot["cancelled"].clear()
                if not initializing: slot["active"] = m.get("id")
            deadline = time.monotonic() + self.config["callTimeoutMs"]/1000
            cancelled = lambda:slot["cancelled"].is_set() or time.monotonic() >= min(deadline,slot["expires"])
            opened = self.host.open(parse_json(canonical_json(principal)),cancelled)
            if cancelled(): return self._response(204)
            if slot["server"] is None: slot["server"] = McpServer(self.auth,lambda:None)
            result = slot["server"].handle(canonical_json(m),{"token":token,"service":opened["service"],"principal":principal})
            if cancelled(): return self._response(204)
            if owner(self.auth.authenticate(token)) != slot["owner"]: fail("UNAUTHENTICATED",401)
            if cancelled(): return self._response(204)
            response = self._response(202 if result is None else 200,result)
            if initializing and result is not None and type(result.get("result")) is dict:
                initialized = True
                response["headers"]["mcp-session-id"] = sid
            return response
        except Exception as exc:
            err = exc if isinstance(exc,ServiceError) else ServiceError("INTERNAL_ERROR",500)
            return self._response(err.status,{"error":{"code":err.code}})
        finally:
            if opened is not None:
                try: opened["close"]()
                except Exception: pass
            if slot is not None:
                with self._lock:
                    slot["busy"],slot["active"] = False,None
                    if initializing and not initialized or time.monotonic() >= slot["expires"]: self._sessions.pop(sid,None)

def make_http_handler(adapter):
    """For a host-owned threaded HTTP(S) server; no logging of URLs or credentials."""
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def setup(self):
            self.request.settimeout(5)
            super().setup()
        def log_message(self, *_): pass
        def do_POST(self): self._handle()
        def do_GET(self): self._handle()
        def do_DELETE(self): self._handle()
        def _handle(self):
            def interrupt_read():
                try: self.connection.shutdown(socket.SHUT_RDWR)
                except OSError: pass
            timer = threading.Timer(5,interrupt_read)
            timer.daemon = True
            timer.start()
            try:
                pairs = list(self.headers.raw_items())
                lengths = self.headers.get_all("Content-Length",[])
                if self.headers.get("Transfer-Encoding") is not None or len(lengths)>1 or lengths and not re.fullmatch(r"[0-9]{1,10}",lengths[0]):
                    result = {"status":400,"headers":{},"body":""}
                elif int(lengths[0] if lengths else 0)>HTTP_LIMIT:
                    result = {"status":413,"headers":{},"body":""}
                else:
                    length = int(lengths[0] if lengths else 0)
                    body = self.rfile.read(length)
                    timer.cancel()
                    if len(body)!=length: return
                    result = adapter.handle({"method":self.command,"path":self.path,"headers":pairs,"body":body})
                wire = result["body"].encode("utf-8")
                self.send_response(result["status"])
                for k,v in result["headers"].items(): self.send_header(k,v)
                self.send_header("Content-Length",str(len(wire)))
                self.send_header("Connection","close")
                self.end_headers()
                self.wfile.write(wire)
            except (OSError,ValueError): pass
            finally:
                timer.cancel()
                self.close_connection = True
    return Handler
