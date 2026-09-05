// Scrubs likely-PII/secrets out of free text BEFORE it's ever written to the
// bug_issues/bug_occurrences tables — an error message or stack trace can
// easily contain an email a form was validating, a phone number mid-entry,
// or an auth header caught in a fetch failure's context, none of which
// belongs at rest in an error tracker any admin with the "bugrabbit"
// permission can browse. Deliberately conservative and pattern-based (not a
// fuzzy "looks random" heuristic) so it doesn't mangle ordinary stack traces
// — a few misses are an acceptable tradeoff for not eating half of every
// minified filename.

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Candidate spans: 7+ digits, optionally grouped with spaces/dashes/dots/
// parens/a leading +. Deliberately over-matches on its own (see isPhoneLike
// below) — long enough to avoid catching short numbers like a stack frame's
// line:column (e.g. "42:17"), a status code, or an array index, but a bare
// digit run this long is exactly as likely to be an internal id (a UUID
// segment, a database id, a timestamp) as a phone number.
const PHONE_CANDIDATE_PATTERN = /(?:\+?\d[\d\-\s().]{6,}\d)/g;

// A real phone number is essentially always written with at least one
// separator (a space, dash, dot, or parens) somewhere in it — an unbroken
// run of 7+ digits with zero formatting is far more often an id (a UUID's
// hex segments frequently contain a stretch that's coincidentally all
// digits) than a phone number. Requiring a separator is what keeps this
// scrubber from mangling error-message ids while still catching real
// numbers, at the honest cost of missing a phone number typed with no
// formatting at all — an acceptable miss for a best-effort scrubber.
function isPhoneLike(candidate: string): boolean {
  const digitCount = (candidate.match(/\d/g) ?? []).length;
  return digitCount >= 7 && /[-\s().]/.test(candidate);
}

// JWT-shaped: three dot-separated base64url segments.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

// Known secret-key prefixes (Stripe, Clerk, generic bearer headers) followed
// by their opaque value.
const SECRET_KEY_PATTERN = /\b(sk_live|sk_test|pk_live|pk_test|whsec|rk_live|rk_test|Bearer)[\s:=_]*[A-Za-z0-9_\-.]{8,}/gi;

export function scrubPii(text: string): string {
  return text
    .replace(JWT_PATTERN, "[redacted-token]")
    .replace(SECRET_KEY_PATTERN, "[redacted-secret]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_CANDIDATE_PATTERN, (candidate) => (isPhoneLike(candidate) ? "[redacted-phone]" : candidate));
}

// Strips the query string (the one place a URL commonly carries a token or
// email, e.g. a password-reset or magic-link href) and caps length —
// nothing here needs the full query, just which page/route it happened on.
export function scrubUrl(url: string, maxLen: number): string {
  const withoutQuery = url.split(/[?#]/)[0];
  return scrubPii(withoutQuery).slice(0, maxLen);
}
