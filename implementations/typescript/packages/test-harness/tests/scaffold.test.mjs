// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('test-harness advertises scoped library adapters and offline pilot tools', () => {
  assert.equal(manifest.status, 'experimental');
  assert.deepEqual(manifest.implementedFeatures, ["library-profile-adapters", "pilot-planning-analysis-0.1", "pilot-evidence-grading-0.1", "signed-result-manifest-0.1"]);
});
test('test-harness rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
