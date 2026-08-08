import { sendEmail, whisperLinkEmailHtml } from "./email";
import { sendSms, sendWhatsApp, whisperLinkSmsBody } from "./sms";
import { HOOK_LINE } from "./copy";
import { db, whispsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DeliveryPurpose, DeliveryLogContext } from "./deliveryLog";
import { logDeliveryAttempt } from "./deliveryLog";
import { logger } from "./logger";
import { normalizePhoneE164 } from "./phone";
import { notifyUser } from "./push";

type DeliverableWhisp = {
  id: string;
  publicToken: string;
  whisperChannel: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
};

// Looks up whether `recipientPhone` belongs to a known, OTP-verified Blind
// Whisper user (see users.phoneVerifiedAt and lib/phoneVerification.ts) —
// the "skip Twilio" match. Deliberately requires phoneVerifiedAt IS NOT
// NULL: users.phone alone can be an unverified, opportunistic Clerk sync
// (see ensureUser.ts) and must never be trusted for this. Rows written by
// the verification flow always store `phone` pre-normalized to E.164, so
// only the *input* needs normalizing here, not the stored column.
async function findVerifiedRecipient(rawPhone: string): Promise<{ id: string } | null> {
  const normalized = normalizePhoneE164(rawPhone);
  if (!normalized) return null;

  return db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.phone, normalized), isNotNull(usersTable.phoneVerifiedAt)))
    .then((r) => r[0] ?? null);
}

// Delivers a matched whisp through the app's own notification system
// instead of Twilio: a persistent in-app notification (shows in the
// notification bell — see routes/user.ts's GET /notifications) plus a
// best-effort live browser push (lib/push.ts), same two-layer pattern
// lib/moderation.ts's warning notice uses. Points at the SPA's own
// `/w/:token` route (not the `/api/l/:token` redirect built for
// email/SMS/WhatsApp clients) since the matched recipient already has the
// app open. Returns whether the notification was actually persisted —
// mirrors sendSms/sendWhatsApp's success semantics so the caller can't tell
// which path ran from the return value alone.
async function deliverInApp(
  matchedUserId: string,
  whisp: DeliverableWhisp,
  hookLine: string,
  toAddress: string,
  logCtx: DeliveryLogContext,
): Promise<boolean> {
  const url = `/w/${whisp.publicToken}`;
  const title = "You have a new whisp";

  try {
    await db.insert(notificationsTable).values({
      id: randomUUID(),
      targetUserId: matchedUserId,
      title,
      body: hookLine,
      url,
      createdByAdminId: null,
    });
    void notifyUser(matchedUserId, title, hookLine, url);

    await logDeliveryAttempt("in_app", toAddress, logCtx, {
      success: true,
      providerStatus: "matched_in_app",
    });
    return true;
  } catch (err) {
    logger.error({ ...logCtx, err }, "Failed to deliver matched whisp in-app");
    await logDeliveryAttempt("in_app", toAddress, logCtx, {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// Dispatches a Whisper Link (or one member's delivery within a Group
// Whisper — same mechanics, just a different pre-click teaser line) over
// whichever channel the sender chose. Shared between the immediate-send path
// (POST /whisps, POST /whisper-groups/:id/send) and the scheduled dispatcher
// (lib/scheduler.ts), which delivers the same way once a future scheduledAt
// comes due, as well as reminders (lib/reminderScheduler.ts), reveal-request
// notifications, and reply-to-recipient notifications (POST /:id/reveal and
// POST /:id/replies in routes/whisps.ts) — every one of these funnels
// through here, so the SMS/WhatsApp-recipient matching below (see
// findVerifiedRecipient) benefits every caller uniformly, not just the
// first message to a given recipient.
//
// ANTI-ENUMERATION: every existing caller of this function already responds
// to its own HTTP request BEFORE calling this (`void deliverWhisperLink(...)`
// — see routes/whisps.ts, routes/whisperGroups.ts) or isn't a live request
// at all (lib/scheduler.ts, lib/reminderScheduler.ts run on a timer, not in
// response to a sender action). So the matched-vs-unmatched branch below —
// and the real Twilio network round-trip one path takes that the other
// doesn't — never affects what the Sender's own request sees or how long it
// takes to see it. Nothing here changes whisp.whisperChannel or any other
// sender-visible field based on which path ran; the only observable
// difference lives in delivery_attempts (channel: 'in_app' vs 'sms'/
// 'whatsapp'), which only admins can read (routes/admin.ts). Do not add a
// caller that awaits this function and reflects its result (or timing)
// directly into a response to the Sender — see lib/scheduler.ts's own
// comment on why its await is safe (it's not sender-facing) if you need a
// precedent.
//
// Returns whether the send actually went out. `purpose` controls whether a
// failure gets reflected back onto the whisp itself: for the initial send
// ("whisper_link", the default) a failed transport means the whisp never
// left this server, so it flips whisps.status to 'failed' ("Couldn't send"
// in the UI) instead of leaving it claiming 'delivered'. A reminder
// (`purpose: "reminder"`) failing doesn't undo a whisp that already reached
// the recipient once, so it's logged (see logDeliveryAttempt below) without
// touching status.
export async function deliverWhisperLink(
  whisp: DeliverableWhisp,
  appUrl: string,
  hookLine: string = HOOK_LINE,
  purpose: DeliveryPurpose = "whisper_link",
): Promise<boolean> {
  const sharedUrl = `${appUrl}/api/l/${whisp.publicToken}`;
  const logCtx = { whispId: whisp.id, purpose };

  let success: boolean;
  if (whisp.whisperChannel === "email" && whisp.recipientEmail) {
    success = await sendEmail(whisp.recipientEmail, hookLine, whisperLinkEmailHtml(sharedUrl, hookLine), logCtx);
  } else if ((whisp.whisperChannel === "sms" || whisp.whisperChannel === "whatsapp") && whisp.recipientPhone) {
    const channel = whisp.whisperChannel;
    const matched = await findVerifiedRecipient(whisp.recipientPhone);

    if (matched) {
      success = await deliverInApp(matched.id, whisp, hookLine, whisp.recipientPhone, logCtx);
    } else if (channel === "sms") {
      success = await sendSms(whisp.recipientPhone, whisperLinkSmsBody(sharedUrl, hookLine), logCtx);
    } else {
      success = await sendWhatsApp(whisp.recipientPhone, sharedUrl, logCtx);
    }
  } else {
    // No recognized channel, or the contact info that channel needs is
    // missing — shouldn't happen given intake validation, but log it as a
    // real failed attempt rather than silently doing nothing, so it's still
    // visible in a user's delivery history if it ever does.
    logger.error({ whispId: whisp.id, whisperChannel: whisp.whisperChannel }, "No deliverable channel/contact for whisp");
    await logDeliveryAttempt((whisp.whisperChannel as "email" | "sms" | "whatsapp") ?? "email", whisp.recipientEmail ?? whisp.recipientPhone ?? "unknown", logCtx, {
      success: false,
      errorMessage: "No recipient contact on file for the selected channel",
    });
    success = false;
  }

  if (!success && purpose === "whisper_link") {
    await db.update(whispsTable).set({ status: "failed" }).where(eq(whispsTable.id, whisp.id));
  }

  return success;
}
