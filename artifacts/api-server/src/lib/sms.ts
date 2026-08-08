import { logger } from "./logger";
import { HOOK_LINE } from "./copy";
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

export function whisperLinkSmsBody(publicUrl: string, hookLine: string = HOOK_LINE): string {
  return `${hookLine}\n${publicUrl}\n— sent anonymously via Blind Whisper\n${COMPLIANCE_FOOTER}`;
}
