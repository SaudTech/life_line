import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password (and PIN) hashing using Node's built-in scrypt - no external
// dependency, no native build on the clinic PC. Hashes are self-describing:
//
//   scrypt$N$r$p$<salt-base64>$<hash-base64>
//
// so the cost parameters travel with the hash and can be raised later without
// breaking existing logins. Never store or log a plaintext password/PIN.

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// Cost parameters. N must be a power of two; these are sensible 2025 defaults.
const N = 16384; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  const derived = (await scryptAsync(plain, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })) as Buffer;

  // Constant-time compare to avoid leaking match progress via timing.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
