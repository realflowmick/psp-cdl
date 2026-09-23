# SPDX-License-Identifier: Apache-2.0
"""Actual mixed-language HTTP/TLS peers plus shared authority boundary vectors."""
import contextlib
import datetime
import http.client
import ipaddress
import json
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from http_fixtures import SUITE, run_http_case, INITIALIZE, CALL
from http_probe import probe

ROOT=Path(__file__).resolve().parents[1]
def run(args): return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True,encoding="utf-8",timeout=45).stdout
ts=json.loads(run(["node","scripts/http-probe.mjs","--report"]))
for case,report in zip(SUITE["cases"],ts,strict=True):
    assert run_http_case(case)==report==case["expected"],(case["id"],report)
print(f'{len(ts)} Streamable HTTP authority/session scenarios agree.')

@contextlib.contextmanager
def peer(language,config):
    args=["node",str(ROOT/"scripts/http-peer.mjs")] if language=="ts" else [sys.executable,str(ROOT/"scripts/http_peer.py")]
    child=subprocess.Popen([*args,json.dumps(config)],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
    lines=queue.Queue()
    threading.Thread(target=lambda:lines.put(child.stdout.readline()),daemon=True).start()
    try:
        endpoint=lines.get(timeout=10).strip()
        assert endpoint.startswith(("http://","https://")),endpoint
        yield endpoint
    finally:
        child.stdin.close()
        try: child.wait(timeout=5)
        except subprocess.TimeoutExpired: child.kill();child.wait(timeout=5)
        errors=child.stderr.read()
        child.stdout.close();child.stderr.close()
        assert child.returncode==0,errors

def certificate(directory,valid=True):
    # Ephemeral test CA/leaf material stays in a temporary directory, never Git.
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,"PSP synthetic TLS fixture")])
    now=datetime.datetime.now(datetime.timezone.utc)
    cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))] if valid else [x509.DNSName("wrong.example")]),critical=False).sign(key,hashes.SHA256())
    prefix="valid" if valid else "wrong"
    cert_path,key_path=Path(directory)/(prefix+".pem"),Path(directory)/(prefix+".key")
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    return {"cert":str(cert_path),"key":str(key_path)}

def raw(endpoint,message,sid=None):
    u=urlsplit(endpoint)
    conn=http.client.HTTPConnection(u.hostname,u.port,timeout=5)
    headers={"Authorization":"Bearer test-owner","Content-Type":"application/json","Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-11-25"}
    if sid: headers["MCP-Session-Id"]=sid
    try:
        conn.request("POST",u.path,json.dumps(message,ensure_ascii=False).encode("utf-8"),headers)
        r=conn.getresponse();body=r.read().decode("utf-8")
        assert "PRIVATE_" not in body,body
        return r.status,dict(r.getheaders()),json.loads(body) if body else None
    finally: conn.close()

with tempfile.TemporaryDirectory(prefix="psp-http-") as directory:
    valid,wrong=certificate(directory),certificate(directory,False)
    cases=[("ok","OK",1), ("sse","OK",1), ("redirect","PEER_HTTP_ERROR",0), ("drift-before","TOOL_FAILED",0), ("drift-after","TOOL_FAILED",1), ("wrong-id","TOOL_FAILED",1), ("bad-text","TOOL_FAILED",1), ("bad-schema","INVALID_OUTPUT",1), ("oversize","TOOL_FAILED",1), ("session-switch","TOOL_FAILED",1), ("sse-notification","TOOL_FAILED",1), ("tool-error","TOOL_FAILED",1), ("hang","TOOL_FAILED",1), ("cancel","CANCELLED",1), ("tls","OK",1), ("untrusted-tls","PEER_CONNECTION_FAILED",0), ("wrong-hostname","PEER_CONNECTION_FAILED",0), ("wrong-token","PEER_UNAUTHENTICATED",0), ("reject-http","INVALID_CONFIGURATION",0), ("policy-deny","POLICY_DENIED",0), ("output-deny","OUTPUT_DENIED",1)]
    for language in ("ts","py"):
        for index,(mode,code,calls) in enumerate(cases):
            spy=Path(directory)/f'{language}-{index}.spy'
            cfg={"mode":mode,"spy":str(spy),**(wrong if mode=="wrong-hostname" else valid if mode in ("tls","untrusted-tls") else {})}
            with peer(language,cfg) as endpoint:
                client={"endpoint":endpoint,"spy":str(spy),"cancel":mode=="cancel","rejectHttp":mode=="reject-http",**({"ca":cfg["cert"]} if mode in ("tls","wrong-hostname") else {}),**({"token":"test-owner"} if mode=="wrong-token" else {}),"settings":{"policyDeny":mode=="policy-deny","outputDeny":mode=="output-deny"}}
                report=probe(client) if language=="ts" else json.loads(run(["node","scripts/http-probe.mjs",json.dumps(client)]))
                assert report["code"]==code,(language,mode,report)
                assert report["released"]==int(code=="OK"),(language,mode,report)
                assert "PRIVATE_" not in json.dumps(report)
                if code=="OK": assert report["data"]=={"message":"hello 🧪"} and report["trustLevel"]==5
                if mode in ("hang","cancel"):
                    until=time.monotonic()+2
                    while time.monotonic()<until and "cancelled" not in spy.read_text(): time.sleep(.01)
                    assert "cancelled" in spy.read_text(),(language,mode,"remote never observed cancellation")
                assert (spy.read_text().splitlines().count("call") if spy.exists() else 0)==calls,(language,mode)
        print(f'{len(cases)} real {"Python -> Node" if language=="ts" else "Node -> Python"} HTTP/TLS gated calls passed.')
    for proxy_lang,tool_lang in (("ts","py"),("py","ts")):
        for label,settings,mode,calls,success in (("ok",{},"sse",1,True),("deny",{"policyDeny":True},"ok",0,False),("output",{"outputDeny":True},"ok",1,False),("bad",{},"bad-text",1,False)):
            spy=Path(directory)/f'chain-{proxy_lang}-{label}.spy'
            with peer(tool_lang,{"mode":mode,"spy":str(spy)}) as downstream:
                with peer(proxy_lang,{"proxy":downstream,"settings":settings}) as upstream:
                    status,headers,body=raw(upstream,INITIALIZE)
                    assert status==200 and "result" in body,(status,body)
                    sid=next(v for k,v in headers.items() if k.lower()=="mcp-session-id")
                    assert raw(upstream,{"jsonrpc":"2.0","method":"notifications/initialized"},sid)[0]==202
                    status,_,body=raw(upstream,CALL,sid)
                    assert status==200 and ("structuredContent" in body["result"])==success,body
                    if success: assert body["result"]["_meta"]["psp-cdl/provenance"]["trustLevel"]==5
            assert (spy.read_text().splitlines().count("call") if spy.exists() else 0)==calls
    print('Eight real HTTP caller -> proxy -> downstream chains passed, including buffered SSE and denied output.')
