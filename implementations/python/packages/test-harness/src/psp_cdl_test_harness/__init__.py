# SPDX-License-Identifier: Apache-2.0
"""Executable library profile adapters; full workflow conformance remains pending."""
from copy import deepcopy

_MANIFEST = {
    "id": "test-harness",
    "status": "experimental",
    "specifications": {
        "psp": "3.2.0",
        "cdl": "1.5"
    },
    "implementedFeatures": ["library-profile-adapters"]
}


def get_manifest() -> dict:
    """Return readiness metadata, never a conformance claim."""
    return deepcopy(_MANIFEST)


class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"


def require_implementation() -> None:
    """Fail before any operation or side effect."""
    raise NotImplementedFeatureError("Use profile adapters; complete workflow conformance is not implemented.")

from .profiles import execute_policy_case, run_policy_vectors, run_codec_vectors, run_signature_vectors, profile_report
