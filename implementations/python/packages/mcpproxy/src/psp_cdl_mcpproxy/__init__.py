# SPDX-License-Identifier: Apache-2.0
"""MCP mediation, node-agent affinity, covenant checks, and provenance. Implementation begins in M4."""
from copy import deepcopy

_MANIFEST = {
    "id": "mcpproxy",
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
    raise NotImplementedFeatureError("mcpproxy is a scaffold; no security operation was executed.")
