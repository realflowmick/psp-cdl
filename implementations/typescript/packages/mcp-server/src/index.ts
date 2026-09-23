// SPDX-License-Identifier: Apache-2.0
export * from "./server.js";
export const manifest = Object.freeze({
  "id": "mcp-server",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": [
    "mcp-security-tools-0.1",
    "mcp-stdio-2025-11-25",
    "mcp-workflow-tools-0.1"
  ]
} as const);
Object.freeze(manifest.specifications); Object.freeze(manifest.implementedFeatures);
export function requireImplementation():never { throw Object.assign(new Error("Complete workflow services are not implemented."),{code:"NOT_IMPLEMENTED"}); }
