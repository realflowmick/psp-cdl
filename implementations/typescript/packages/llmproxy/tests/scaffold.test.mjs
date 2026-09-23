// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('llmproxy advertises only its experimental slice', () => {
  assert.equal(manifest.status, 'experimental');
  assert(manifest.implementedFeatures.includes('buffered-model-loop-0.1'));
});
test('llmproxy rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
