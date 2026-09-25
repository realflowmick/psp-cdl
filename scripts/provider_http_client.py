# SPDX-License-Identifier: Apache-2.0
"""Test-only HTTPSConnection interception; production has no endpoint override."""
import http.client
import json
import ssl
import sys
from threading import Event, Timer
from urllib.parse import urlsplit
from psp_cdl_llmproxy import create_openai_chat_provider
from provider_fixtures import SUITE

config = json.loads(sys.argv[1])
original_init = http.client.HTTPSConnection.__init__
original_request = http.client.HTTPSConnection.request
cancelled, timer = Event(), None


def local_connection(self, host, *, timeout, context):
    assert host == "api.openai.com"
    assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
    target = urlsplit(config["endpoint"])
    if not config.get("untrusted"): context.load_verify_locations(config["cert"])
    original_init(self, target.hostname, target.port, timeout=timeout, context=context)


http.client.HTTPSConnection.__init__ = local_connection
def local_request(self, *args, **kwargs):
    global timer
    result = original_request(self, *args, **kwargs)
    if config["mode"] in ("cancel", "cancel-body"):
        timer = Timer(0.05, cancelled.set)
        timer.start()
    return result
http.client.HTTPSConnection.request = local_request
provider = create_openai_chat_provider({"mode": "live", "allowLive": True, "apiKey": "SYNTHETIC_HTTP_KEY", "complete": True,
                                       "sources": [], "now": lambda: 1000, "limits": {**SUITE["limits"], "timeoutMs": 500 if config["mode"] == "hang" else 3000}})
try:
    result = provider["invoke"](SUITE["request"], {"deadline": 1800, "cancelled": cancelled.is_set})
    print(json.dumps({"code": "OK", "released": 1, "result": result}))
except Exception as exc:
    print(json.dumps({"code": getattr(exc, "code", "UNEXPECTED_ERROR"), "released": 0}))
finally:
    if timer: timer.cancel()
