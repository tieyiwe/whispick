import { logger } from "./logger";
import { SMS_WHISPER_LINK_LEAD, SMS_INVITE_LEAD, SMS_TEXT_WHISP_LEAD, SMS_DEBATE_TOPIC_WHISP_LEAD } from "./copy";
import { logDeliveryAttempt, type DeliveryLogContext } from "./deliveryLog";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const TWILIO_WHATSAPP_CONTENT_SID = process.env.TWILIO_WHATSAPP_CONTENT_SID;

function twilioAuthHeader(): string {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

async function postToTwilio(
  to: string,
  channel: "sms" | "whatsapp",
  params: Record<string, string>,
  logCtx: DeliveryLogContext,
): Promise<boolean> {
  const context = { to, channel };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ ...context, status: res.status, body }, "Failed to send Twilio message");
      await logDeliveryAttempt(channel, to, logCtx, {
        success: false,
        providerStatus: String(res.status),
        errorMessage: body.slice(0, 500),
      });
      return false;
    }

    // Twilio's response here only confirms the message was *accepted and
    // queued* — actual delivery to the handset happens asynchronously and
    // this app doesn't subscribe to Twilio's delivery-status webhooks, so a
    // "queued" here can still end up undelivered later (most commonly: a
    // trial account sending to a recipient number that isn't in its
    // verified caller ID list). Logging the sid/status makes that
    // queued-vs-never-attempted distinction visible in our own logs, and
    // persisting it to delivery_attempts makes it visible to admins too,
    // not just whoever can read the Twilio Console or server logs.
    const accepted = (await res.json().catch(() => null)) as { sid?: string; status?: string } | null;
    logger.info({ ...context, sid: accepted?.sid, status: accepted?.status }, "Twilio message accepted");
    await logDeliveryAttempt(channel, to, logCtx, {
      success: true,
      providerMessageId: accepted?.sid ?? null,
      providerStatus: accepted?.status ?? null,
    });
    return true;
  } catch (err) {
    logger.error({ ...context, err }, "Error sending Twilio message");
    await logDeliveryAttempt(channel, to, logCtx, {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function sendSms(to: string, body: string, logCtx: DeliveryLogContext): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    logger.warn({ to }, "Twilio SMS not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER); skipping SMS send");
    await logDeliveryAttempt("sms", to, logCtx, { success: false, errorMessage: "Twilio SMS is not configured" });
    return false;
  }

  return postToTwilio(to, "sms", { To: to, From: TWILIO_FROM_NUMBER, Body: body }, logCtx);
}

/**
 * WhatsApp business-initiated messages must use a pre-approved message
 * template (Twilio Content API) — free-form body text is only allowed as a
 * reply within an active 24-hour customer-service window, which doesn't
 * apply here since this is always the first message to that recipient.
 * Create and get a template approved in the Twilio Console (Content Template
 * Builder) with a single {{1}} variable for the link, then set its SID as
 * TWILIO_WHATSAPP_CONTENT_SID.
 */
export async function sendWhatsApp(to: string, linkUrl: string, logCtx: DeliveryLogContext): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !TWILIO_WHATSAPP_CONTENT_SID) {
    logger.warn(
      { to },
      "Twilio WhatsApp not configured (TWILIO_WHATSAPP_FROM/TWILIO_WHATSAPP_CONTENT_SID); skipping WhatsApp send",
    );
    await logDeliveryAttempt("whatsapp", to, logCtx, { success: false, errorMessage: "Twilio WhatsApp is not configured" });
    return false;
  }

  return postToTwilio(
    to,
    "whatsapp",
    {
      To: `whatsapp:${to}`,
      From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
      ContentSid: TWILIO_WHATSAPP_CONTENT_SID,
      ContentVariables: JSON.stringify({ "1": linkUrl }),
    },
    logCtx,
  );
}

// Msg&Data-rates/STOP disclosure on every SMS this app sends, not just the
// first one to a given number — a Sender's follow-up, reminder, or reveal
// notification (see lib/copy.ts) can be the actual first message a given
// recipient number receives from us if an earlier send to it failed, so
// there's no single "first message" we can safely omit this from. Required
// for A2P 10DLC campaign approval (Twilio error 30896/30886) and standard
// carrier compliance regardless.
const COMPLIANCE_FOOTER = "Reply STOP to opt out, HELP for help. Msg & data rates may apply.";

// Deliberately ignores whatever hookLine a caller (deliver.ts's
// deliverWhisperLink) is using for the email/in-app copy of this same
// notification — see SMS_WHISPER_LINK_LEAD's own comment for why the SMS
// channel specifically is pinned to one fixed, compliant template instead
// of varying by trigger (initial send / reminder / group / reply / reveal).
export function whisperLinkSmsBody(publicUrl: string): string {
  return `${SMS_WHISPER_LINK_LEAD}\n${publicUrl}\n${COMPLIANCE_FOOTER}`;
}

// Invite-a-friend (routes/invites.ts) — same structure as
// whisperLinkSmsBody above (fixed compliant lead, link, compliance footer),
// just pointed at the invite landing page instead of a whisp.
export function inviteSmsBody(inviteUrl: string): string {
  return `${SMS_INVITE_LEAD}\n${inviteUrl}\n${COMPLIANCE_FOOTER}`;
}

// Text Whisp guest delivery (routes/textWhisps.ts) — sent when the recipient
// phone number didn't match a known, OTP-verified Blind Whisper account at
// send time, so there's no in-app notification to fall back to (see
// lib/deliver.ts's findVerifiedRecipient / deliverInApp). Same
// lead/link/compliance-footer shape as whisperLinkSmsBody/inviteSmsBody
// above, pointed at the public Text Whisp landing page instead.
export function textWhispGuestSmsBody(publicUrl: string): string {
  return `${SMS_TEXT_WHISP_LEAD}\n${publicUrl}\n${COMPLIANCE_FOOTER}`;
}

// Debate Now topic whisp (routes/debateTopicWhisps.ts) — same
// lead/link/compliance-footer shape as the others above, plus the sender's
// optional note inserted between the lead and the link when present.
// Deliberately doesn't include the topic text itself (keeps the SMS short —
// the topic is right there once they open the link, same restraint
// whisperLinkSmsBody shows toward a whisp's video title).
export function debateTopicWhispSmsBody(publicUrl: string, note?: string | null): string {
  const noteLine = note ? `\n"${note}"` : "";
  return `${SMS_DEBATE_TOPIC_WHISP_LEAD}${noteLine}\n${publicUrl}\n${COMPLIANCE_FOOTER}`;
}
