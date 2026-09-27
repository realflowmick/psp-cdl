# SPDX-License-Identifier: Apache-2.0
"""Local result evidence I/O. Requires a quiescent directory; never fetches remote artifacts."""
import base64
import hashlib
import os
import re
import stat
import subprocess
from pathlib import Path
from psp_cdl_core import canonical_json, parse_json
from psp_cdl_test_harness import validate_result_manifest, verify_result_artifacts
from psp_cdl_test_harness.results import PATH, MAX_FILE_BYTES, ResultManifestError

ROOT = Path(__file__).resolve().parents[1]


def read_bytes(path, limit=MAX_FILE_BYTES):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or getattr(before, 'st_file_attributes', 0) & 0x400:
        raise ValueError('Not an ordinary file')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as source:
        opened = os.fstat(source.fileno())
        if (opened.st_dev,opened.st_ino) != (before.st_dev,before.st_ino): raise ValueError('File replaced')
        data = source.read(limit+1)
        after = os.fstat(source.fileno())
    if len(data) > limit or (opened.st_size,opened.st_mtime_ns) != (after.st_size,after.st_mtime_ns): raise ValueError('Unstable or oversized file')
    return data


def read_json(path):
    return parse_json(read_bytes(path).decode('utf-8'))


def directory_reader(directory):
    directory = Path(directory)
    if directory.is_symlink() or getattr(directory.lstat(), 'st_file_attributes', 0) & 0x400: raise ValueError('Linked evidence directory')
    root = directory.resolve(strict=True)
    if not root.is_dir(): raise ValueError('Missing evidence directory')
    def read(name):
        if type(name) is not str or not re.fullmatch(PATH, name): raise ValueError('Invalid evidence name')
        path = root/name
        if path.resolve(strict=True).parent != root: raise ValueError('Evidence outside selected directory')
        return read_bytes(path)
    return root, read


def check_inventory(root, manifest):
    actual = {p.name for p in root.iterdir() if p.suffix in ('.json','.jsonl')}
    if actual != {f['path'] for f in manifest['artifacts']}:
        raise ResultManifestError('RESULT_DIRECTORY_MISMATCH')


def check_source_schema(source):
    # Repository CLI uses the existing draft schema rather than maintaining a second copy.
    result = subprocess.run(['node','--input-type=module','-e',
        "import {readFileSync} from 'node:fs';import {validateHeldout} from './scripts/validate-heldout.mjs';"
        "validateHeldout('manifest',JSON.parse(readFileSync(0,'utf8')));"],
        input=canonical_json(source), cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=30)
    if result.returncode: raise ResultManifestError('INVALID_EXECUTOR_MANIFEST')


def prepare_manifest(directory, expected_bundle):
    root, read = directory_reader(directory)
    raw = read('manifest.json')
    source = parse_json(raw.decode('utf-8'))
    check_source_schema(source)
    if source['bundleSha256'] != expected_bundle: raise ResultManifestError('RESULT_SCOPE_MISMATCH')
    files = source['files']
    # Zero sizes allow name/identity validation before any document-selected path is read.
    artifacts = [{'path':f['path'],'bytes':0,'sha256':f['sha256']} for f in files]
    artifacts.append({'path':'manifest.json','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
    artifacts.sort(key=lambda f:f['path'])
    m = validate_result_manifest({'schemaVersion':1,'scope':'signed-result-manifest-0.1',
        **{k:source[k] for k in ('bundleSha256','planSha256','corpusSha256','mode','status','recovered')},
        'evidencePolicy':'local-synthetic-raw-0.1','fullStudy':False,'independentReview':False,'executionAuthorized':False,'artifacts':artifacts})
    check_inventory(root,m)
    for f in m['artifacts']:
        data = read(f['path'])
        if hashlib.sha256(data).hexdigest() != f['sha256']: raise ResultManifestError('RESULT_ARTIFACT_MISMATCH')
        f['bytes'] = len(data)
    verify_result_artifacts(m,read)
    return m


def verify_directory(manifest, directory):
    root, read = directory_reader(directory)
    check_inventory(root,manifest)
    verify_result_artifacts(manifest,read)
    check_source_schema(parse_json(read('manifest.json').decode('utf-8')))
    check_inventory(root,manifest)


def trust_policy(value, now):
    if type(value) is not dict or set(value) != {'schemaVersion','keyId','publicKey','status','bundleSha256'} or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ResultManifestError('INVALID_RESULT_POLICY')
    encoded = value['publicKey']
    if type(encoded) is not str or not re.fullmatch('[A-Za-z0-9_-]{43}',encoded): raise ResultManifestError('INVALID_RESULT_POLICY')
    raw = base64.urlsafe_b64decode(encoded+'=')
    if base64.urlsafe_b64encode(raw).decode().rstrip('=') != encoded: raise ResultManifestError('INVALID_RESULT_POLICY')
    return {'keyId':value['keyId'],'publicKey':raw,'status':value['status'],'bundleSha256':value['bundleSha256'],'now':now}


def write_signed(path, envelope, directory):
    path = Path(path).absolute()
    base = (ROOT/'.artifacts').resolve()
    parent = path.parent.resolve(strict=True)
    evidence = Path(directory).resolve(strict=True)
    if not parent.is_relative_to(base) or parent.is_relative_to(evidence) or path.suffix != '.json':
        raise ValueError('Choose a new JSON file under .artifacts outside the evidence directory')
    # Exclusive creation; never overwrite a signature, evidence, key or trust record.
    data = (canonical_json(envelope)+'\n').encode('utf-8')
    with path.open('xb') as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
