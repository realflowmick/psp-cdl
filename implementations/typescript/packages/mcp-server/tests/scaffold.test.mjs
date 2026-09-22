// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('mcp-server advertises no implemented security features', () => {
  assert.equal(manifest.status, 'scaffold');
  assert.deepEqual(manifest.implementedFeatures, []);
});
test('mcp-server rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
