# SPDX-License-Identifier: Apache-2.0
import json
import sys
from psp_cdl_mcpproxy.mcp import HttpMcpClient,StdioMcpClient
from psp_cdl_llmproxy import McpPromptRefresher
from psp_cdl_core.crypto import verify_envelope
from mcp_refresh_fixtures import PRINCIPAL,BINDING,REQUEST
c=json.loads(sys.argv[1]);peer=None
try:
    peer=HttpMcpClient.connect(c["config"],lambda _:"wrong" if c.get("badToken") else "synthetic-refresh-token") if c["transport"]=="http" else StdioMcpClient.connect(c["config"])
    client=McpPromptRefresher(peer,{"principal":PRINCIPAL,"sessionId":BINDING["sessionId"],"approvedCatalogDigest":"wrong" if c.get("unapproved") else peer.catalog_digest,"now":lambda:1100,"cancelled":lambda:False})
    envelope=client.refresh(PRINCIPAL,BINDING,REQUEST)
    verify_envelope(envelope,{"now":1100,"context":{},"allowedAttributes":[],"keys":[{"id":"synthetic","status":"active","algorithm":"hmac-sha256","material":bytes([19])*32,"allowUnscoped":True,"scope":{},"trustLevels":[2],"sectionTypes":["system"]}]})
    result={"code":"OK","released":1,"data":envelope["data"]}
except Exception as exc:result={"code":getattr(exc,"code","UNEXPECTED_ERROR"),"released":0}
finally:
    if peer:peer.close()
sys.stdout.buffer.write((json.dumps(result,ensure_ascii=False)+"\n").encode("utf-8"))
