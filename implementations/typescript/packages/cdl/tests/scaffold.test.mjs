// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, requireImplementation } from '../dist/index.js';
test('library advertises scoped experimental features', () => {
  assert.equal(manifest.status, 'experimental');
  assert(manifest.implementedFeatures.length > 0);
});
test('whole workflow execution remains unsupported', () => {
  assert.throws(requireImplementation, {code:'NOT_IMPLEMENTED'});
});
