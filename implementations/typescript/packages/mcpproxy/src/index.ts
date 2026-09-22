// SPDX-License-Identifier: Apache-2.0
/** MCP mediation, node-agent affinity, covenant checks, and provenance. Implementation begins in M4. */
export const manifest = Object.freeze({
  "id": "mcpproxy",
  "status": "scaffold",
  "specifications": {
    "psp": "3.1.1",
    "cdl": "1.5"
  },
  "implementedFeatures": []
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("mcpproxy is a scaffold; no security operation was executed."), { code: "NOT_IMPLEMENTED" });
}
