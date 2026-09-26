# SPDX-License-Identifier: Apache-2.0
"""Reusable experimental libraries; no server or workflow runtime dependencies."""
from copy import deepcopy
from .policy import tokenize_declaration
from .policy import (CDL_PROFILE, Decision, normalize_declaration, serialize_declaration, parse_declarations, with_declarations, parse_cdl_json, serialize_cdl_json, valid_pointer, inherit_policy, aggregate_capabilities, evaluate_policy, evaluate_batch, evaluate_resolved_policy, check_enforcement, resolve_schema_policy, policy_table)

_MANIFEST = {'id': 'cdl',
 'status': 'experimental',
 'specifications': {'psp': '3.2.0', 'cdl': '1.5'},
 'implementedFeatures': ['cdl-declarations',
                         'cdl-lexical-tokens',
                         'cdl-schema-inheritance',
                         'cdl-deterministic-1.0',
                         'topology-gates']}

def get_manifest() -> dict:
    return deepcopy(_MANIFEST)

class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"

def require_implementation() -> None:
    raise NotImplementedFeatureError("Use a named library API; complete workflow execution is not implemented.")

__all__ = ['CDL_PROFILE', 'Decision', 'tokenize_declaration', 'normalize_declaration', 'serialize_declaration', 'parse_declarations', 'with_declarations', 'parse_cdl_json', 'serialize_cdl_json', 'valid_pointer', 'inherit_policy', 'aggregate_capabilities', 'evaluate_policy', 'evaluate_batch', 'evaluate_resolved_policy', 'check_enforcement', 'resolve_schema_policy', 'policy_table', 'get_manifest', 'require_implementation', 'NotImplementedFeatureError']
