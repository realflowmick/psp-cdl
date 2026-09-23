# SPDX-License-Identifier: Apache-2.0
"""Bounded host-only application targets; no network URI resolution."""
import re
from .service import identifier

REDIRECT_PROFILE = "PSP-LLM-REDIRECT-0.1"

def valid_redirect_target(value):
    return type(value) is str and len(value)<=256 and re.fullmatch(r"mcp://[a-z0-9]+(?:[.-][a-z0-9]+)*/applications/[A-Za-z0-9][A-Za-z0-9_-]*",value) is not None

def valid_redirect(value):
    return type(value) is dict and set(value)=={"expiresAt","nodeId","nodeVersion","policyVersion","target"} and valid_redirect_target(value["target"]) and all(identifier(value[k]) for k in ("nodeId","nodeVersion","policyVersion")) and type(value["expiresAt"]) in (int,float) and 0<value["expiresAt"]<=9007199254740991 and int(value["expiresAt"])==value["expiresAt"]
