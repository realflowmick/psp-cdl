// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('test-harness advertises only library adapters', () => {
  assert.equal(manifest.status, 'experimental');
  assert.deepEqual(manifest.implementedFeatures, ["library-profile-adapters"]);
});
test('test-harness rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
