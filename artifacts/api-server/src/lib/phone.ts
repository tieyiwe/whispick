import { parsePhoneNumberWithError } from "libphonenumber-js";

// The one normalization utility for phone numbers in this codebase — no
// prior one existed (whisps.recipientPhone, circle member phones, and the
// old Clerk-synced users.phone were all stored as whatever string the
// sender/user typed). Only used where the *exact* number matters for
// equality, currently: lib/phoneVerification.ts (before storing a verified
// number) and lib/deliver.ts (before comparing a whisp's recipientPhone
// against verified users.phone values). Everywhere else in the app a phone
// number is just an address to hand to Twilio, which does its own parsing.
//
// Defaults to US when the input has no leading '+' — this app's phone
// inputs (SendWhisp's recipient field, the phone-verification dialog) show a
// "+1 555 123 4567" placeholder implying a country code is expected, but a
// bare 10-digit US number is still the single most likely mistake to
// silently support rather than reject.
const DEFAULT_COUNTRY = "US";

// Returns the number in E.164 form (e.g. "+15551234567"), or null if it
// can't be parsed as a plausible phone number at all. Never throws.
//
// Deliberately checks isPossible() (right length/shape for its country),
// not the stricter isValid() (matches a real, currently-allocated
// range) — isValid() rejects perfectly real-looking numbers Twilio itself
// would happily send to (e.g. any 555 exchange, which this app's own
// placeholder copy and test fixtures use, and newly-issued ranges
// libphonenumber's bundled metadata hasn't caught up with yet). The actual
// send (or Verify challenge) is what proves a number real; this is just
// "does it look like a phone number" so we don't false-reject on format
// alone, on either the verification-start or the matching path.
export function normalizePhoneE164(raw: string): string | null {
  try {
    const parsed = parsePhoneNumberWithError(raw, DEFAULT_COUNTRY);
    return parsed.isPossible() ? parsed.number : null;
  } catch {
    return null;
  }
}
