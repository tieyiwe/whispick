import { randomUUID, randomInt } from "crypto";
import { db, anonymousHandlesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// Deliberately plain, unremarkable words — nothing evocative enough to
// double as an identity clue, per the product ask that a handle must never
// look like a name or word that identifies someone. Adjective + noun +
// 3-digit number, e.g. "SwiftFalcon482".
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

export type AnonymousHandleContentType = "circle_drop" | "debate_topic";

// Assigns (or returns the existing) anonymous handle for this visitor within
// this one thread — see anonymous_handles.ts's schema comment for why it's
// scoped per-thread rather than global. Retries on the rare unique-index
// collision (two visitors racing for the exact same generated string).
export async function assignOrGetHandle(contentType: AnonymousHandleContentType, rootId: string, visitorId: string): Promise<string> {
  const existing = await db
    .select({ handle: anonymousHandlesTable.handle })
    .from(anonymousHandlesTable)
    .where(and(eq(anonymousHandlesTable.contentType, contentType), eq(anonymousHandlesTable.rootId, rootId), eq(anonymousHandlesTable.visitorId, visitorId)))
    .then((r) => r[0]);
  if (existing) return existing.handle;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = randomHandle();
      await db.insert(anonymousHandlesTable).values({ id: randomUUID(), contentType, rootId, visitorId, handle });
      return handle;
    } catch {
      // Unique violation — either this visitor raced itself (a concurrent
      // duplicate insert) or the generated string collided. Re-check for
      // the former before generating another string for the latter.
      const raced = await db
        .select({ handle: anonymousHandlesTable.handle })
        .from(anonymousHandlesTable)
        .where(and(eq(anonymousHandlesTable.contentType, contentType), eq(anonymousHandlesTable.rootId, rootId), eq(anonymousHandlesTable.visitorId, visitorId)))
        .then((r) => r[0]);
      if (raced) return raced.handle;
    }
  }
  throw new Error("Failed to assign an anonymous handle after several attempts");
}

// Batch lookup for rendering a whole thread's comments at once — one query
// instead of one per comment.
export async function getHandlesFor(contentType: AnonymousHandleContentType, rootId: string, visitorIds: string[]): Promise<Record<string, string>> {
  if (!visitorIds.length) return {};
  const unique = [...new Set(visitorIds)];
  const rows = await db
    .select({ visitorId: anonymousHandlesTable.visitorId, handle: anonymousHandlesTable.handle })
    .from(anonymousHandlesTable)
    .where(and(eq(anonymousHandlesTable.contentType, contentType), eq(anonymousHandlesTable.rootId, rootId)));
  const byVisitor = Object.fromEntries(rows.map((r) => [r.visitorId, r.handle]));
  // A visitor who somehow has no row yet (shouldn't happen once
  // assignOrGetHandle runs on every comment write, but defensive for older
  // rows written before this feature existed) falls back to a stable,
  // non-identifying placeholder rather than blank.
  return Object.fromEntries(unique.map((id) => [id, byVisitor[id] ?? "Anonymous"]));
}

export type RenameHandleResult = { ok: true; handle: string } | { ok: false; error: "invalid" | "taken" };

const HANDLE_PATTERN = /^[A-Za-z0-9]{3,24}$/;

// A visitor renaming their own handle within one thread. Validated to the
// same shape the generator produces (alphanumeric only, no spaces/symbols) —
// not a content-safety pass, just enough to keep it from being used to
// smuggle in identifying text via formatting tricks; the "don't use
// something that identifies you" instruction is a UI-level warning, not
// server-enforced (unenforceable in general).
export async function renameHandle(contentType: AnonymousHandleContentType, rootId: string, visitorId: string, newHandle: string): Promise<RenameHandleResult> {
  const trimmed = newHandle.trim();
  if (!HANDLE_PATTERN.test(trimmed)) return { ok: false, error: "invalid" };

  const taken = await db
    .select({ visitorId: anonymousHandlesTable.visitorId })
    .from(anonymousHandlesTable)
    .where(and(eq(anonymousHandlesTable.contentType, contentType), eq(anonymousHandlesTable.rootId, rootId), eq(anonymousHandlesTable.handle, trimmed)))
    .then((r) => r[0]);
  if (taken && taken.visitorId !== visitorId) return { ok: false, error: "taken" };

  await assignOrGetHandle(contentType, rootId, visitorId); // ensures a row exists to update
  await db
    .update(anonymousHandlesTable)
    .set({ handle: trimmed })
    .where(and(eq(anonymousHandlesTable.contentType, contentType), eq(anonymousHandlesTable.rootId, rootId), eq(anonymousHandlesTable.visitorId, visitorId)));

  return { ok: true, handle: trimmed };
}
