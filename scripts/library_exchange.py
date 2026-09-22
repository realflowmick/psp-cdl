# SPDX-License-Identifier: Apache-2.0
"""Independent Python producer/consumer for two-way library interoperability."""
import json
from pathlib import Path
import psp_cdl_core as core
from psp_cdl_core import crypto
import psp_cdl_cdl as cdl

ROOT = Path(__file__).resolve().parents[1]
def fixture(name):
    return json.loads((ROOT / 'conformance/vectors' / name).read_text(encoding='utf-8'))
CODEC = fixture('codec/profile-1.0.json')
SIGNATURES = fixture('signatures/profile-2.0.json')
SEED = bytes.fromhex(SIGNATURES['testKeys']['ed25519']['seedHex'])
INPUTS = [(c['id'], core.parse_markup(c['source'])) for c in CODEC['markupCases']] + [(c['id'], core.document_from_object(c['object'])) for c in CODEC['objectCases']]
def public_key(envelope):
    return bytes.fromhex(SIGNATURES['testKeys']['ed25519']['publicKeyHex'] if envelope['signature']['algorithm'] == 'ed25519' else SIGNATURES['testKeys']['hmac']['keyHex'])

def emit_bundle():
    metadata = {k:v for k,v in SIGNATURES['vectors'][0]['envelope']['signature'].items() if k not in {'value','contentType'}}
    envelopes = []
    for vector in SIGNATURES['vectors']:
        e = vector['envelope']
        envelopes.append((vector['id'], crypto.sign_envelope(e['data'], {k:v for k,v in e['signature'].items() if k != 'value'}, SEED if e['signature']['algorithm'] == 'ed25519' else public_key(e))))
    envelopes.append(('nested-document', crypto.sign_document(dict(INPUTS)['nested-application'], metadata, SEED)))
    return {
        'documents': [{'id': id, 'markup': core.serialize_markup(doc), 'canonical': core.serialize_markup(doc, 'canonical'), 'json': core.document_to_json(doc), 'semantic': core.document_to_object(doc, False)} for id,doc in INPUTS],
        'envelopes': [{'id': id, 'json': core.serialize_envelope(e), 'markup': core.serialize_markup({'kind':'document','children':[core.envelope_to_section(e)]}), 'inputHex': core.signature_input(e).hex()} for id,e in envelopes],
        'schemas': [cdl.serialize_cdl_json(c['schema']) for c in CODEC['cdlSchemas']],
        'declarations': [cdl.with_declarations({'title':'Portable declarations'}, {'classes':['PII'],'covenants':['no-persist','no-training'],'capabilities':[]}, format) for format in ('string','array')]
    }

def verify_bundle(peer):
    assert peer == emit_bundle(), 'TypeScript serialization differs from Python'
    for c in peer['documents']:
        document = core.document_from_json(c['json'])
        assert core.serialize_markup(document) == c['markup']
        assert core.serialize_markup(document, 'canonical') == c['canonical']
        assert core.document_to_object(core.parse_markup(c['markup']), False) == c['semantic']
        assert core.document_to_object(core.parse_markup(c['canonical']), False) == c['semantic']
    for c in peer['envelopes']:
        e = core.section_to_envelope(core.parse_markup(c['markup'])['children'][0])
        assert core.serialize_envelope(e) == c['json']
        assert core.signature_input(e).hex() == c['inputHex']
        assert crypto.verify_signature(e, public_key(e))
        if c['id'] == 'nested-document':
            assert core.serialize_markup(core.envelope_to_document(e)) == next(c['source'] for c in CODEC['markupCases'] if c['id']=='nested-application')
    for schema in peer['schemas']:
        assert cdl.serialize_cdl_json(cdl.parse_cdl_json(schema)) == schema
    for d in peer['declarations']:
        assert cdl.parse_declarations(d) == {'classes':['pii'],'covenants':['no-persist','no-training'],'capabilities':[]}
