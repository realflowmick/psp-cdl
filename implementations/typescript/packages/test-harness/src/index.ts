// SPDX-License-Identifier: Apache-2.0
/** Shared conformance adapters and effectiveness-study execution. Implementation begins in M6. */
export const manifest = Object.freeze({
  "id": "test-harness",
  "status": "scaffold",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": []
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("test-harness is a scaffold; no security operation was executed."), { code: "NOT_IMPLEMENTED" });
}
