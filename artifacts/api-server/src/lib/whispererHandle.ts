import { db, usersTable } from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { randomInt } from "crypto";

// Same word lists/shape as lib/anonymousHandles.ts's per-thread generator
// ("SwiftFalcon482") — deliberately plain, non-identifying words — but this
// one is scoped globally unique (users.whispererHandle) rather than
// per-thread, since it's meant to persist and be recognizable across topics.
const ADJECTIVES = [
  "Swift", "Quiet", "Bold", "Calm", "Bright", "Gentle", "Sharp", "Steady",
  "Curious", "Honest", "Vivid", "Quick", "Warm", "Cool", "Wise", "Brave",
  "Kind", "Sturdy", "Nimble", "Keen", "Mellow", "Lively", "Subtle", "Loyal",
];
const NOUNS = [
  "Falcon", "River", "Maple", "Comet", "Harbor", "Ember", "Meadow", "Otter",
  "Boulder", "Willow", "Compass", "Lantern", "Ridge", "Sparrow", "Canyon",
  "Cedar", "Ferry", "Glacier", "Heron", "Juniper", "Kestrel", "Orbit", "Pebble", "Reef",
];

function randomHandle(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  const number = randomInt(100, 1000);
  return `${adjective}${noun}${number}`;
}

// Assigns (or returns the existing) persistent Whisperer handle for a
// signed-in account. Called on first Debate Topic post and first
// signed-in comment (routes/debateTopics.ts) — idempotent, retries on the
// rare unique-constraint collision.
export async function assignOrGetWhispererHandle(userId: string): Promise<string> {
  const existing = await db.select({ whispererHandle: usersTable.whispererHandle }).from(usersTable).where(eq(usersTable.id, userId)).then((r) => r[0]);
  if (existing?.whispererHandle) return existing.whispererHandle;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = randomHandle();
      await db.update(usersTable).set({ whispererHandle: handle }).where(eq(usersTable.id, userId));
      return handle;
    } catch {
      const raced = await db.select({ whispererHandle: usersTable.whispererHandle }).from(usersTable).where(eq(usersTable.id, userId)).then((r) => r[0]);
      if (raced?.whispererHandle) return raced.whispererHandle;
    }
  }
  throw new Error("Failed to assign a Whisperer handle after several attempts");
}

// Batch lookup for rendering a feed/thread's bylines at once — one query for
// every user who already has a handle, then a lazy assign call only for the
// (normally rare — every NEW topic/comment assigns one at write time) ones
// who don't yet, e.g. historical rows written before this feature existed.
export async function getOrBackfillWhispererHandles(userIds: string[]): Promise<Record<string, string>> {
  if (!userIds.length) return {};
  const unique = [...new Set(userIds)];
  const rows = await db.select({ id: usersTable.id, whispererHandle: usersTable.whispererHandle }).from(usersTable).where(inArray(usersTable.id, unique));
  const byId: Record<string, string> = {};
  const missing: string[] = [];
  for (const row of rows) {
    if (row.whispererHandle) byId[row.id] = row.whispererHandle;
    else missing.push(row.id);
  }
  for (const id of missing) {
    byId[id] = await assignOrGetWhispererHandle(id);
  }
  return byId;
}

export type RenameWhispererHandleResult = { ok: true; handle: string } | { ok: false; error: "invalid" | "taken" };

const HANDLE_PATTERN = /^[A-Za-z0-9]{3,24}$/;

// A user renaming their own persistent handle — validated to the same
// shape the generator produces. Unlike the per-thread rename
// (anonymousHandles.ts), uniqueness is checked GLOBALLY, since this handle
// is what a follow relationship (follows.ts) resolves by.
export async function renameWhispererHandle(userId: string, newHandle: string): Promise<RenameWhispererHandleResult> {
  const trimmed = newHandle.trim();
  if (!HANDLE_PATTERN.test(trimmed)) return { ok: false, error: "invalid" };

  const taken = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.whispererHandle, trimmed), ne(usersTable.id, userId))).then((r) => r[0]);
  if (taken) return { ok: false, error: "taken" };

  await db.update(usersTable).set({ whispererHandle: trimmed }).where(eq(usersTable.id, userId));
  return { ok: true, handle: trimmed };
}

// Resolves a public handle back to the account id it belongs to — the ONLY
// way routes/follows.ts is allowed to learn a userId from client input,
// keeping raw ids from ever needing to cross the anti-enumeration boundary
// in either direction.
export async function userIdForWhispererHandle(handle: string): Promise<string | null> {
  const row = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.whispererHandle, handle)).then((r) => r[0]);
  return row?.id ?? null;
}
