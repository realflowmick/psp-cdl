# SPDX-License-Identifier: Apache-2.0
"""Exercise both real bounded HTTPS transports against ephemeral, synthetic local TLS."""
import datetime
import ipaddress
import json
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from provider_fixtures import SUITE

ROOT = Path(__file__).resolve().parents[1]


def certificate(directory, wrong=False):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PSP synthetic provider test")])
    now = datetime.datetime.now(datetime.timezone.utc)
    san = x509.DNSName("wrong.example") if wrong else x509.IPAddress(ipaddress.ip_address("127.0.0.1"))
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1))
            .not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([san]), critical=False).sign(key, hashes.SHA256()))
    cert_path, key_path = Path(directory)/f"{wrong}.pem", Path(directory)/f"{wrong}.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return str(cert_path), str(key_path)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_): pass

    def do_POST(self):
        mode = self.server.mode
        self.server.calls += 1
        body = self.rfile.read(int(self.headers["Content-Length"]))
        request = json.loads(body)
        assert self.path == "/v1/chat/completions"
        assert self.headers["Authorization"] == "Bearer SYNTHETIC_HTTP_KEY"
        assert self.headers["Accept-Encoding"] == "identity"
        assert b"SYNTHETIC_HTTP_KEY" not in body and "tenantId" not in request
        assert request["stream"] is False and request["store"] is False
        if mode in ("hang", "cancel"):
            self.server.release.wait(4)
            return
        payload = json.dumps(SUITE["final"], ensure_ascii=False).encode("utf-8")
        self.send_response(302 if mode == "redirect" else 429 if mode == "error" else 200)
        self.send_header("Content-Type", "text/event-stream" if mode == "sse" else "application/json")
        if mode == "compressed": self.send_header("Content-Encoding", "gzip")
        if mode == "redirect": self.send_header("Location", "https://example.invalid/do-not-follow")
        if mode == "large-header": self.send_header("Content-Length", "1048577")
        elif mode == "truncated": self.send_header("Content-Length", str(len(payload)+10))
        elif mode == "large-body":
            payload = b"x"*5000
            self.send_header("Connection", "close")
        elif mode == "chunked": self.send_header("Transfer-Encoding", "chunked")
        else: self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if mode == "cancel-body":
            self.wfile.write(payload[:8])
            self.wfile.flush()
            self.connection.settimeout(3)
            # Observe client shutdown while a partial body is buffered.
            assert self.rfile.read(1) == b""
            return
        try:
            if mode == "chunked":
                for part in (payload[:7], payload[7:]): self.wfile.write(f"{len(part):x}\r\n".encode()+part+b"\r\n")
                self.wfile.write(b"0\r\n\r\n")
            else: self.wfile.write(payload)
            self.wfile.flush()
        except (OSError, ssl.SSLError): pass
        self.close_connection = True


class TestServer(ThreadingHTTPServer):
    def handle_error(self, _request, _address):
        # Handler assertions must fail the harness, not just print on a worker.
        self.errors.append(str(sys.exception()))


def run():
    count = 0
    with tempfile.TemporaryDirectory(prefix="psp-provider-tls-") as directory:
        for wrong in (False, True):
            cert, key = certificate(directory, wrong)
            server = TestServer(("127.0.0.1", 0), Handler)
            server.daemon_threads = True
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            server.release = threading.Event()
            server.mode, server.calls = "ok", 0
            server.errors = []
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            cases = [("wrong-hostname", "PROVIDER_FAILED", 0)] if wrong else [
                ("ok", "OK", 1), ("chunked", "OK", 1), ("untrusted", "PROVIDER_FAILED", 0),
                ("redirect", "PROVIDER_HTTP_ERROR", 1), ("error", "PROVIDER_HTTP_ERROR", 1),
                ("sse", "INVALID_RESPONSE", 1), ("compressed", "INVALID_RESPONSE", 1),
                ("large-header", "RESPONSE_TOO_LARGE", 1), ("large-body", "RESPONSE_TOO_LARGE", 1),
                ("truncated", "PROVIDER_FAILED", 1), ("hang", "DEADLINE_EXCEEDED", 1), ("cancel", "CANCELLED", 1),
                ("cancel-body", "CANCELLED", 1)]
            try:
                for mode, expected, calls in cases:
                    reports = []
                    for command in (["node", "scripts/provider-http-client.mjs"], [sys.executable, "scripts/provider_http_client.py"]):
                        server.mode, server.calls = mode, 0
                        config = {"mode": mode, "endpoint": f"https://127.0.0.1:{server.server_port}/v1/chat/completions", "cert": cert, "untrusted": mode == "untrusted"}
                        process = subprocess.run([*command, json.dumps(config)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=10)
                        assert process.returncode == 0, process.stderr
                        report = json.loads(process.stdout)
                        assert report["code"] == expected, (mode, command, report, process.stderr)
                        assert report["released"] == int(expected == "OK"), report
                        assert server.calls == calls, (mode, command, server.calls)
                        assert "PRIVATE_" not in process.stdout and "SYNTHETIC_HTTP_KEY" not in process.stdout
                        reports.append(report)
                        count += 1
                    assert reports[0] == reports[1], (mode, reports)
                    assert not server.errors, server.errors
            finally:
                server.release.set()
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)
    print(f"{count} actual local HTTPS provider checks passed in both languages; TLS trust/hostname failures, bounded bodies, redirects, cancellation and timeout release no output. Paid provider smoke: NOT RUN.")


if __name__ == "__main__": run()
