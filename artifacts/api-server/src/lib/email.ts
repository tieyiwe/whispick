import { logger } from "./logger";
import { HOOK_LINE } from "./copy";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Whispick <whispers@whispick.app>";

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    logger.warn({ to }, "RESEND_API_KEY not set; skipping email send");
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
      logger.error({ to, status: res.status, body: await res.text() }, "Failed to send email");
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ to, err }, "Error sending email");
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
    <p style="color:#888; font-size: 12px;">Sent anonymously via Whispick. No sender identity is included unless they choose to reveal it.</p>
  </div>`;
}

export function replyNotificationEmailHtml(videoTitle: string | null): string {
  const subject = videoTitle ? `your whisp "${videoTitle}"` : "your whisp";
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p>Someone replied anonymously to ${subject}. Log in to Whispick to read it.</p>
  </div>`;
}

export function appreciationNotificationEmailHtml(videoTitle: string | null): string {
  const subject = videoTitle ? `"${videoTitle}"` : "your whisp";
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p>Good news — the person you sent ${subject} to said it was something they needed to hear. 💜</p>
  </div>`;
}

export function mediaExpiringEmailHtml(filename: string, expiresAt: Date): string {
  const when = expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
    <p>Your uploaded video "${filename}" will be removed from Whispick on ${when} — save a copy now if you still need it.</p>
    <p style="font-size: 13px; color: #6b7280;">Whisps that already used it aren't affected as long as the recipient opened them in time.</p>
  </div>`;
}
