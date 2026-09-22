// SPDX-License-Identifier: Apache-2.0
/** CDL parsing, inheritance, vocabulary, and deterministic policy decisions. Implementation begins in M2. */
export const manifest = Object.freeze({
  "id": "cdl",
  "status": "scaffold",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": []
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("cdl is a scaffold; no security operation was executed."), { code: "NOT_IMPLEMENTED" });
}
