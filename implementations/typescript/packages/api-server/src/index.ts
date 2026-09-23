// SPDX-License-Identifier: Apache-2.0
export * from "./service.js";
export const manifest = Object.freeze({
  "id": "api-server",
  "status": "experimental",
  "specifications": {
    "psp": "3.2.0",
    "cdl": "1.5"
  },
  "implementedFeatures": [
    "authenticated-security-service-0.1",
    "http-security-adapter",
    "workflow-persistence-0.1",
    "sqlite-atomic-backend",
    "authenticated-workflow-service-0.1",
    "session-operation-bindings",
    "durable-turn-store-0.1",
    "prompt-refresh-store-0.1",
    "redirect-turn-store-0.1"
  ]
} as const);
Object.freeze(manifest.specifications); Object.freeze(manifest.implementedFeatures);
export function requireImplementation():never { throw Object.assign(new Error("Complete workflow services are not implemented."),{code:"NOT_IMPLEMENTED"}); }
