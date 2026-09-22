// SPDX-License-Identifier: Apache-2.0
export * from "./policy.js";
export const manifest = Object.freeze({
  "id": "cdl",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": [
    "cdl-declarations",
    "cdl-schema-inheritance",
    "cdl-deterministic-1.0",
    "topology-gates"
  ]
} as const);
export function requireImplementation(): never { throw Object.assign(new Error("Use a named library API; complete workflow execution is not implemented."), {code:"NOT_IMPLEMENTED"}); }

Object.freeze(manifest.specifications);
Object.freeze(manifest.implementedFeatures);
