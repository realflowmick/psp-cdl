// SPDX-License-Identifier: Apache-2.0
/** Executable library profile adapters; full workflow conformance remains pending. */
export const manifest = Object.freeze({
  "id": "test-harness",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": ["library-profile-adapters", "pilot-planning-analysis-0.1", "pilot-evidence-grading-0.1", "signed-result-manifest-0.1"]
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("Use profile adapters; complete workflow conformance is not implemented."), { code: "NOT_IMPLEMENTED" });
}

export * from "./profiles.js";
export * from "./pilot.js";
export * from "./grading.js";
export * from "./results.js";

Object.freeze(manifest.specifications);
Object.freeze(manifest.implementedFeatures);
