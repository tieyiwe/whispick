import { createHmac, randomBytes, createHash, timingSafeEqual } from "crypto";
import { db, adminMfaTable, type AdminMfa } from "@workspace/db";
import { eq } from "drizzle-orm";

// Blind Whisper's own authenticator-app (TOTP) second factor for admin
// accounts. Exists because the Replit-managed Clerk instance this app
// authenticates with does not support MFA at all — the old requireAdmin
// check against Clerk's twoFactorEnabled could never be satisfied, locking
// every admin out permanently. Standard RFC 6238 TOTP (SHA-1, 6 digits,
// 30s steps) implemented directly on node:crypto — every mainstream
// authenticator app (Google Authenticator, Authy, 1Password, iOS
// Passwords) speaks exactly this profile, and it's ~40 lines, so no new
// dependency. Deliberately independent of the auth provider: if sign-in
// ever migrates off Clerk, this second factor carries over untouched.

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
// Accept the previous/next time-step too — standard tolerance for clock
// skew between the server and the phone running the authenticator.
const TOTP_WINDOW = 1;

// How long one successful code entry unlocks the admin panel for. Scoped
// to a signed, self-expiring token (below) rather than any server-side
// session state — the API stays stateless and restart-safe.
const MFA_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const BACKUP_CODE_COUNT = 8;

// HMAC key for the unlock tokens. Falls back to the Clerk secret key so no
// new required env var can brick a deploy — rotating either key just
// invalidates outstanding unlock tokens (admins re-enter a code), nothing
// worse.
function tokenSigningKey(): string {
  const key = process.env.ADMIN_MFA_TOKEN_SECRET || process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("ADMIN_MFA_TOKEN_SECRET or CLERK_SECRET_KEY must be set for admin MFA tokens");
  return key;
}

// --- Base32 (RFC 4648, no padding) — the alphabet authenticator apps use.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  // 20 random bytes = the RFC 4226 recommended secret length for SHA-1.
  return base32Encode(randomBytes(20));
}

function hotp(secretBase32: string, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpCodeAt(secretBase32: string, atMs: number): string {
  return hotp(secretBase32, Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));
}

export function verifyTotpCode(secretBase32: string, code: string, atMs = Date.now()): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const step = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const expected = hotp(secretBase32, step + offset);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return true;
  }
  return false;
}

// The otpauth:// URI authenticator apps import (via QR or paste). Issuer +
// account label are what the app displays in its list.
export function totpProvisioningUri(secretBase32: string, accountLabel: string): string {
  const issuer = "Blind Whisper Admin";
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// --- Backup codes: one-time recovery codes shown exactly once at
// enrollment; only sha256 hashes are stored, and a used code is removed.
function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.replace(/\s+/g, "").toLowerCase()).digest("hex");
}

export function generateBackupCodes(): { plaintext: string[]; hashes: string[] } {
  const plaintext = Array.from({ length: BACKUP_CODE_COUNT }, () => randomBytes(5).toString("hex"));
  return { plaintext, hashes: plaintext.map(hashBackupCode) };
}

// Returns the remaining hashes with the matched one removed, or null when
// the code matches nothing.
export function consumeBackupCode(storedHashesJson: string, code: string): string[] | null {
  let hashes: string[];
  try {
    hashes = JSON.parse(storedHashesJson);
  } catch {
    return null;
  }
  const candidate = hashBackupCode(code);
  const idx = hashes.indexOf(candidate);
  if (idx === -1) return null;
  return [...hashes.slice(0, idx), ...hashes.slice(idx + 1)];
}

// --- Unlock tokens: HMAC-signed `userId.expiryMs.signature`, checked on
// every admin request. Stateless on purpose (no session row to manage), and
// bound to the user id so one admin's token can't unlock another's session.
export function issueMfaToken(userId: string, nowMs = Date.now()): string {
  const exp = nowMs + MFA_TOKEN_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", tokenSigningKey()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyMfaToken(token: string, userId: string, nowMs = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenUserId, expStr, sig] = parts;
  if (tokenUserId !== userId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowMs) return false;
  const expected = createHmac("sha256", tokenSigningKey()).update(`${tokenUserId}.${exp}`).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
}

export async function getAdminMfa(userId: string): Promise<AdminMfa | undefined> {
  return db.select().from(adminMfaTable).where(eq(adminMfaTable.userId, userId)).then((r) => r[0]);
}
