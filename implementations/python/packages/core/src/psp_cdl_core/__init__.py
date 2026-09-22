# SPDX-License-Identifier: Apache-2.0
"""Reusable experimental libraries; no server or workflow runtime dependencies."""
from copy import deepcopy
from .json_codec import (PspError, canonical_json, parse_json, validate_json)
from .markup import (CODEC_PROFILE, MARKUP_LIMITS, TextNode, Section, Document, parse_markup, serialize_markup, document_from_object, document_to_object, document_from_json, document_to_json)
from .signatures import (SIGNATURE_PROFILE, canonical_version, envelope_from_object, parse_envelope, serialize_envelope, protected_content, signature_input, encode_signature, decode_signature, validate_time, section_to_envelope, envelope_to_section, document_envelope_data, envelope_to_document)
from .trust import (authorize_trust_level, source_trust_level, require_engine_isolation)

_MANIFEST = {'id': 'core',
 'status': 'experimental',
 'specifications': {'psp': '3.2.0', 'cdl': '1.5'},
 'implementedFeatures': ['psp-codec-1.0',
                         'strict-json',
                         'signature-profile-2.0',
                         'trusted-key-verification']}

def get_manifest() -> dict:
    return deepcopy(_MANIFEST)

class NotImplementedFeatureError(NotImplementedError):
    code = "NOT_IMPLEMENTED"

def require_implementation() -> None:
    raise NotImplementedFeatureError("Use a named library API; complete workflow execution is not implemented.")

__all__ = ['PspError', 'canonical_json', 'parse_json', 'validate_json', 'CODEC_PROFILE', 'MARKUP_LIMITS', 'TextNode', 'Section', 'Document', 'parse_markup', 'serialize_markup', 'document_from_object', 'document_to_object', 'document_from_json', 'document_to_json', 'SIGNATURE_PROFILE', 'canonical_version', 'envelope_from_object', 'parse_envelope', 'serialize_envelope', 'protected_content', 'signature_input', 'encode_signature', 'decode_signature', 'validate_time', 'section_to_envelope', 'envelope_to_section', 'document_envelope_data', 'envelope_to_document', 'authorize_trust_level', 'source_trust_level', 'require_engine_isolation', 'get_manifest', 'require_implementation', 'NotImplementedFeatureError']
