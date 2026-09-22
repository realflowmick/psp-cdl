// SPDX-License-Identifier: Apache-2.0
/** Provider-neutral model gateway and authoritative tool-dispatch loop. Implementation begins in M5. */
export const manifest = Object.freeze({
  "id": "llmproxy",
  "status": "scaffold",
  "specifications": {
    "psp": "3.1.1",
    "cdl": "1.5"
  },
  "implementedFeatures": []
} as const);

/** Always fails until a reviewed implementation supplies a real entry point. */
export function requireImplementation(): never {
  throw Object.assign(new Error("llmproxy is a scaffold; no security operation was executed."), { code: "NOT_IMPLEMENTED" });
}
