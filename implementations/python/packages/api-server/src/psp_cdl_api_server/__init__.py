# SPDX-License-Identifier: Apache-2.0
from copy import deepcopy
from .service import SecurityService, ServiceError, ServiceHost, SERVICE_PROFILE, MAX_REQUEST_BYTES, identifier, scope_for
_MANIFEST = {'id': 'api-server', 'status': 'experimental', 'specifications': {'psp': '3.2.0', 'cdl': '1.5'}, 'implementedFeatures': ['authenticated-security-service-0.1', 'http-security-adapter']}
def get_manifest(): return deepcopy(_MANIFEST)
class NotImplementedFeatureError(NotImplementedError):
    code="NOT_IMPLEMENTED"
def require_implementation():
    raise NotImplementedFeatureError("Complete workflow services are not implemented.")
