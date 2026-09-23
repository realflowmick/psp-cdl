# SPDX-License-Identifier: Apache-2.0
"""Experimental buffered model/tool loop; full workflow execution remains pending."""
from copy import deepcopy
from .loop import BufferedLlmLoop, LoopError, LLM_LOOP_PROFILE, prompt_context

_MANIFEST = {
    "id": "llmproxy",
    "status": "experimental",
    "specifications": {
        "psp": "3.2.0",
        "cdl": "1.5"
    },
    "implementedFeatures": ["buffered-model-loop-0.1", "signed-prompt-binding", "inference-tool-release-policy"]
}


def get_manifest() -> dict:
    """Return readiness metadata, never a conformance claim."""
    return deepcopy(_MANIFEST)


class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"


def require_implementation() -> None:
    """Fail before any operation or side effect."""
    raise NotImplementedFeatureError("Complete workflow execution is not implemented.")
