// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('mcpproxy advertises only the bounded host dispatch gate', () => {
  assert.equal(manifest.status, 'experimental');
  assert.deepEqual(manifest.implementedFeatures, ['host-mcp-dispatch-gate-0.1','mcp-stdio-mediation-0.1','mcp-http-mediation-0.1']);
});
test('mcpproxy rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
