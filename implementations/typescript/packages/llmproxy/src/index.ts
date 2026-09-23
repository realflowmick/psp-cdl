// SPDX-License-Identifier: Apache-2.0
export * from "./loop.js";
export * from "./durable.js";
export * from "./refresh.js";
export const manifest = Object.freeze({
  "id": "llmproxy",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": ["buffered-model-loop-0.1", "signed-prompt-binding", "inference-tool-release-policy", "durable-turns-lockdown-0.1", "automatic-prompt-refresh-0.1", "mcp-prompt-refresh-discovery-0.1"]
} as const);

/** Full workflow execution remains unsupported; use a named library API. */
export function requireImplementation(): never {
  throw Object.assign(new Error("Complete workflow execution is not implemented."), { code: "NOT_IMPLEMENTED" });
}
Object.freeze(manifest.specifications);
Object.freeze(manifest.implementedFeatures);
export * from "./mcp-refresh.js";
