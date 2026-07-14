import { sendEmail, whisperLinkEmailHtml } from "./email";
import { sendSms, sendWhatsApp, whisperLinkSmsBody } from "./sms";
import { HOOK_LINE } from "./copy";

type DeliverableWhisp = {
  publicToken: string;
  whisperChannel: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
};

// Dispatches a Whisper Link over whichever channel the sender chose. Shared
// between the immediate-send path (POST /whisps) and the scheduled dispatcher
// (lib/scheduler.ts), which delivers the same way once a future scheduledAt
// comes due.
export function deliverWhisperLink(whisp: DeliverableWhisp, appUrl: string): void {
  const sharedUrl = `${appUrl}/api/l/${whisp.publicToken}`;
  if (whisp.whisperChannel === "email" && whisp.recipientEmail) {
    void sendEmail(whisp.recipientEmail, HOOK_LINE, whisperLinkEmailHtml(sharedUrl));
  } else if (whisp.whisperChannel === "sms" && whisp.recipientPhone) {
    void sendSms(whisp.recipientPhone, whisperLinkSmsBody(sharedUrl));
  } else if (whisp.whisperChannel === "whatsapp" && whisp.recipientPhone) {
    void sendWhatsApp(whisp.recipientPhone, sharedUrl);
  }
}
