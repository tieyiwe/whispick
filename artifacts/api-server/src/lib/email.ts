import nodemailer from "nodemailer";
import { logger } from "./logger";
import { HOOK_LINE, INVITE_HOOK_LINE, debateTopicWhispHookLine } from "./copy";
import { logDeliveryAttempt, type DeliveryLogContext } from "./deliveryLog";
import { escapeHtml } from "./escapeHtml";
import { UPLOAD_RETENTION_DAYS } from "./uploads";

// Primary transport: SMTP through the Titan mailbox (sender@blindwhisper.com).
// Titan is a mailbox provider, not an email API, so delivery goes over
// authenticated SMTP — host/port default to Titan's but stay overridable in
// case the mailbox ever moves providers. Resend is kept below only as a
// legacy fallback for environments that still have RESEND_API_KEY set.
const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.titan.email";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// With SMTP the From address must match (or be authorized for) the
// authenticated mailbox, or Titan rejects the message — so when EMAIL_FROM
// isn't set explicitly, derive it from the SMTP account rather than
// defaulting to an address the mailbox can't send as.
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? (SMTP_USER ? `Blind Whisper <${SMTP_USER}>` : "Blind Whisper <whispers@blindwhisper.com>");

// Lazily created so simply importing this module (tests, workers that never
// email) doesn't open an SMTP pool.
let smtpTransport: nodemailer.Transporter | null = null;
function getSmtpTransport(): nodemailer.Transporter {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER!, pass: SMTP_PASS! },
    });
  }
  return smtpTransport;
}
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
  const addressLine = COMPANY_MAILING_ADDRESS ? `<br />${COMPANY_MAILING_ADDRESS}` : "";
  // Names one legal entity and the postal address, and stops there. CAN-SPAM
  // asks for a valid physical address, not a description of corporate
  // structure — "a sub-entity of ..." satisfied nothing and read to a
  // recipient like a forwarded chain of companies, which is the shape spam
  // takes. The brand the recipient actually recognises leads.
  return `<p style="margin:20px 0 0;color:#5F5F73;font-size:11px;line-height:1.6;text-align:center;">
    Blind Whisper is a service of TIBLOGICS.${addressLine}
  </p>`;
}

// ---------------------------------------------------------------------------
// Email layout primitives.
//
// Email HTML is not web HTML: Outlook renders through Word, Gmail strips
// <head> and <style>, and neither flexbox nor grid can be relied on. Hence
// nested tables with inline styles and explicit bgcolor attributes — the
// dated-looking constructs are the ones that actually render everywhere.
// ---------------------------------------------------------------------------

const CARD_BG = "#14142B";
const CARD_BORDER = "#2A2A4A";
const PAGE_BG = "#F4F4F7";
const ACCENT = "#9B7BFF";
// A shade deeper than the app's #7C5CFC so the label clears WCAG AA (4.57:1)
// at 16px — the on-screen purple only managed 3.77:1 behind white text.
const BUTTON_BG = "#6D4AF5";
const TEXT = "#EDEDF7";
const TEXT_MUTED = "#A8A8C0";
const TEXT_FAINT = "#9A9AB8";

/**
 * Wraps content in the branded card. Dark, like the app itself — a whisp is
 * meant to feel like something arriving after dark, and a white transactional
 * shell threw that away the moment it landed in the inbox.
 *
 * `extraFooterHtml` is for per-send additions that must sit outside the card
 * but inside the centred column (the Ghost Boost unsubscribe line). It used to
 * be concatenated onto the end of the returned string by the caller, which put
 * it outside the layout entirely and left it full-width and flush left.
 */
