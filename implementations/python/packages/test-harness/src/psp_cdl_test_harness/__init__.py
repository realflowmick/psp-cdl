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
    "implementedFeatures": ["library-profile-adapters", "pilot-planning-analysis-0.1", "pilot-evidence-grading-0.1", "signed-result-manifest-0.1"]
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
from .pilot import PilotError, create_pilot_plan, analyze_pilot, pilot_digest, validate_pilot_plan
from .grading import validate_pilot_input, validate_pilot_steps, validate_pilot_case, validate_heldout_corpus, validate_pilot_observation, grade_pilot_evidence, grade_pilot_records
from .results import ResultManifestError, validate_result_manifest, result_signing_input, sign_result_manifest, verify_result_manifest, verify_result_artifacts
