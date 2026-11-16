/**
 * Password hashing, random ids, HMAC-derived tokens — WebCrypto only (no Node APIs).
 *
 * Passwords: PBKDF2-HMAC-SHA256 (Workers caps PBKDF2 at 100 000 iterations), 16-byte salt, stored as
 * "pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>". argon2 (Python version) needs native code.
 */

const enc = new TextEncoder();
export const PBKDF2_ITERATIONS = 100_000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** 26-char time-sortable id (ULID layout: 48-bit ms timestamp + 80-bit randomness). */
export function ulid(now = Date.now()): string {
  let out = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  const r = randomBytes(16);
  for (let i = 0; i < 16; i++) out += CROCKFORD[r[i] % 32];
  return out;
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function hmac(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message));
  return b64url(sig);
}

/** Lookup hash for stored bearer secrets (sessions, API tokens): HMAC so a DB dump cannot be used offline. */
export function tokenHash(secret: string, token: string): Promise<string> {
  return hmac(secret, `token:${token}`);
}

/** Capability tokens (edit links, management links) derived from a stored nonce. */
export async function deriveToken(secret: string, purpose: "edit" | "manage", id: string, nonce: string): Promise<string> {
  return (await hmac(secret, `${purpose}:${id}:${nonce}`)).slice(0, 43);
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  const iterations = Number(it);
  if (alg !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS || !salt || !hash) {
    return false;
  }
  const got = await pbkdf2(password, fromB64url(salt), iterations);
  return timingSafeEqual(b64url(got), hash);
}

/** A hash that takes as long as a real verification, for unknown usernames (no user enumeration by timing). */
export const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
