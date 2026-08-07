import { sendEmail, whisperLinkEmailHtml } from "./email";
import { sendSms, sendWhatsApp, whisperLinkSmsBody } from "./sms";
import { HOOK_LINE } from "./copy";
import { db, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { DeliveryPurpose } from "./deliveryLog";
import { logDeliveryAttempt } from "./deliveryLog";
import { logger } from "./logger";

type DeliverableWhisp = {
  id: string;
  publicToken: string;
  whisperChannel: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
};

// Dispatches a Whisper Link (or one member's delivery within a Group
// Whisper — same mechanics, just a different pre-click teaser line) over
// whichever channel the sender chose. Shared between the immediate-send path
// (POST /whisps, POST /whisper-groups/:id/send) and the scheduled dispatcher
// (lib/scheduler.ts), which delivers the same way once a future scheduledAt
// comes due, as well as reminders (lib/reminderScheduler.ts).
//
// Note: WhatsApp business-initiated messages must use a pre-approved Twilio
// Content Template (see sms.ts), so `hookLine` has no effect there — the
// template's own wording is what actually gets sent. The group-aware copy
// still reaches WhatsApp recipients once they open the public whisp page.
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
  } else if (whisp.whisperChannel === "sms" && whisp.recipientPhone) {
    success = await sendSms(whisp.recipientPhone, whisperLinkSmsBody(sharedUrl, hookLine), logCtx);
  } else if (whisp.whisperChannel === "whatsapp" && whisp.recipientPhone) {
    success = await sendWhatsApp(whisp.recipientPhone, sharedUrl, logCtx);
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
