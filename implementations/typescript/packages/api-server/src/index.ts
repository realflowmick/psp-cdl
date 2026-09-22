// SPDX-License-Identifier: Apache-2.0
/** Versioned HTTP service contracts, authentication, and tenant isolation. Implementation begins in M3. */
export const manifest = Object.freeze({
  "id": "api-server",
  "status": "scaffold",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": []
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("api-server is a scaffold; no security operation was executed."), { code: "NOT_IMPLEMENTED" });
}
