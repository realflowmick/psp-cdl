// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('api-server advertises only scoped service features', () => {
  assert.equal(manifest.status, 'experimental');
  assert.deepEqual(manifest.implementedFeatures, ["authenticated-security-service-0.1", "http-security-adapter"]);
});
test('api-server rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
