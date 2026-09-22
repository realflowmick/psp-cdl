# SPDX-License-Identifier: Apache-2.0
"""Versioned HTTP service contracts, authentication, and tenant isolation. Implementation begins in M3."""
from copy import deepcopy

_MANIFEST = {
    "id": "api-server",
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
    raise NotImplementedFeatureError("api-server is a scaffold; no security operation was executed.")
