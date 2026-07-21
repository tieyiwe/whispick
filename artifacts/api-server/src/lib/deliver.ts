import { sendEmail, whisperLinkEmailHtml } from "./email";
import { sendSms, sendWhatsApp, whisperLinkSmsBody } from "./sms";
import { HOOK_LINE } from "./copy";

type DeliverableWhisp = {
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
// comes due.
//
// Note: WhatsApp business-initiated messages must use a pre-approved Twilio
// Content Template (see sms.ts), so `hookLine` has no effect there — the
// template's own wording is what actually gets sent. The group-aware copy
// still reaches WhatsApp recipients once they open the public whisp page.
export function deliverWhisperLink(whisp: DeliverableWhisp, appUrl: string, hookLine: string = HOOK_LINE): void {
  const sharedUrl = `${appUrl}/api/l/${whisp.publicToken}`;
  if (whisp.whisperChannel === "email" && whisp.recipientEmail) {
    void sendEmail(whisp.recipientEmail, hookLine, whisperLinkEmailHtml(sharedUrl, hookLine));
  } else if (whisp.whisperChannel === "sms" && whisp.recipientPhone) {
    void sendSms(whisp.recipientPhone, whisperLinkSmsBody(sharedUrl, hookLine));
  } else if (whisp.whisperChannel === "whatsapp" && whisp.recipientPhone) {
    void sendWhatsApp(whisp.recipientPhone, sharedUrl);
  }
}
