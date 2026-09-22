// SPDX-License-Identifier: Apache-2.0
import { PspError } from "./json.js";
/** Authority is host-supplied. Call after cryptographic verification, never on claimed roles. */
export function authorizeTrustLevel(level:unknown, allowedLevels:readonly number[]):number {
  if(typeof level!=="number"||!Number.isInteger(level)||level<0||level>5||!Array.isArray(allowedLevels)||allowedLevels.some(v=>typeof v!=="number"||!Number.isInteger(v)||v<0||v>5)) throw new PspError("INVALID_TRUST_LEVEL");
  if(!allowedLevels.includes(level)) throw new PspError("UNAUTHORIZED_TRUST"); return level;
}
export function sourceTrustLevel(source:"user"|"external"):number {
  if(!["user","external"].includes(source)) throw new PspError("INVALID_CONTEXT"); return source==="user"?4:5;
}
export function requireEngineIsolation():never { throw new PspError("ENGINE_ISOLATION_UNSUPPORTED"); }
