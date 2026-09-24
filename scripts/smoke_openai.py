# SPDX-License-Identifier: Apache-2.0
"""Separately invoked synthetic adapter smoke; never run by imports, examples or CI."""
import json
import os
import re
import signal
import sys
import time
from threading import Event
from psp_cdl_llmproxy import create_openai_chat_provider, OPENAI_CHAT_MODEL, ProviderError


def main():
    args = sys.argv[1:]
    budgets = [a for a in args if re.fullmatch(r"--budget-tokens=[1-9][0-9]*", a)]
    if len(args) != 2 or "--allow-live" not in args or len(budgets) != 1:
        print(json.dumps({"status": "not_run", "reason": "Require --allow-live and --budget-tokens=<ceiling>; supply PSP_OPENAI_API_KEY separately."}))
        return 2
    cancelled = Event()
    previous = signal.signal(signal.SIGINT, lambda *_: cancelled.set())
    try:
        provider = create_openai_chat_provider({"mode": "live", "allowLive": True, "apiKey": os.environ.get("PSP_OPENAI_API_KEY", ""), "now": lambda: int(time.time()),
                                               "complete": True, "sources": [{"id": "synthetic-smoke", "capabilities": ["is-ai-system", "cloud-processing"]}],
                                               "limits": {"maxRequestBytes": 4096, "maxResponseBytes": 8192, "maxOutputTokens": 32, "maxCalls": 1,
                                                          "budgetTokens": int(budgets[0].split("=")[1]), "timeoutMs": 15000}})
        result = provider["invoke"]({"messages": [{"role": "system", "content": "This is a synthetic adapter smoke test."}, {"role": "user", "content": "Return exactly SYNTHETIC_OK."}], "tools": []},
                                    {"deadline": int(time.time())+15, "cancelled": cancelled.is_set})
        if result.get("type") != "final" or result["text"].strip() != "SYNTHETIC_OK": raise ProviderError("SMOKE_OUTPUT_MISMATCH")
        print(json.dumps({"status": "passed", "scope": "synthetic-adapter-only", "model": OPENAI_CHAT_MODEL, "streaming": False}))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "failed", "code": getattr(exc, "code", "PROVIDER_FAILED")}))
        return 1
    finally:
        signal.signal(signal.SIGINT, previous)


if __name__ == "__main__": raise SystemExit(main())
