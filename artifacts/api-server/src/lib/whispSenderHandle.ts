import { randomUUID, randomInt } from "crypto";
import { db, whispSenderHandlesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// Deliberately plain, unremarkable words — same "must never double as an
// identity clue" rule lib/anonymousHandles.ts's own list follows — drawn
// from four unrelated categories (animal, plant, car brand, everyday
// object) per product ask, rather than that file's adjective+noun pairing.
// One word + a number, e.g. "Falcon482".
const WORDS = [
  // Animals
  "Falcon", "Otter", "Heron", "Sparrow", "Kestrel", "Badger", "Lynx", "Wren",
  "Beaver", "Osprey", "Marten", "Finch", "Egret", "Vole", "Stoat", "Grouse",
  // Plants
  "Maple", "Willow", "Cedar", "Juniper", "Birch", "Fern", "Clover", "Sage",
  "Aspen", "Bramble", "Poplar", "Thistle", "Hazel", "Rowan", "Larch", "Moss",
  // Car brands
  "Volvo", "Mazda", "Subaru", "Honda", "Toyota", "Nissan", "Volkswagen", "Skoda",
  "Peugeot", "Renault", "Citroen", "Suzuki", "Datsun", "Saab", "Fiat", "Seat",
  // Objects
  "Compass", "Lantern", "Anchor", "Beacon", "Prism", "Harbor", "Ridge", "Ember",
  "Ferry", "Meadow", "Comet", "Boulder", "Canyon", "Glacier", "Orbit", "Pebble",
];

function randomHandle(): string {
  const word = WORDS[randomInt(WORDS.length)];
  const number = randomInt(10, 1000);
  return `${word}${number}`;
}

// Assigns (or returns the existing) stable pseudonym one Sender shows to
// one Recipient — see whisp_sender_handles.ts's schema comment for the full
// "why per-pair, not global" reasoning. Retries on the rare unique-index
// collision (either this exact pair racing itself, or the generated string
// already being taken by a DIFFERENT sender in this same recipient's
// inbox) — mirrors lib/anonymousHandles.ts's assignOrGetHandle exactly.
export async function assignOrGetSenderHandle(senderId: string, recipientUserId: string): Promise<string> {
  const existing = await db
    .select({ handle: whispSenderHandlesTable.handle })
    .from(whispSenderHandlesTable)
    .where(and(eq(whispSenderHandlesTable.senderId, senderId), eq(whispSenderHandlesTable.recipientUserId, recipientUserId)))
    .then((r) => r[0]);
  if (existing) return existing.handle;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = randomHandle();
      await db.insert(whispSenderHandlesTable).values({ id: randomUUID(), senderId, recipientUserId, handle });
      return handle;
    } catch {
      // Unique violation — either this exact (senderId, recipientUserId)
      // pair raced itself (a concurrent duplicate insert), in which case
      // the row now exists and we return it, or the generated string
      // collided with a different sender's handle in this recipient's
      // inbox, in which case no such row exists yet and the loop tries a
      // fresh random string.
      const raced = await db
        .select({ handle: whispSenderHandlesTable.handle })
        .from(whispSenderHandlesTable)
        .where(and(eq(whispSenderHandlesTable.senderId, senderId), eq(whispSenderHandlesTable.recipientUserId, recipientUserId)))
        .then((r) => r[0]);
      if (raced) return raced.handle;
    }
  }
  throw new Error("Failed to assign a whisp sender handle after several attempts");
}
