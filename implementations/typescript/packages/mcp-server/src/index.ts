// SPDX-License-Identifier: Apache-2.0
/** Reference sessions, nodes, checkpoints, security operations, and synthetic tools. Implementation begins in M3. */
export const manifest = Object.freeze({
  "id": "mcp-server",
  "status": "scaffold",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": []
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("mcp-server is a scaffold; no security operation was executed."), { code: "NOT_IMPLEMENTED" });
}
