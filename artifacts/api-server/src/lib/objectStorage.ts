import { Client } from "@replit/object-storage";
import { logger } from "./logger";

// Replit Object Storage needs no API key from the user — on Replit, enabling
// Object Storage for the app binds a default bucket automatically and this
// client talks to it via Replit's local sidecar. Outside Replit (or if
// Object Storage isn't enabled), every call below fails and we degrade the
// same way this app already treats Resend/Twilio/Stripe/VAPID as optional:
// log a warning, return a clear "unavailable" result, never throw out to the
// caller.
let client: Client | null = null;

function getClient(): Client {
  client ??= new Client();
  return client;
}

export async function uploadObject(key: string, contents: Buffer): Promise<boolean> {
  try {
    const result = await getClient().uploadFromBytes(key, contents, { compress: false });
    if (!result.ok) {
      logger.error({ key, error: result.error }, "Object storage upload failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, key }, "Object storage is unavailable (not running on Replit, or Object Storage isn't enabled)");
    return false;
  }
}

export async function downloadObject(key: string): Promise<Buffer | null> {
  try {
    const result = await getClient().downloadAsBytes(key, { decompress: false });
    if (!result.ok) return null;
    return result.value[0];
  } catch (err) {
    logger.error({ err, key }, "Object storage download failed");
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    const result = await getClient().delete(key, { ignoreNotFound: true });
    if (!result.ok) {
      logger.warn({ key, error: result.error }, "Object storage delete failed");
    }
  } catch (err) {
    logger.warn({ err, key }, "Object storage delete failed");
  }
}
