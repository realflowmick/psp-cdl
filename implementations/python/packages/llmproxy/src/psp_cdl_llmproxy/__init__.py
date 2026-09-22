# SPDX-License-Identifier: Apache-2.0
"""Provider-neutral model gateway and authoritative tool-dispatch loop. Implementation begins in M5."""
from copy import deepcopy

_MANIFEST = {
    "id": "llmproxy",
    "status": "scaffold",
    "specifications": {
        "psp": "3.2.0",
        "cdl": "1.5"
    },
    "implementedFeatures": []
}


def get_manifest() -> dict:
    """Return readiness metadata, never a conformance claim."""
    return deepcopy(_MANIFEST)


class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"


def require_implementation() -> None:
    """Fail before any operation or side effect."""
    raise NotImplementedFeatureError("llmproxy is a scaffold; no security operation was executed.")
