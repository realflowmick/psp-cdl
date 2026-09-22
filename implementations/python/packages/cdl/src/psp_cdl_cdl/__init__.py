# SPDX-License-Identifier: Apache-2.0
"""CDL parsing, inheritance, vocabulary, and deterministic policy decisions. Implementation begins in M2."""
from copy import deepcopy

_MANIFEST = {
    "id": "cdl",
    "status": "scaffold",
    "specifications": {
        "psp": "3.1.1",
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
    raise NotImplementedFeatureError("cdl is a scaffold; no security operation was executed.")