function emailShell(contentHtml: string, extraFooterHtml = ""): string {
  // A complete document, not a bare fragment. Filters and clients both parse
  // what arrives; a fragment with no doctype and no declared charset leaves
  // the encoding to be guessed and reads as machine-assembled, and malformed
  // HTML is a documented spam heuristic. Cheap to get right, so it is.
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blind Whisper</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;">
          <tr>
            <td bgcolor="${CARD_BG}" style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:18px;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
              <div style="text-align:center;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${ACCENT};font-weight:700;margin:0 0 22px;">
                Blind Whisper
              </div>
              ${contentHtml}
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;">
          <tr>
            <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
              ${extraFooterHtml}
              ${complianceFooter()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailHeading(text: string): string {
  return `<p style="margin:0;text-align:center;font-size:20px;line-height:1.45;font-weight:600;color:${TEXT};">${text}</p>`;
}

function emailText(text: string): string {
  return `<p style="margin:14px 0 0;text-align:center;font-size:14px;line-height:1.65;color:${TEXT_MUTED};">${text}</p>`;
}

/**
 * A "bulletproof" button: the background colour lives on a table cell rather
 * than the anchor, because Outlook drops padding and background from an <a>
 * and would otherwise render this as a bare text link.
 */
function emailButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;">
    <tr>
      <td align="center" bgcolor="${BUTTON_BG}" style="border-radius:999px;">
        <a href="${url}" style="display:inline-block;padding:16px 46px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:1;color:#EDEDF7;text-decoration:none;border-radius:999px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/** The raw URL under the button — for clients that mangle buttons, and for
 *  anyone who'd rather see where a link goes before following it. */
function emailFallbackLink(url: string): string {
  return `<p style="margin:16px 0 0;text-align:center;font-size:12px;line-height:1.6;color:${TEXT_FAINT};">
    Or open this link:<br />
    <a href="${url}" style="color:${ACCENT};text-decoration:none;word-break:break-all;">${url}</a>
  </p>`;
}

/** Fine print below a hairline rule, inside the card. */
function emailNote(text: string): string {
  return `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid ${CARD_BORDER};text-align:center;font-size:12px;line-height:1.6;color:${TEXT_FAINT};">${text}</p>`;
}

// Exactly one plain address, nothing else. nodemailer parses `to` as an
// address LIST, so "victim@x.com, attacker@evil.com" is three deliveries, not
// a validation error — and a `to` carrying CRLF is header-injection shaped.
// Route schemas already validate these fields, but this is the chokepoint
// every send funnels through: enforcing it here means a future call site
// can't quietly reintroduce the same hole. Deliberately stricter than a full
// RFC address parser (no display names, no groups, no comments) because
// nothing this app sends needs any of that.
const SINGLE_EMAIL_ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

function isSingleEmailAddress(value: string): boolean {
  return value.length <= 320 && SINGLE_EMAIL_ADDRESS.test(value);
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Plain-text alternative for the HTML body.
 *
 * Every message used to go out as HTML only, which is one of the older and
 * stronger spam heuristics there is: legitimate senders offer both parts, and
 * a message with no text/plain alternative is disproportionately bulk mail.
 * It also means anything reading without HTML — a text-only client, a screen
 * reader falling back, a preview pane — got a blank message.
 *
 * Derived from the HTML rather than written per template on purpose: two
 * hand-maintained copies of the same message drift, and the one nobody looks
 * at is the one that goes stale. This only ever parses HTML this module built
 * itself, so it can be simple without being fragile.
 */
export function htmlToPlainText(html: string): string {
  const withoutHead = html.replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, "");

  const linked = withoutHead.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      // "Label: url" so the destination survives, except when the label is
      // already the URL — printing it twice reads like a mistake. Note the
      // angle-bracket convention ("Label <url>") is NOT usable here: the
      // tag-stripping pass below would eat <url> as if it were a tag, which
      // silently dropped every button's destination.
      return !text || text === href ? href : `${text}: ${href}`;
    },
  );

  const decoded = linked
    .replace(/<br\s*\/?>/gi, "\n")
    // Block-level closers become line breaks so the text keeps the shape of
    // the message instead of collapsing into one paragraph.
    .replace(/<\/(p|div|h[1-6]|td|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;|&quot;|&nbsp;|&amp;|&lt;|&gt;/g, (entity) => HTML_ENTITIES[entity] ?? entity);

  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(to: string, subject: string, html: string, logCtx: DeliveryLogContext): Promise<boolean> {
  if (!isSingleEmailAddress(to)) {
    // Logged without echoing the address itself — a rejected value is
    // attacker-supplied by definition, and putting it in the logs verbatim
    // just moves the injection attempt into the log stream.
    logger.error({ length: to.length }, "Refusing to send email: `to` is not a single plain address");
    await logDeliveryAttempt("email", to, logCtx, {
      success: false,
      errorMessage: "Recipient address is not a single valid email address",
    });
    return false;
  }

  if (SMTP_USER && SMTP_PASS) {
    try {
      // Both parts: nodemailer assembles multipart/alternative from these.
      const info = await getSmtpTransport().sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        html,
        text: htmlToPlainText(html),
      });
      await logDeliveryAttempt("email", to, logCtx, { success: true, providerMessageId: info.messageId ?? null });
      return true;
    } catch (err) {
      logger.error({ to, err }, "Error sending email via SMTP");
      await logDeliveryAttempt("email", to, logCtx, {
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  if (!RESEND_API_KEY) {
    logger.warn({ to }, "No email transport configured (SMTP_USER/SMTP_PASS or RESEND_API_KEY); skipping email send");
    await logDeliveryAttempt("email", to, logCtx, { success: false, errorMessage: "No email transport configured" });
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text: htmlToPlainText(html) }),
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

// hookLine is always one of lib/copy.ts's constants or functions — app copy,
// never recipient- or sender-supplied text — so it goes in unescaped on
// purpose (it carries emoji and, in the reminder variant, a formatted date).
export function whisperLinkEmailHtml(
  publicUrl: string,
  hookLine: string = HOOK_LINE,
  extraFooterHtml = "",
): string {
  return emailShell(
    `${emailHeading(hookLine)}
     ${emailText("It's waiting behind a private link — no account, no sign-up. Just open it.")}
     ${emailButton(publicUrl, "View your whisp")}
     ${emailFallbackLink(publicUrl)}
     ${emailNote(
       "Sent anonymously through Blind Whisper. The sender's identity isn't included unless they choose to reveal it.",
     )}`,
    extraFooterHtml,
  );
}

export function replyNotificationEmailHtml(videoTitle: string | null): string {
  // videoTitle can originate from a third-party page's scraped og:title, so
  // escape it before it lands in this HTML string (it isn't rendered through
  // React here) — otherwise it's a content-injection vector into the inbox.
  const subject = videoTitle ? `your whisp "${escapeHtml(videoTitle)}"` : "your whisp";
  return emailShell(
    `${emailHeading("You got a reply 💬")}
     ${emailText(`Someone replied anonymously to ${subject}. Open Blind Whisper to read it.`)}`,
  );
}

export function appreciationNotificationEmailHtml(videoTitle: string | null): string {
  const subject = videoTitle ? `"${escapeHtml(videoTitle)}"` : "your whisp";
  return emailShell(
    `${emailHeading("It landed 💜")}
     ${emailText(`The person you sent ${subject} to said it was something they needed to hear.`)}`,
  );
}

export function mediaExpiringEmailHtml(filename: string, expiresAt: Date): string {
  const when = expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  // filename is the user's own uploaded filename — escape it so a crafted
  // name can't inject markup into this HTML email.
  return emailShell(
    `${emailHeading("Your uploaded video is expiring")}
     ${emailText(
       `"${escapeHtml(filename)}" will be removed from Blind Whisper on ${when} — save a copy now if you still need it.`,
     )}
     ${emailNote("Whisps that already used it aren't affected, as long as the recipient opened them in time.")}`,
  );
}

// Sent once the video is actually gone (see mediaRetentionScheduler.ts's
// deleteExpiredMedia), distinct from mediaExpiringEmailHtml above which
// fires a couple of days beforehand while there's still time to save a
// copy — this one is purely informational, nothing left to act on.
export function mediaExpiredEmailHtml(filename: string): string {
  return emailShell(
    `${emailHeading("Your uploaded video has been removed")}
     ${emailText(`"${escapeHtml(filename)}" has been removed from Blind Whisper after ${UPLOAD_RETENTION_DAYS} days, as expected.`)}
     ${emailNote("Whisps that already used it aren't affected, as long as the recipient opened them in time.")}`,
  );
}

export function subscriptionVerificationEmailHtml(verifyUrl: string): string {
  return emailShell(
    `${emailHeading("Confirm your subscription")}
     ${emailText("You asked to receive anonymous whisps on the topics you picked. One tap and you're set.")}
     ${emailButton(verifyUrl, "Confirm subscription")}
     ${emailFallbackLink(verifyUrl)}
     ${emailNote("If you didn't request this, ignore this email — you won't be subscribed unless you confirm.")}`,
  );
}

// Anonymous invite-a-friend (routes/invites.ts) — same anonymous framing and
// button structure as whisperLinkEmailHtml above, using the product's
// required verbatim hook line (see lib/copy.ts INVITE_HOOK_LINE) instead of
// the whisp one. No sender name/hint anywhere in this template.
export function inviteEmailHtml(inviteUrl: string): string {
  return emailShell(
    `${emailHeading(INVITE_HOOK_LINE)}
     ${emailButton(inviteUrl, "Join Blind Whisper")}
     ${emailFallbackLink(inviteUrl)}
     ${emailNote(
       "Sent anonymously through Blind Whisper. The inviter's identity isn't included unless they choose to reveal it.",
     )}`,
  );
}

// Debate Now topic whisp (routes/debateTopicWhisps.ts) — topicText and note
// both originate from real users (a topic's author, and the sender of this
// whisp respectively), so both are escaped before landing in this
// unescaped-HTML-string template, same reasoning as replyNotificationEmailHtml's
// videoTitle above.
export function debateTopicWhispEmailHtml(topicText: string, topicUrl: string, note?: string | null): string {
  return emailShell(
    `${emailHeading(debateTopicWhispHookLine())}
     ${emailText(`"${escapeHtml(topicText)}"`)}
     ${note ? emailText(escapeHtml(note)) : ""}
     ${emailButton(topicUrl, "Join the debate")}
     ${emailFallbackLink(topicUrl)}
     ${emailNote("Sent anonymously through Blind Whisper.")}`,
  );
}

// Admin-composed announcement/update, sent from the admin panel's
// communication tool (routes/admin.ts POST /notifications with
// sendEmail:true). Title and body are the admin's own plain text — escaped
// here since they're interpolated into raw HTML, and newlines become <br>
// so multi-paragraph updates read as written.
export function adminAnnouncementEmailHtml(title: string, body: string, url: string | null): string {
  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");
  return emailShell(
    `${emailHeading(escapeHtml(title))}
     ${emailText(bodyHtml)}
     ${url ? emailButton(url, "Open Blind Whisper") : ""}
     ${emailNote("You're receiving this because you have a Blind Whisper account. You can turn off email notifications in Settings.")}`,
  );
}

export function subscriptionMatchedEmailFooter(unsubscribeUrl: string): string {
  return `<p style="margin:20px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#5F5F73;">
    You're getting this because you subscribed to anonymous whisps on a topic you chose.<br />
    <a href="${unsubscribeUrl}" style="color:#5F5F73;text-decoration:underline;">Unsubscribe</a>
  </p>`;
}
