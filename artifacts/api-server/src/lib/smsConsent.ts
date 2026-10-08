import { randomUUID } from "crypto";
import { db, smsConsentsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { normalizePhoneE164 } from "./phone";
import { logger } from "./logger";

// Whether this Sender has a standing consent record for this exact
// Recipient number (see sms_consents.ts). Normalizes first so "the same
// number" matches however it was typed. A number that can't be normalized
// returns false — the send path then falls back to requiring a fresh
// checkbox, which is the safe direction.
export async function hasSmsConsent(senderId: string, rawPhone: string): Promise<boolean> {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return false;
  try {
    const row = await db
      .select({ id: smsConsentsTable.id })
      .from(smsConsentsTable)
      .where(and(eq(smsConsentsTable.senderId, senderId), eq(smsConsentsTable.recipientPhone, phone)))
      .then((r) => r[0]);
    return !!row;
  } catch (err) {
    // A lookup failure (e.g. an environment whose schema is behind the code
    // and hasn't got this table yet) must not brick sending — degrade to
    // "no prior consent", which just means the checkbox is required this
    // time. Never silently allow an SMS as if consent existed when we
    // couldn't actually confirm it.
    logger.warn({ err, senderId }, "sms consent lookup failed; treating as not-yet-consented");
    return false;
  }
}

// Records (idempotently) that this Sender has attested consent for this
// Recipient number, so future sends skip the checkbox. Called only after a
// send has been accepted with an affirmative confirmation for an SMS
// channel. Best-effort: a failure to persist just means the Sender is asked
// to confirm again next time, never a blocked send.
export async function recordSmsConsent(senderId: string, rawPhone: string): Promise<void> {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return;
  try {
    await db
      .insert(smsConsentsTable)
      .values({ id: randomUUID(), senderId, recipientPhone: phone })
      .onConflictDoNothing({ target: [smsConsentsTable.senderId, smsConsentsTable.recipientPhone] });
  } catch (err) {
    logger.warn({ err, senderId }, "sms consent record failed");
  }
}

// Batch check used by the send screens to decide whether to show the
// checkbox at all: returns the subset of the ORIGINAL input strings whose
// normalized number already has a consent row for this sender. Frontend
// shows the opt-in only when some entered phone isn't in this set.
export async function consentedPhones(senderId: string, rawPhones: string[]): Promise<string[]> {
  // Map each normalized number back to the original string(s) the caller
  // passed, so the response speaks the same phone strings the UI holds.
  const byNormalized = new Map<string, string[]>();
  for (const raw of rawPhones) {
    const norm = normalizePhoneE164(raw);
    if (!norm) continue;
    const list = byNormalized.get(norm) ?? [];
    list.push(raw);
    byNormalized.set(norm, list);
  }
  const normalized = [...byNormalized.keys()];
  if (normalized.length === 0) return [];

  try {
    const rows = await db
      .select({ phone: smsConsentsTable.recipientPhone })
      .from(smsConsentsTable)
      .where(and(eq(smsConsentsTable.senderId, senderId), inArray(smsConsentsTable.recipientPhone, normalized)));
    const consented: string[] = [];
    for (const row of rows) {
      for (const original of byNormalized.get(row.phone) ?? []) consented.push(original);
    }
    return consented;
  } catch (err) {
    logger.warn({ err, senderId }, "sms consent batch check failed; treating all as not-yet-consented");
    return [];
  }
}
