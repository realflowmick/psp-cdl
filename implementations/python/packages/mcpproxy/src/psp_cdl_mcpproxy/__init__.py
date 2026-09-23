# SPDX-License-Identifier: Apache-2.0
"""Experimental host-embedded MCP dispatch gate; complete mediation is pending."""
from copy import deepcopy
from .dispatch import McpDispatchGate, DispatchError, DISPATCH_PROFILE, binding_digest

_MANIFEST = {
    "id": "mcpproxy",
    "status": "experimental",
    "specifications": {
        "psp": "3.2.0",
        "cdl": "1.5"
    },
    "implementedFeatures": ["host-mcp-dispatch-gate-0.1", "mcp-stdio-mediation-0.1","mcp-http-mediation-0.1", "mcp-revision-0.1"]
}


def get_manifest() -> dict:
    """Return readiness metadata, never a conformance claim."""
    return deepcopy(_MANIFEST)


class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"


def require_implementation() -> None:
    """Fail before any operation or side effect."""
    raise NotImplementedFeatureError("Complete MCP proxy transport and durable effect dispatch are not implemented.")
