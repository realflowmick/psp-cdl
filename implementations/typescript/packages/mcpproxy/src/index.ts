// SPDX-License-Identifier: Apache-2.0
export * from "./dispatch.js";
export const manifest = Object.freeze({
  "id": "mcpproxy",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": ["host-mcp-dispatch-gate-0.1","mcp-stdio-mediation-0.1","mcp-http-mediation-0.1"]
} as const);
Object.freeze(manifest.specifications); Object.freeze(manifest.implementedFeatures);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("Complete MCP proxy transport and durable effect dispatch are not implemented."), { code: "NOT_IMPLEMENTED" });
}
