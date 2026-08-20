import { db, usersTable } from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { randomInt } from "crypto";
import { isValidAvatarId, randomAvatarId, type AvatarId } from "./avatars";

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

export interface WhispererIdentity {
  handle: string;
  avatarId: AvatarId | null;
}

// Assigns (or returns the existing) persistent Whisperer handle + avatar
// for a signed-in account, together, in one write — called on first Debate
// Topic post and first signed-in comment (routes/debateTopics.ts).
// Idempotent, retries on the rare unique-constraint collision.
export async function assignOrGetWhispererIdentity(userId: string): Promise<WhispererIdentity> {
  const existing = await db
    .select({ whispererHandle: usersTable.whispererHandle, whispererAvatarId: usersTable.whispererAvatarId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .then((r) => r[0]);
  if (existing?.whispererHandle) return { handle: existing.whispererHandle, avatarId: existing.whispererAvatarId as AvatarId | null };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = randomHandle();
      const avatarId = randomAvatarId();
      await db.update(usersTable).set({ whispererHandle: handle, whispererAvatarId: avatarId }).where(eq(usersTable.id, userId));
      return { handle, avatarId };
    } catch {
      const raced = await db
        .select({ whispererHandle: usersTable.whispererHandle, whispererAvatarId: usersTable.whispererAvatarId })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .then((r) => r[0]);
      if (raced?.whispererHandle) return { handle: raced.whispererHandle, avatarId: raced.whispererAvatarId as AvatarId | null };
    }
  }
  throw new Error("Failed to assign a Whisperer identity after several attempts");
}

// Batch lookup for rendering a feed/thread's bylines at once — one query for
// every user who already has an identity, then a lazy assign call only for
// the (normally rare — every NEW topic/comment assigns one at write time)
// ones who don't yet, e.g. historical rows written before this feature
// existed.
export async function getOrBackfillWhispererIdentities(userIds: string[]): Promise<Record<string, WhispererIdentity>> {
  if (!userIds.length) return {};
  const unique = [...new Set(userIds)];
  const rows = await db
    .select({ id: usersTable.id, whispererHandle: usersTable.whispererHandle, whispererAvatarId: usersTable.whispererAvatarId })
    .from(usersTable)
    .where(inArray(usersTable.id, unique));
  const byId: Record<string, WhispererIdentity> = {};
  const missing: string[] = [];
  for (const row of rows) {
    if (row.whispererHandle) byId[row.id] = { handle: row.whispererHandle, avatarId: row.whispererAvatarId as AvatarId | null };
    else missing.push(row.id);
  }
  for (const id of missing) {
    byId[id] = await assignOrGetWhispererIdentity(id);
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

export type UpdateWhispererAvatarResult = { ok: true; avatarId: AvatarId | null } | { ok: false; error: "invalid" };

// null is a real, explicit choice ("no profile picture" — falls back to the
// handle's first letter), distinct from an id that isn't in the library.
export async function updateWhispererAvatar(userId: string, avatarId: string | null): Promise<UpdateWhispererAvatarResult> {
  if (avatarId !== null && !isValidAvatarId(avatarId)) return { ok: false, error: "invalid" };
  await db.update(usersTable).set({ whispererAvatarId: avatarId }).where(eq(usersTable.id, userId));
  return { ok: true, avatarId };
}

// Resolves a public handle back to the account id it belongs to — the ONLY
// way routes/follows.ts is allowed to learn a userId from client input,
// keeping raw ids from ever needing to cross the anti-enumeration boundary
// in either direction.
export async function userIdForWhispererHandle(handle: string): Promise<string | null> {
  const row = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.whispererHandle, handle)).then((r) => r[0]);
  return row?.id ?? null;
}
