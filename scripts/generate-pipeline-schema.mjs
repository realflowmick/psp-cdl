// SPDX-License-Identifier: Apache-2.0
// Regenerates apps/studio-core/schemas/pipeline.schema.json from the studio-core kind schemas.
// Run after `npm run build --workspace @psp-cdl/studio-core`; the core tests fail when the file is stale.
import {writeFileSync} from 'node:fs';
import {pipelineJsonSchema} from '../apps/studio-core/dist/index.js';
writeFileSync(new URL('../apps/studio-core/schemas/pipeline.schema.json',import.meta.url),JSON.stringify(pipelineJsonSchema(),null,2)+'\n');
