/**
 * Password hashing: PBKDF2-HMAC-SHA256 through Web Crypto, the hasher the
 * Workers runtime implements natively. A hash is stored self-describing:
 *
 *   pbkdf2_sha256$<iterations>$<salt>$<hash, base64>
 *
 * Django 4.x/5.x/6.0 pbkdf2_sha256 hashes are 100% compatible and validated on login,
 * then seamlessly upgraded to PBKDF2_ITERATIONS (100,000) when needsRehash returns true.
 */

export const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 22;
const SALT_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HASH_BYTES = 32;
const ALGORITHM = "pbkdf2_sha256";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) =>
  Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

function randomSalt(): string {
  let out = "";
  while (out.length < SALT_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(SALT_LENGTH))) {
      if (byte < 248 && out.length < SALT_LENGTH)
        out += SALT_ALPHABET[byte % SALT_ALPHABET.length];
    }
  }
  return out;
}

async function pbkdf2(
  password: string,
  salt: string,
  iterations: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations },
    material,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Hash a password with a fresh random salt using standard 100,000 iterations. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomSalt();
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${ALGORITHM}$${PBKDF2_ITERATIONS}$${salt}$${b64(hash)}`;
}

function parse(
  stored: string,
): { iterations: number; salt: string; hash: Uint8Array } | null {
  const [algorithm, rawIterations, salt, hash, ...rest] = stored.split("$");
  const iterations = Number(rawIterations);
  if (algorithm !== ALGORITHM || rest.length || !salt || !hash) return null;
  // Allow up to 2,000,000 iterations for Django compatibility
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2_000_000)
    return null;
  try {
    return { iterations, salt, hash: unb64(hash) };
  } catch {
    return null;
  }
}

/** Whether password matches stored, compared in constant time. Supports both Django and native hashes. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await pbkdf2(password, parsed.salt, parsed.iterations);
  if (candidate.byteLength !== parsed.hash.byteLength) return false;
  return crypto.subtle.timingSafeEqual(candidate, parsed.hash);
}

/** Whether a stored hash should be upgraded at the next successful sign-in (e.g. from Django iterations). */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return (
    !parsed ||
    parsed.iterations !== PBKDF2_ITERATIONS ||
    parsed.hash.byteLength !== HASH_BYTES
  );
}

/** Compute SHA-256 hex digest of a string using Web Crypto API. */
export async function generateSHA256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash an API key for storage/lookup (SHA-256 hex string). */
export async function hashApiKey(raw: string): Promise<string> {
  return generateSHA256(raw);
}

/** Generate a new raw API key and its prefix/hash. */
export async function generateApiKey(): Promise<{
  raw: string;
  prefix: string;
  keyHash: string;
}> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const token = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const raw = `zlk_${token}`;
  const prefix = raw.slice(0, 12);
  const keyHash = await hashApiKey(raw);
  return { raw, prefix, keyHash };
}

/** Generate a random 6-character short code. */
export function generateShortCode(): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}
