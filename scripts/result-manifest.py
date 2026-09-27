# SPDX-License-Identifier: Apache-2.0
"""Explicit offline signing or verification of finalized local synthetic evidence."""
import argparse
import json
import subprocess
import time
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from psp_cdl_test_harness import sign_result_manifest, verify_result_manifest
from result_files import prepare_manifest, verify_directory, read_bytes, read_json, trust_policy, write_signed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    signer = commands.add_parser('sign')
    signer.add_argument('--directory',type=Path,required=True)
    signer.add_argument('--bundle-sha256',required=True)
    signer.add_argument('--key-id',required=True)
    signer.add_argument('--private-key',type=Path,required=True,help='Host-owned unencrypted Ed25519 PKCS8 PEM; never passed to workers')
    signer.add_argument('--output',type=Path,required=True,help='New .artifacts JSON path outside the evidence directory')
    verifier = commands.add_parser('verify')
    verifier.add_argument('--directory',type=Path,required=True)
    verifier.add_argument('--signed',type=Path,required=True)
    verifier.add_argument('--trust',type=Path,required=True,help='Independently supplied key and exact bundle binding')
    args = parser.parse_args()
    try:
        if args.command == 'sign':
            manifest = prepare_manifest(args.directory,args.bundle_sha256)
            # Evidence and bindings are checked before reading a private key.
            key = serialization.load_pem_private_key(read_bytes(args.private_key,16384),password=None)
            if not isinstance(key,Ed25519PrivateKey): raise ValueError('Unsupported signing key')
            now = int(time.time())
            envelope = sign_result_manifest(manifest,args.key_id,now,key.private_bytes_raw())
            verify_result_manifest(envelope,{'keyId':args.key_id,'publicKey':key.public_key().public_bytes_raw(),
                'status':'active','bundleSha256':args.bundle_sha256,'now':now})
            verify_directory(manifest,args.directory)
            write_signed(args.output,envelope,args.directory)
        else:
            envelope = read_json(args.signed)
            manifest = verify_result_manifest(envelope,trust_policy(read_json(args.trust),int(time.time())))
            verify_directory(manifest,args.directory)
        print(json.dumps({'status':'signed' if args.command == 'sign' else 'verified','signatureVerified':True,'artifactsVerified':True,
            'bundleSha256':manifest['bundleSha256'],'mode':manifest['mode'],'runStatus':manifest['status'],'artifacts':len(manifest['artifacts']),
            'fullStudy':False,'independentReview':False,'executionAuthorized':False}))
        return 0
    except (ValueError,TypeError,KeyError,OSError,RuntimeError,subprocess.SubprocessError) as error:
        print(json.dumps({'status':'rejected','code':getattr(error,'code','INVALID_RESULT_INPUT_OR_STATE'),'executionAuthorized':False}))
        return 2


if __name__ == '__main__': raise SystemExit(main())
