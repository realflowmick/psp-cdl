# SPDX-License-Identifier: Apache-2.0
"""Framework-neutral HTTP adapter and bounded WSGI entry point."""
import re
from http import HTTPStatus
from psp_cdl_core import canonical_json, parse_json
from .service import MAX_REQUEST_BYTES, SecurityService, ServiceError

ROUTES={"/v1/security/verify":"verify","/v1/policy/evaluate":"evaluate"}

def response(status,value):
    headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}
    if status==401:
        headers["www-authenticate"]='Bearer realm="psp-reference"'
    return {"status":status,"headers":headers,"body":canonical_json(value)}

def error_response(error):
    error=error if isinstance(error,ServiceError) else ServiceError("INTERNAL_ERROR",500)
    return response(error.status,{"error":{"code":error.code}})

def handle_http(service: SecurityService, request: dict):
    try:
        headers={}
        for name,value in request["headers"]:
            name=name.lower()
            if name in headers or re.search(r"[\r\n]",value):
                raise ServiceError("INVALID_REQUEST",400)
            headers[name]=value
        auth=headers.get("authorization","")
        token=auth[7:] if re.fullmatch(r"Bearer [\x21-\x7e]+",auth,re.I) else None
        service.authenticate(token)
        if "origin" in headers:
            raise ServiceError("ORIGIN_REJECTED",403)
        if request["method"]!="POST":
            raise ServiceError("METHOD_NOT_ALLOWED",405)
        if request["path"] not in ROUTES:
            raise ServiceError("NOT_FOUND",404)
        if not re.fullmatch(r"application/json(?:;\s*charset=utf-8)?",headers.get("content-type",""),re.I) or "content-encoding" in headers:
            raise ServiceError("UNSUPPORTED_MEDIA_TYPE",415)
        if len(request["body"])>MAX_REQUEST_BYTES:
            raise ServiceError("REQUEST_TOO_LARGE",413)
        try:
            value=parse_json(request["body"].decode("utf-8",errors="strict"))
        except (ValueError,UnicodeError) as exc:
            raise ServiceError("INVALID_REQUEST",400) from exc
        return response(200,service.invoke(ROUTES[request["path"]],value,token))
    except Exception as exc:
        return error_response(exc)

def create_wsgi_app(service: SecurityService):
    """Serve behind a WSGI host that rejects duplicate/framing headers and sets timeouts."""
    def application(environ,start_response):
        try:
            host=environ.get("HTTP_HOST","")
            if host not in {name+":"+str(environ["SERVER_PORT"]) for name in ("localhost","127.0.0.1","[::1]")}:
                raise ServiceError("HOST_REJECTED",403)
            if environ.get("HTTP_TRANSFER_ENCODING"):
                raise ServiceError("INVALID_REQUEST",400)
            size=environ.get("CONTENT_LENGTH","")
            if re.fullmatch(r"[0-9]{1,10}",size) is None:
                raise ServiceError("INVALID_REQUEST",400)
            length=int(size)
            if length>MAX_REQUEST_BYTES:
                raise ServiceError("REQUEST_TOO_LARGE",413)
            body=environ["wsgi.input"].read(length)
            if len(body)!=length:
                raise ServiceError("INVALID_REQUEST",400)
            headers=[(k[5:].replace("_","-"),v) for k,v in environ.items() if k.startswith("HTTP_")]
            headers.append(("content-type",environ.get("CONTENT_TYPE","")))
            path=environ.get("PATH_INFO","")+("?"+environ["QUERY_STRING"] if environ.get("QUERY_STRING") else "")
            result=handle_http(service,{"method":environ["REQUEST_METHOD"],"path":path,"headers":headers,"body":body})
        except Exception as exc:
            result=error_response(exc)
        body=result["body"].encode("utf-8")
        start_response(str(result["status"])+" "+HTTPStatus(result["status"]).phrase,[*result["headers"].items(),("Content-Length",str(len(body)))])
        return [body]
    return application
