import { logger } from "./logger";

// Twilio Verify — a separate product from the raw SMS sending in lib/sms.ts,
// purpose-built for "prove this caller actually controls this phone number"
// (a real, one-time code sent over the telecom network) rather than
// "deliver an arbitrary message". Deliberately NOT TOTP or a push-based
// approval: those only prove someone controls a device/app session, never
// that they control a specific phone number/SIM — neither touches the
// telecom network, so either would let anyone type in and "verify" someone
// else's number. This needs its own Verify Service (a TWILIO_VERIFY_SERVICE_SID,
// created once in the Twilio Console), but reuses the same account
// SID/auth token as every other Twilio feature in this app.
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

function isConfigured(): boolean {
  return !!TWILIO_ACCOUNT_SID && !!TWILIO_AUTH_TOKEN && !!TWILIO_VERIFY_SERVICE_SID;
}

function twilioAuthHeader(): string {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

export type StartVerificationResult =
  | { ok: true }
  | { ok: false; error: string };

// Kicks off a Twilio Verify SMS challenge to `phone` (already normalized to
// E.164 by the caller — see lib/phone.ts). This is a real per-call SMS cost
// (same as lib/sms.ts's sends), which is why POST
// /user/phone/start-verification is rate-limited (see lib/rateLimit.ts's
// phoneVerificationLimiter) same as every other real-cost feature in this
// app.
export async function startPhoneVerification(phone: string): Promise<StartVerificationResult> {
  if (!isConfigured()) {
    logger.warn({ phone }, "Twilio Verify not configured (TWILIO_VERIFY_SERVICE_SID); skipping phone verification start");
    return { ok: false, error: "Phone verification is not configured" };
  }

  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, Channel: "sms" }).toString(),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      logger.error({ phone, status: res.status, body }, "Failed to start Twilio Verify verification");
      return { ok: false, error: "Couldn't send a verification code to that number" };
    }

    return { ok: true };
  } catch (err) {
    logger.error({ phone, err }, "Error starting Twilio Verify verification");
    return { ok: false, error: "Couldn't send a verification code to that number" };
  }
}

export type CheckVerificationResult =
  | { ok: true }
  | { ok: false; error: string };

// Confirms a code the user entered against the in-flight Twilio Verify
// challenge for `phone`. Twilio Verify tracks attempt/expiry state itself
// (a code expires after ~10 minutes and locks out after repeated wrong
// guesses), so there's no separate attempt-tracking table here — its own
// VerificationCheck response already tells us success/expired/wrong in one
// call, which is what routes/user.ts's confirm-verification route surfaces
// to the frontend.
export async function checkPhoneVerification(phone: string, code: string): Promise<CheckVerificationResult> {
  if (!isConfigured()) {
    logger.warn({ phone }, "Twilio Verify not configured (TWILIO_VERIFY_SERVICE_SID); skipping phone verification check");
    return { ok: false, error: "Phone verification is not configured" };
  }

  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, Code: code }).toString(),
      },
    );

    const body = (await res.json().catch(() => null)) as { status?: string } | null;

    if (!res.ok) {
      // Twilio returns 404 once the verification has already been approved
      // or has fully expired (not just "wrong code") — either way, from the
      // user's perspective this reads the same: "start over."
      logger.warn({ phone, status: res.status, body }, "Twilio Verify check failed");
      return { ok: false, error: "That code is incorrect or has expired. Request a new one." };
    }

    if (body?.status !== "approved") {
      return { ok: false, error: "That code is incorrect or has expired. Request a new one." };
    }

    return { ok: true };
  } catch (err) {
    logger.error({ phone, err }, "Error checking Twilio Verify verification");
    return { ok: false, error: "Couldn't verify that code — please try again" };
  }
}
