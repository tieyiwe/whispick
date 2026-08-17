// Parses the Whisper Link recipient field, which takes emails and phone
// numbers together in one box, comma-separated.
//
// Why one field instead of picking a channel first: making someone choose
// "Email / SMS / WhatsApp" before typing forces them to answer a question
// they don't think in terms of — they think "I want to send this to Sam",
// not "I want to use the SMS channel". The channel is derivable from what
// they type, so it's derived.
//
// Emails and phone numbers can be mixed freely in one send; each recipient
// gets delivered over whatever channel suits their own contact detail.

export type RecipientKind = "email" | "phone";

export interface ParsedRecipient {
  /** Exactly as typed (trimmed) — shown back to the user in the chip. */
  raw: string;
  kind: RecipientKind;
}

export interface RecipientParseResult {
  recipients: ParsedRecipient[];
  /** Entries that look like neither an email nor a phone number. */
  invalid: string[];
}

// Mirrors the server's own single-address rule (api-server lib/email.ts):
// one plain address, no display names, no lists, no angle brackets. Keeping
// the client stricter-or-equal means the user finds out here rather than via
// a rejected send.
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

// Deliberately permissive about formatting (spaces, dashes, parens, a
// leading +) but strict about content — the server normalizes to E.164 and
// has the final say. Requires at least 7 digits so a stray number in the
// field isn't silently treated as a phone number.
const PHONE_ALLOWED_CHARS = /^[+0-9()\-.\s]+$/;
const MIN_PHONE_DIGITS = 7;

function looksLikePhone(value: string): boolean {
  if (!PHONE_ALLOWED_CHARS.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS;
}

export function classifyRecipient(value: string): RecipientKind | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EMAIL_PATTERN.test(trimmed)) return "email";
  if (looksLikePhone(trimmed)) return "phone";
  return null;
}

/**
 * Splits on commas (and newlines, so a pasted column of contacts works),
 * classifies each entry, and de-duplicates.
 *
 * Note phone numbers are NOT split on spaces — "+1 555 123 4567" is one
 * recipient, which is exactly why the separator is a comma rather than
 * whitespace.
 */
export function parseRecipients(input: string): RecipientParseResult {
  const recipients: ParsedRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of input.split(/[,\n]/)) {
    const raw = part.trim();
    if (!raw) continue;

    const kind = classifyRecipient(raw);
    if (!kind) {
      invalid.push(raw);
      continue;
    }

    // Case-insensitive for emails; digits-only for phones, so the same number
    // typed two ways isn't sent twice.
    const key = kind === "email" ? raw.toLowerCase() : raw.replace(/\D/g, "");
    if (seen.has(key)) continue;
    seen.add(key);

    recipients.push({ raw, kind });
  }

  return { recipients, invalid };
}
