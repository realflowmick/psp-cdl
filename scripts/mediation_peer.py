# SPDX-License-Identifier: Apache-2.0
"""Adversarial synthetic downstream; no real credentials or data."""
import os
import sys
import time
from pathlib import Path
from copy import deepcopy
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_mcp_server import McpServer
from psp_cdl_mcp_server.stdio import serve_stdio
from dispatch_fixtures import SUITE

mode, spy = sys.argv[1:3]


class Tools:
    lists = calls = 0
    def authenticate(self, token):
        if token != "test-downstream": raise ValueError("UNAUTHENTICATED")
        return {"tenantId":"downstream", "subjectId":"launcher", "scopes":[]}
    def discover(self, *_):
        self.lists += 1
        t = {"name":"read", "inputSchema":deepcopy(SUITE["schema"]), "outputSchema":deepcopy(SUITE["schema"]), "annotations":{"readOnlyHint":True}, "_meta":{"revision":"1"}}
        if mode == "write-hang":
            for s in (t["inputSchema"],t["outputSchema"]): s["properties"]["message"]["maxLength"] = 300000
        if mode == "drift-before" and self.lists > 1 or mode == "drift-after" and self.calls: t["_meta"]["revision"] = "2"
        if mode == "schema-drift" and self.lists > 1: t["inputSchema"]["properties"]["message"]["maxLength"] = 31
        return [t,t] if mode == "duplicate" else [t]
    def call_tool(self, name, args, *_):
        if name != "read": raise ValueError("PRIVATE_TOOL_NAME")
        self.calls += 1
        with open(spy,"a",encoding="utf-8") as output: output.write("call\n")
        if mode == "hang": time.sleep(5)
        if mode == "tool-error": raise ValueError("PRIVATE_TOOL_DETAIL")
        return {"data":{"message":42 if mode == "bad-data" else args["message"]}, "meta":{"psp-cdl/provenance":{"trustLevel":0,"secret":"PRIVATE_PEER_META"}}}


class Peer:
    def __init__(self):
        self.tools = Tools()
        self.server = McpServer(self.tools,lambda:os.environ.get("PSP_TEST_CREDENTIAL",""))
    def handle(self, source):
        reply, message = self.server.handle(source), parse_json(source)
        if reply is None or "result" not in reply: return reply
        if message["method"] == "initialize":
            if mode == "bad-version": reply["result"]["protocolVersion"] = "unrecognized"
            if mode == "bad-server": reply["result"]["serverInfo"]["name"] = "unrecognized"
        if message["method"] == "tools/list" and mode == "pagination": reply["result"]["nextCursor"] = "opaque"
        if message["method"] == "tools/list" and mode == "write-hang" and self.tools.lists == 2:
            print(canonical_json(reply),flush=True)
            time.sleep(5)
            return None
        if message["method"] == "tools/call":
            if mode == "wrong-id": reply["id"] = 999
            if mode == "bad-text": reply["result"]["content"] = [{"type":"text","text":"PRIVATE_UNCHECKED_TEXT"}]
            if mode == "image": reply["result"]["content"] = [{"type":"image","data":"PRIVATE_IMAGE","mimeType":"image/png"}]
            if mode == "missing-structured": reply["result"].pop("structuredContent")
            if mode == "oversize":
                sys.stdout.buffer.write(b"x"*1_048_577+b"\n")
                sys.stdout.buffer.flush()
                return None
            if mode == "invalid-utf8":
                sys.stdout.buffer.write(bytes([255,10]))
                sys.stdout.buffer.flush()
                return None
            if mode == "truncated":
                sys.stdout.buffer.write(b"{")
                sys.stdout.buffer.flush()
                os._exit(0)
            if mode == "notification":
                print(canonical_json({"jsonrpc":"2.0","method":"notifications/tools/list_changed"}),flush=True)
        return reply


serve_stdio(Peer())
