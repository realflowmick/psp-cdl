# psp-cdl-test-harness

Status: **experimental reusable library**. Executable shared library profile adapters. CLI `--profiles` executes codec, signature and policy/trust cases; default full-workflow conformance still fails as unimplemented.

See the [public API guide](../../../../docs/library-api.md), [codec profile](../../../../specs/profiles/PSP-CODEC-1.0.md) and [roadmap](../../../../ROADMAP.md). APIs accept ordinary language objects and share wire contracts and fixtures with the other language. No RealflowCloud account or running proxy/server is required.

Passing library tests is not full RFC conformance, measured attack resistance or production readiness. Package publication remains disabled until release review. Install local tarballs/wheels to evaluate the library independently; `scripts/check-packages.py` verifies this path.

License: Apache-2.0. Founding sponsor: RealflowCloud, Inc.
