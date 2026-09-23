// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';

test('mcp-server advertises only scoped service features', () => {
  assert.equal(manifest.status, 'experimental');
  assert.deepEqual(manifest.implementedFeatures, ["mcp-security-tools-0.1", "mcp-stdio-2025-11-25", "mcp-workflow-tools-0.1", "host-tool-service-adapter", "mcp-streamable-http-0.1"]);
});
test('mcp-server rejects an unimplemented operation', () => {
  assert.throws(requireImplementation, { code: 'NOT_IMPLEMENTED' });
});
