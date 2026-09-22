# SPDX-License-Identifier: Apache-2.0
"""PSP parsing, canonicalization, signatures, provenance, and workflow contracts. Implementation begins in M2."""
from copy import deepcopy

_MANIFEST = {
    "id": "core",
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
    raise NotImplementedFeatureError("core is a scaffold; no security operation was executed.")
