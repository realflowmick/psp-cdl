# SPDX-License-Identifier: Apache-2.0
"""Archival result signatures, with explicit host trust and caller-owned artifact I/O."""
import base64
import hashlib
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from psp_cdl_core import canonical_json, parse_json

DOMAIN = 'PSP-CDL-RESULT-MANIFEST-0.1\n'
PROFILE = 'result-ed25519-0.1'
MAX_FILE_BYTES = 4194304
REQUIRED = ('analysis.json', 'bundle.json', 'corpus.json', 'grading.json', 'manifest.json', 'outcomes.json')
PATH = r'(?:(?:analysis|bundle|corpus|grading|manifest|outcomes|operator-admission)\.json|[0-9]{4}\.(?:(?:record|started|timing|observation)\.json|events\.jsonl))'
KEY_ID = r'[a-z0-9][a-z0-9._-]{0,127}'


class ResultManifestError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _require(value, code):
    if not value:
        raise ResultManifestError(code)


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _copy(value):
    try:
        return parse_json(canonical_json(value))
    except (ValueError, TypeError, RecursionError):
        raise ResultManifestError('INVALID_RESULT_MANIFEST') from None


def _matches(pattern, value):
    return type(value) is str and re.fullmatch(pattern, value) is not None


def _digest(value):
    return _matches(r'[a-f0-9]{64}', value)


def _integer(value, maximum=9007199254740991):
    return type(value) in (int, float) and 0 <= value <= maximum and value == int(value)


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _object_hash(value):
    return _hash(canonical_json(value).encode('utf-8'))


def _encode(data):
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def validate_result_manifest(value):
    m = _copy(value)
    _require(_exact(m, ('schemaVersion','scope','bundleSha256','planSha256','corpusSha256','mode','status','recovered',
                       'evidencePolicy','fullStudy','independentReview','executionAuthorized','artifacts')), 'INVALID_RESULT_MANIFEST')
    _require(type(m['schemaVersion']) is int and m['schemaVersion'] == 1 and m['scope'] == 'signed-result-manifest-0.1'
             and all(_digest(m[k]) for k in ('bundleSha256','planSha256','corpusSha256')) and m['mode'] in ('offline','live')
             and m['status'] in ('finalized','invalid-source-changed') and type(m['recovered']) is bool
             and m['evidencePolicy'] == 'local-synthetic-raw-0.1' and m['fullStudy'] is False and m['independentReview'] is False
             and m['executionAuthorized'] is False and type(m['artifacts']) is list and 6 <= len(m['artifacts']) <= 25001,
             'INVALID_RESULT_MANIFEST')
    previous = ''
    for f in m['artifacts']:
        _require(_exact(f, ('path','bytes','sha256')) and _matches(PATH, f['path']) and f['path'] > previous
                 and _integer(f['bytes'], MAX_FILE_BYTES) and _digest(f['sha256']), 'INVALID_ARTIFACT_INVENTORY')
        previous = f['path']
    paths = {f['path'] for f in m['artifacts']}
    _require(set(REQUIRED) <= paths and ('operator-admission.json' in paths) == (m['mode'] == 'live'), 'INVALID_ARTIFACT_INVENTORY')
    return m


def _envelope(value):
    e = _copy(value)
    _require(_exact(e, ('manifest','signature')) and _exact(e['signature'], ('profile','algorithm','keyId','signedAt','value')), 'INVALID_RESULT_MANIFEST')
    e['manifest'] = validate_result_manifest(e['manifest'])
    s = e['signature']
    _require(s['profile'] == PROFILE and s['algorithm'] == 'ed25519', 'UNSUPPORTED_RESULT_SIGNATURE')
    _require(_matches(KEY_ID, s['keyId']) and _integer(s['signedAt']), 'INVALID_RESULT_SIGNATURE')
    _require(_matches(r'[A-Za-z0-9_-]{86}', s['value']), 'INVALID_RESULT_SIGNATURE')
    raw = base64.urlsafe_b64decode(s['value'] + '==')
    _require(len(raw) == 64 and _encode(raw) == s['value'], 'INVALID_RESULT_SIGNATURE')
    return e


