// SPDX-License-Identifier: Apache-2.0
/** Executable library profile adapters; full workflow conformance remains pending. */
export const manifest = Object.freeze({
  "id": "test-harness",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": ["library-profile-adapters"]
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("Use profile adapters; complete workflow conformance is not implemented."), { code: "NOT_IMPLEMENTED" });
}

export * from "./profiles.js";

Object.freeze(manifest.specifications);
Object.freeze(manifest.implementedFeatures);
