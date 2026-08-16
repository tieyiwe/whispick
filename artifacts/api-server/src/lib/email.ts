import { logger } from "./logger";
import { HOOK_LINE, INVITE_HOOK_LINE } from "./copy";
import { logDeliveryAttempt, type DeliveryLogContext } from "./deliveryLog";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Blind Whisper <whispers@blindwhisper.com>";
// CAN-SPAM (15 U.S.C. § 7704(a)(5)) requires a valid physical postal
// address on commercial email — same reasoning that put the STOP/HELP
// footer on every SMS (see lib/sms.ts's COMPLIANCE_FOOTER). "Wheaton,
// Maryland" alone (the only address currently in the Privacy
// Policy/Terms) isn't a specific enough postal address to satisfy this;
// a real street address, PO Box, or registered CMRA mailbox needs to go
// here before real production volume, via an env var so it can be set/
// corrected without a code change.
const COMPANY_MAILING_ADDRESS = process.env.COMPANY_MAILING_ADDRESS ?? null;

// Appended to every outbound email — company identification plus the
// physical address CAN-SPAM requires, once COMPANY_MAILING_ADDRESS is set.
// Deliberately included on every message (not just plainly "commercial"
// ones) rather than trying to classify each template as transactional vs.
// commercial — same "every message, not just the first" posture the SMS
// compliance footer already takes, for the same reason: simpler and safer
// than relying on a legal classification being right in every case.
function complianceFooter(): string {
  const addressLine = COMPANY_MAILING_ADDRESS
    ? `<br />${COMPANY_MAILING_ADDRESS}`
    : "";
  return `<p style="color:#9ca3af; font-size: 11px; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
    TIBLOGICS, a sub-entity of TILO GROUP, LLC${addressLine}
  </p>`;
}

export async function sendEmail(to: string, subject: string, html: string, logCtx: DeliveryLogContext): Promise<boolean> {
  if (!RESEND_API_KEY) {
    logger.warn({ to }, "RESEND_API_KEY not set; skipping email send");
    await logDeliveryAttempt("email", to, logCtx, { success: false, errorMessage: "RESEND_API_KEY is not set" });
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ to, status: res.status, body }, "Failed to send email");
      await logDeliveryAttempt("email", to, logCtx, {
        success: false,
        providerStatus: String(res.status),
        errorMessage: body.slice(0, 500),
      });
      return false;
    }

    const sent = (await res.json().catch(() => null)) as { id?: string } | null;
    await logDeliveryAttempt("email", to, logCtx, { success: true, providerMessageId: sent?.id ?? null });
    return true;
  } catch (err) {
    logger.error({ to, err }, "Error sending email");
    await logDeliveryAttempt("email", to, logCtx, {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function whisperLinkEmailHtml(publicUrl: string, hookLine: string = HOOK_LINE): string {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p style="font-size: 16px;">${hookLine}</p>
    <p>
      <a href="${publicUrl}" style="display:inline-block; padding: 12px 24px; background:#7C5CFC; color:#fff; border-radius: 999px; text-decoration:none; font-weight: 600;">
        View it
      </a>
    </p>
    <p style="color:#888; font-size: 12px;">Sent anonymously via Blind Whisper. No sender identity is included unless they choose to reveal it.</p>
    ${complianceFooter()}
  </div>`;
}

export function replyNotificationEmailHtml(videoTitle: string | null): string {
  const subject = videoTitle ? `your whisp "${videoTitle}"` : "your whisp";
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p>Someone replied anonymously to ${subject}. Log in to Blind Whisper to read it.</p>
    ${complianceFooter()}
  </div>`;
}

export function appreciationNotificationEmailHtml(videoTitle: string | null): string {
  const subject = videoTitle ? `"${videoTitle}"` : "your whisp";
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p>Good news — the person you sent ${subject} to said it was something they needed to hear. 💜</p>
    ${complianceFooter()}
  </div>`;
}

export function mediaExpiringEmailHtml(filename: string, expiresAt: Date): string {
  const when = expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p>Your uploaded video "${filename}" will be removed from Blind Whisper on ${when} — save a copy now if you still need it.</p>
    <p style="font-size: 13px; color: #6b7280;">Whisps that already used it aren't affected as long as the recipient opened them in time.</p>
    ${complianceFooter()}
  </div>`;
}

export function subscriptionVerificationEmailHtml(verifyUrl: string): string {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p style="font-size: 16px;">Confirm you'd like to receive anonymous whisps on the topics you picked.</p>
    <p>
      <a href="${verifyUrl}" style="display:inline-block; padding: 12px 24px; background:#7C5CFC; color:#fff; border-radius: 999px; text-decoration:none; font-weight: 600;">
        Confirm subscription
      </a>
    </p>
    <p style="font-size: 13px; color: #6b7280;">If you didn't request this, you can ignore this email — you won't be subscribed unless you confirm.</p>
    ${complianceFooter()}
  </div>`;
}

// Anonymous invite-a-friend (routes/invites.ts) — same anonymous framing and
// button structure as whisperLinkEmailHtml above, using the product's
// required verbatim hook line (see lib/copy.ts INVITE_HOOK_LINE) instead of
// the whisp one. No sender name/hint anywhere in this template.
export function inviteEmailHtml(inviteUrl: string): string {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p style="font-size: 16px;">${INVITE_HOOK_LINE}</p>
    <p>
      <a href="${inviteUrl}" style="display:inline-block; padding: 12px 24px; background:#7C5CFC; color:#fff; border-radius: 999px; text-decoration:none; font-weight: 600;">
        Join Blind Whisper
      </a>
    </p>
    <p style="color:#888; font-size: 12px;">Sent anonymously via Blind Whisper. No inviter identity is included unless they choose to reveal it.</p>
    ${complianceFooter()}
  </div>`;
}

export function subscriptionMatchedEmailFooter(unsubscribeUrl: string): string {
  return `<p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">
    You're getting this because you subscribed to anonymous whisps on a topic you chose.
    <a href="${unsubscribeUrl}" style="color: #9ca3af;">Unsubscribe</a>
  </p>`;
}
