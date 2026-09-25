# SPDX-License-Identifier: Apache-2.0
"""Experimental buffered model/tool loop; full workflow execution remains pending."""
from copy import deepcopy
from .loop import BufferedLlmLoop, LoopError, LLM_LOOP_PROFILE, prompt_context
from .openai_chat import (create_openai_chat_provider, ProviderError, OPENAI_CHAT_PROFILE,
                          OPENAI_CHAT_MODEL, OPENAI_CHAT_REVISION, OPENAI_CHAT_INPUT_RESERVATION)
from .durable import DurableLlmLoop, LockdownError, DURABLE_LOOP_PROFILE
from .redirect import RedirectingLlmLoop, REDIRECT_PROFILE
from .scoped import ScopedLlmLoop, SCOPED_PROFILE, scoped_prompt_context
from .refresh import RefreshingLlmLoop, PROMPT_REFRESH_PROFILE, compare_prompt_versions
from .mcp_refresh import McpPromptRefresher, PromptRefreshError, MCP_PROMPT_REFRESH_PROFILE, mcp_refresh_tool_definition

_MANIFEST = {
    "id": "llmproxy",
    "status": "experimental",
    "specifications": {
        "psp": "3.2.0",
        "cdl": "1.5"
    },
    "implementedFeatures": ["buffered-model-loop-0.1", "signed-prompt-binding", "inference-tool-release-policy", "durable-turns-lockdown-0.1", "automatic-prompt-refresh-0.1", "mcp-prompt-refresh-discovery-0.1", "atomic-completion-redirect-0.1", "scoped-post-completion-0.1", "buffered-openai-chat-0.1"]
}


def get_manifest() -> dict:
    """Return readiness metadata, never a conformance claim."""
    return deepcopy(_MANIFEST)


class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"


def require_implementation() -> None:
    """Fail before any operation or side effect."""
    raise NotImplementedFeatureError("Complete workflow execution is not implemented.")
