import { logger } from "./logger";
import { HOOK_LINE } from "./copy";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const TWILIO_WHATSAPP_CONTENT_SID = process.env.TWILIO_WHATSAPP_CONTENT_SID;

function twilioAuthHeader(): string {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

async function postToTwilio(params: Record<string, string>, context: Record<string, unknown>): Promise<boolean> {
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
      logger.error({ ...context, status: res.status, body: await res.text() }, "Failed to send Twilio message");
      return false;
    }

    // Twilio's response here only confirms the message was *accepted and
    // queued* — actual delivery to the handset happens asynchronously and
    // this app doesn't subscribe to Twilio's delivery-status webhooks, so a
    // "queued" here can still end up undelivered later (most commonly: a
    // trial account sending to a recipient number that isn't in its
    // verified caller ID list). Logging the sid/status at least makes that
    // queued-vs-never-attempted distinction visible in our own logs instead
    // of only in the Twilio Console.
    const accepted = (await res.json().catch(() => null)) as { sid?: string; status?: string } | null;
    logger.info({ ...context, sid: accepted?.sid, status: accepted?.status }, "Twilio message accepted");
    return true;
  } catch (err) {
    logger.error({ ...context, err }, "Error sending Twilio message");
    return false;
  }
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    logger.warn({ to }, "Twilio SMS not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER); skipping SMS send");
    return false;
  }

  return postToTwilio({ To: to, From: TWILIO_FROM_NUMBER, Body: body }, { to, channel: "sms" });
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
export async function sendWhatsApp(to: string, linkUrl: string): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !TWILIO_WHATSAPP_CONTENT_SID) {
    logger.warn(
      { to },
      "Twilio WhatsApp not configured (TWILIO_WHATSAPP_FROM/TWILIO_WHATSAPP_CONTENT_SID); skipping WhatsApp send",
    );
    return false;
  }

  return postToTwilio(
    {
      To: `whatsapp:${to}`,
      From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
      ContentSid: TWILIO_WHATSAPP_CONTENT_SID,
      ContentVariables: JSON.stringify({ "1": linkUrl }),
    },
    { to, channel: "whatsapp" },
  );
}

export function whisperLinkSmsBody(publicUrl: string, hookLine: string = HOOK_LINE): string {
  return `${hookLine}\n${publicUrl}\n— sent anonymously via Whispick`;
}
