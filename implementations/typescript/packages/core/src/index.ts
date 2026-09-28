// SPDX-License-Identifier: Apache-2.0
export * from "./json.js";
export * from "./markup.js";
export * from "./signatures.js";
export * from "./trust.js";
export const manifest = Object.freeze({
  "id": "core",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": [
    "psp-codec-1.0",
    "strict-json",
    "signature-profile-2.0",
    "trusted-key-verification"
  ]
} as const);
export function requireImplementation(): never { throw Object.assign(new Error("Use a named library API; complete workflow execution is not implemented."), {code:"NOT_IMPLEMENTED"}); }

Object.freeze(manifest.specifications);
Object.freeze(manifest.implementedFeatures);
