// SPDX-License-Identifier: Apache-2.0
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StudioError } from "../http/router.js";

/**
 * Local secrets at rest: AES-256-GCM under a generated key file or a passphrase-derived key.
 * This protects a development machine's files; it is not a key-management service and claims nothing more.
 */
export const SECRET_NAMES = ["openai.apiKey", "anthropic.apiKey", "signing"] as const;
export type SecretName = typeof SECRET_NAMES[number];
export type SigningAlgorithm = "hmac-sha256" | "ed25519";
export interface SigningKey { algorithm: SigningAlgorithm; keyId: string; material: Uint8Array }
export interface SecretSummary { name: SecretName; configured: boolean; hint: string | null; updatedAt: string | null }
interface Entry { iv: string; tag: string; ciphertext: string; updatedAt: string; hint: string }
interface VaultFile { version: 1; salt: string; entries: Record<string, Entry> }

const isName = (v: unknown): v is SecretName => typeof v === "string" && (SECRET_NAMES as readonly string[]).includes(v);
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function ed25519PublicKey(seed: Uint8Array): Uint8Array {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]);
  const spki = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({ type: "spki", format: "der" }) as Buffer;
  return new Uint8Array(spki.subarray(spki.length - 32));
}

export class Vault {
  private readonly file: string;
  private readonly key: Buffer;
  private readonly data: VaultFile;
  readonly mode: "key-file" | "passphrase";
  constructor(dataDir: string, passphrase?: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "vault.json");
    const existing = existsSync(this.file);
    this.data = existing ? JSON.parse(readFileSync(this.file, "utf8")) : { version: 1, salt: randomBytes(16).toString("base64"), entries: {} };
    if (this.data.version !== 1 || typeof this.data.salt !== "string" || typeof this.data.entries !== "object" || this.data.entries === null) throw new StudioError("VAULT_CORRUPT", 500, "vault.json is not a version 1 vault.");
    if (passphrase) {
      this.mode = "passphrase";
      this.key = scryptSync(passphrase, Buffer.from(this.data.salt, "base64"), 32);
    } else {
      this.mode = "key-file";
      const keyFile = join(dataDir, "vault.key");
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
      this.key = readFileSync(keyFile);
      if (this.key.length !== 32) throw new StudioError("VAULT_CORRUPT", 500, "vault.key must hold 32 bytes.");
    }
    if (!existing) this.save();
  }
  private save(): void { writeFileSync(this.file, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 }); }
  static hint(name: SecretName, value: string): string {
    if (name === "signing") {
      try { const parsed = JSON.parse(value) as { algorithm?: string; keyId?: string }; return `${parsed.algorithm}:${parsed.keyId}`; } catch { return "set"; }
    }
    return value.length >= 12 ? "…" + value.slice(-4) : "set";
  }
  list(): SecretSummary[] {
    return SECRET_NAMES.map(name => {
      const entry = this.data.entries[name];
      return entry ? { name, configured: true, hint: entry.hint, updatedAt: entry.updatedAt } : { name, configured: false, hint: null, updatedAt: null };
    });
  }
  has(name: SecretName): boolean { return Object.hasOwn(this.data.entries, name); }
  get(name: SecretName): string | null {
    if (!isName(name)) throw new StudioError("UNKNOWN_SECRET", 404);
    const entry = this.data.entries[name];
    if (!entry) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(entry.iv, "base64"));
      decipher.setAAD(Buffer.from(name, "utf8"));
      decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch {
      throw new StudioError("VAULT_KEY_MISMATCH", 500, "The vault key does not open this entry. Check PSP_STUDIO_VAULT_PASSPHRASE or vault.key.");
    }
  }
  set(name: SecretName, value: string): SecretSummary {
    if (!isName(name)) throw new StudioError("UNKNOWN_SECRET", 404);
    if (typeof value !== "string" || !value.length || value.length > 16384 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new StudioError("INVALID_SECRET", 400, "Secret values are non-empty printable strings up to 16 KiB.");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(name, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const updatedAt = new Date().toISOString();
    this.data.entries[name] = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), updatedAt, hint: Vault.hint(name, value) };
    this.save();
    return { name, configured: true, hint: this.data.entries[name]!.hint, updatedAt };
  }
  delete(name: SecretName): void {
    if (!isName(name)) throw new StudioError("UNKNOWN_SECRET", 404);
    delete this.data.entries[name];
    this.save();
  }
  signingKey(): SigningKey | null {
    const raw = this.get("signing");
    if (raw === null) return null;
    let parsed: { algorithm?: unknown; keyId?: unknown; material?: unknown };
    try { parsed = JSON.parse(raw); } catch { throw new StudioError("VAULT_CORRUPT", 500, "The signing entry is not JSON."); }
    if ((parsed.algorithm !== "hmac-sha256" && parsed.algorithm !== "ed25519") || typeof parsed.keyId !== "string" || typeof parsed.material !== "string") throw new StudioError("VAULT_CORRUPT", 500, "The signing entry is malformed.");
    const material = new Uint8Array(Buffer.from(parsed.material, "base64"));
    if (material.length !== 32) throw new StudioError("VAULT_CORRUPT", 500, "Signing material must be 32 bytes.");
    return { algorithm: parsed.algorithm, keyId: parsed.keyId, material };
  }
  /** Generates fresh 32-byte material; only the key id, algorithm and (for Ed25519) the public key leave the server. */
  generateSigning(algorithm: SigningAlgorithm, keyId: string): { algorithm: SigningAlgorithm; keyId: string; publicKey: string | null } {
    if (algorithm !== "hmac-sha256" && algorithm !== "ed25519") throw new StudioError("INVALID_SECRET", 400, "algorithm must be hmac-sha256 or ed25519.");
    if (!KEY_ID.test(keyId)) throw new StudioError("INVALID_SECRET", 400, "keyId must be a short identifier.");
    const material = randomBytes(32);
    this.set("signing", JSON.stringify({ algorithm, keyId, material: material.toString("base64") }));
    return { algorithm, keyId, publicKey: algorithm === "ed25519" ? Buffer.from(ed25519PublicKey(material)).toString("base64") : null };
  }
  /** Public description for the settings page; never the material. */
  describeSigning(): { configured: boolean; algorithm: SigningAlgorithm | null; keyId: string | null; publicKey: string | null } {
    const key = this.signingKey();
    if (!key) return { configured: false, algorithm: null, keyId: null, publicKey: null };
    return { configured: true, algorithm: key.algorithm, keyId: key.keyId, publicKey: key.algorithm === "ed25519" ? Buffer.from(ed25519PublicKey(key.material)).toString("base64") : null };
  }
}