def result_signing_input(value):
    """Domain separation and JCS of all fields except value; distinct from PSP signatures."""
    e = _envelope(value)
    signature = {k:v for k,v in e['signature'].items() if k != 'value'}
    return (DOMAIN + canonical_json({'manifest':e['manifest'], 'signature':signature})).encode('utf-8')


def sign_result_manifest(value, key_id, signed_at, private_seed):
    e = _envelope({'manifest':value, 'signature':{'profile':PROFILE,'algorithm':'ed25519','keyId':key_id,'signedAt':signed_at,'value':_encode(bytes(64))}})
    _require(type(private_seed) is bytes and len(private_seed) == 32, 'INVALID_SIGNING_KEY')
    e['signature']['value'] = _encode(Ed25519PrivateKey.from_private_bytes(private_seed).sign(result_signing_input(e)))
    return e


def verify_result_manifest(value, policy):
    """Checks signature and host policy only. Check saved files with verify_result_artifacts."""
    e = _envelope(value)
    _require(_exact(policy, ('keyId','publicKey','status','bundleSha256','now')) and _matches(KEY_ID, policy['keyId'])
             and policy['status'] in ('active','revoked') and _digest(policy['bundleSha256']) and _integer(policy['now']), 'INVALID_RESULT_POLICY')
    _require(type(policy['publicKey']) is bytes and len(policy['publicKey']) == 32, 'INVALID_RESULT_POLICY')
    _require(policy['keyId'] == e['signature']['keyId'], 'UNKNOWN_RESULT_KEY')
    _require(policy['status'] == 'active', 'REVOKED_RESULT_KEY')
    _require(policy['bundleSha256'] == e['manifest']['bundleSha256'], 'RESULT_SCOPE_MISMATCH')
    try:
        Ed25519PublicKey.from_public_bytes(policy['publicKey']).verify(
            base64.urlsafe_b64decode(e['signature']['value']+'=='), result_signing_input(e))
    except InvalidSignature:
        raise ResultManifestError('INVALID_RESULT_SIGNATURE') from None
    _require(e['signature']['signedAt'] <= policy['now'], 'RESULT_NOT_YET_VALID')
    return e['manifest']


def verify_result_artifacts(value, read_artifact):
    """Bounded caller-supplied reader; no filesystem, key discovery or network access."""
    m, documents = validate_result_manifest(value), {}
    for f in m['artifacts']:
        try:
            data = read_artifact(f['path'])
        except Exception:
            raise ResultManifestError('MISSING_RESULT_ARTIFACT') from None
        _require(type(data) is bytes and len(data) == f['bytes'] and _hash(data) == f['sha256'], 'RESULT_ARTIFACT_MISMATCH')
        if f['path'] in REQUIRED:
            try:
                documents[f['path']] = parse_json(data.decode('utf-8'))
            except (ValueError, UnicodeError):
                raise ResultManifestError('INVALID_RESULT_ARTIFACT') from None
    source, bundle = documents['manifest.json'], documents['bundle.json']
    _require(type(source) is dict and type(source.get('schemaVersion')) is int and source['schemaVersion'] == 1
             and source.get('scope') == 'heldout-execution-result-0.1' and source.get('signed') is False
             and source.get('fullStudy') is False and source.get('independentReview') is False
             and all(type(source.get(k)) is type(m[k]) and source[k] == m[k] for k in ('bundleSha256','planSha256','corpusSha256','mode','status','recovered')), 'RESULT_BINDING_MISMATCH')
    expected = [{k:f[k] for k in ('path','sha256')} for f in m['artifacts'] if f['path'] != 'manifest.json']
    _require(type(source.get('files')) is list and canonical_json(source['files']) == canonical_json(expected), 'RESULT_BINDING_MISMATCH')
    _require(type(bundle) is dict and 'plan' in bundle and _object_hash(bundle) == m['bundleSha256'] and bundle.get('planSha256') == m['planSha256']
             and bundle.get('corpusSha256') == m['corpusSha256'] and bundle.get('mode') == m['mode'] and bundle.get('evidencePolicy') == m['evidencePolicy']
             and _object_hash(bundle.get('plan')) == m['planSha256'] and _object_hash(documents['corpus.json']) == m['corpusSha256'], 'RESULT_BINDING_MISMATCH')
