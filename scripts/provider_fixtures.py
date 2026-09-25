# SPDX-License-Identifier: Apache-2.0
import json
from copy import deepcopy
from pathlib import Path
from psp_cdl_core import canonical_json
from psp_cdl_llmproxy import BufferedLlmLoop, create_openai_chat_provider, OPENAI_CHAT_REVISION
from llm_fixtures import Fixture

SUITE = json.loads((Path(__file__).resolve().parents[1]/"conformance/vectors/llm/openai-chat-0.1.json").read_text(encoding="utf-8"))


def run_case(case):
    settings, requests, outputs, codes = case["settings"], [], [], []
    fixture = None
    flags = {"now": 1000, "cancelled": bool(settings.get("preCancel"))}

    def transport(body, _stop):
        request = json.loads(body)
        requests.append(request)
        if fixture: fixture.requests.append(request)
        effect = settings.get("effect")
        if effect == "cancel":
            flags["cancelled"] = True
            if fixture: fixture.base.flags["cancelled"] = True
        if effect == "deadline":
            flags["now"] = 1800
            if fixture: fixture.base.flags["now"] = 1800
        if effect == "expiry" and fixture: fixture.base.flags["now"] = 1700
        if effect == "drift" and fixture: fixture.base.flags["drift"] = True
        if settings.get("throwTransport"): raise RuntimeError("PRIVATE_BACKEND_EXCEPTION SYNTHETIC_KEY")
        responses = settings.get("responses", [SUITE["tool"], SUITE["final"]] if fixture else [SUITE["final"]])
        raw = settings.get("rawBody", canonical_json(responses[min(len(requests)-1, len(responses)-1)]))
        return {"status": settings.get("status", 200), "contentType": settings.get("contentType", "application/json"),
                "body": b"\xff" if settings.get("invalidUtf8") else raw.encode("utf-8")}

    try:
        if case["scope"] == "loop": fixture = Fixture(deepcopy(settings.get("loop", {})))
        config = {"mode": "offline", "now": lambda: fixture.now() if fixture else flags["now"], "complete": True,
                  "sources": [{"id": "provider", "capabilities": ["used-for-model-training"] if settings.get("loop", {}).get("providerTraining") else []}],
                  "limits": {**SUITE["limits"], **settings.get("limits", {})}, "transport": transport, **settings.get("config", {})}
        if config["mode"] == "live": config.pop("transport")
        provider = create_openai_chat_provider(config)
        if fixture:
            snapshot = fixture.snapshot
            fixture.snapshot = lambda *args: {**snapshot(*args), "providerId": provider["id"], "providerRevision": "wrong" if settings.get("loop", {}).get("wrongProvider") else OPENAI_CHAT_REVISION}
            loop = BufferedLlmLoop(fixture.base.store, fixture.base.gate, fixture, provider)
            outputs.append(loop.run(settings.get("loop", {}).get("token", "test-owner"), fixture.base.session["sessionId"], {"message": "Read synthetic data."}, fixture.options))
            codes.append("OK")
        else:
            for _ in range(settings.get("attempts", 1)):
                try:
                    outputs.append(provider["invoke"](deepcopy(settings.get("request", SUITE["request"])), {"deadline": settings.get("deadline", 1800), "cancelled": lambda: flags["cancelled"]}))
                    codes.append("OK")
                except Exception as exc: codes.append(getattr(exc, "code", "UNEXPECTED_ERROR"))
    except Exception as exc: codes.append(getattr(exc, "code", "UNEXPECTED_ERROR"))
    finally:
        if fixture: fixture.close()
    return {"code": codes[-1], "codes": codes, "transportCalls": len(requests), "toolCalls": fixture.base.calls if fixture else 0,
            "released": len(outputs), "requests": requests, "outputs": outputs}
