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

/**
 * The single entry the caret currently sits in.
 *
 * The field holds a comma-separated list, so autocomplete has to work on one
 * entry rather than the whole value — otherwise typing a second recipient
 * matches against "sam@example.com, jo" and finds nothing, and accepting a
 * suggestion would replace everything already typed.
 */
export function tokenAtCaret(value: string, caret: number): { token: string; start: number; end: number } {
  const isSeparator = (ch: string) => ch === "," || ch === "\n";

  let start = caret;
  while (start > 0 && !isSeparator(value[start - 1])) start--;

  let end = caret;
  while (end < value.length && !isSeparator(value[end])) end++;

  return { token: value.slice(start, end).trim(), start, end };
}

/**
 * Swaps the entry at [start, end) for a chosen suggestion and leaves the caret
 * ready for the next one. Returns the new value and where the caret should go,
 * since the browser puts it at the end of the field otherwise — which would
 * drop you past entries you hadn't finished editing.
 */
export function replaceTokenAt(
  value: string,
  start: number,
  end: number,
  replacement: string,
): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  // Trailing ", " so the next entry can be typed straight away — but not when
  // something already follows, or the list grows a double separator.
  const needsSeparator = after.trim() === "";
  const inserted = needsSeparator ? `${replacement}, ` : replacement;
  return { value: before + inserted + after, caret: before.length + inserted.length };
}

/** Matching key for "is this contact already in the field" — mirrors parseRecipients. */
export function recipientKey(value: string, kind: RecipientKind): string {
  return kind === "email" ? value.trim().toLowerCase() : value.replace(/\D/g, "");
}

/**
 * How a whisp's recipient should be named back to its own sender.
 *
 * Only ever shown to the sender, and only their own data — they typed this
 * address themselves. Nothing here reveals whether that address belongs to a
 * registered account, which is the fact the anti-enumeration rules protect.
 *
 * Returns null for the broadcast-style deliveries that have no one recipient
 * (circle drops, Ghost Boost), so callers can fall back to their own wording
 * instead of printing a placeholder.
 */
export function recipientLabel(whisp: {
  recipientEmail?: string | null;
  recipientPhone?: string | null;
}): string | null {
  return whisp.recipientEmail?.trim() || whisp.recipientPhone?.trim() || null;
}
