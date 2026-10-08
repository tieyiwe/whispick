# Text Whisps, SMS & Subscribe

## Text Whisps

A **Text Whisp** is a short, text-only anonymous message (≤260 chars, zod-enforced)
sent user-to-user, addressed by **phone number**. Deliberately a separate table from
`whisps` (`text_whisps` — the whisps table is built around a required video).

**Dual-path recipient model:**
- `recipientPhone` always stores the E.164-normalized number.
- `recipientUserId` is set **only** if the number matched a known, OTP-verified
  account at send time (`findVerifiedRecipient` requires
  `users.phoneVerifiedAt IS NOT NULL`). Matched → delivery is fully in-app.
- Otherwise it stays null forever (never retroactively relinked) and delivery goes
  out as a Twilio SMS pointing at the guest page `/tw/:publicToken`.
- Every Text Whisp gets a `publicToken`, even matched in-app sends.

**Statuses:** `scheduled | sent | read | replied`. `sent` means "delivery
attempted", not transport success.

**Lifecycle:** `POST /api/text-whisps` (self-send rejected, `createTextWhispLimiter`
30/hr). Future `scheduledAt` (≤ `MAX_SCHEDULE_DAYS` 30) → status `scheduled`, no
delivery; `lib/textWhispScheduler.ts` polls every 60 s (batch 100) and dispatches
due rows, skipping sender-soft-deleted ones. Immediate sends respond **before**
delivery fires (anti-enumeration: response shape and timing are identical whether
or not the phone matched an account). Recipient opening the thread marks `readAt`
(never regresses `replied`); a recipient reply flips status to `replied`.

**Replies** (`text_whisp_replies`): both parties authenticated (`senderId`
recorded directly); `parentReplyId` quotes within the thread (same-thread
validated, not a FK — stale ids degrade gracefully); WhatsApp-style `readAt`
receipts set when the other party opens the thread; reply notifications use
`notifyUserPersisted(kind: "reply")` so they count in the Replies tab badge.
**Guests can never reply** — there is no public reply endpoint (no user id to
attribute).

**Typing indicator:** `typingUserId`/`typingAt` on the parent row via
`POST /:id/typing` (TTL 8 s); exposed only as viewer-relative `otherPartyTyping`.

**Reveal flow:** sender `POST /:id/reveal` (blocked with 400 while the recipient
hasn't joined; `textWhispRevealLimiter` 20/hr — this 400-vs-200 is the one
remaining "does this phone belong to an account" oracle), recipient answers via
`POST /:id/reveal/respond`. Accepting grants permission only — it never injects
real identity.

**Responses never contain** `recipientUserId`/`recipientPhone` — `toResponse()`
substitutes `viewerIsRecipient`. The guest endpoint
(`GET /api/public/text-whisps/:token`) returns only
`id, messageText, senderAlias, status, revealRequested, createdAt`.

### Endpoints (`routes/textWhisps.ts` → `/api/text-whisps`, all authed)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Sent + received list (excluding own soft-deleted) |
| POST | `/` | Create/send/schedule |
| GET | `/:id` | Thread detail; marks read receipts |
| DELETE | `/:id` | Sender soft delete |
| GET/POST | `/:id/replies` | Thread replies |
| POST | `/:id/typing` | Ephemeral typing ping (204) |
| POST | `/:id/reveal`, `/:id/reveal/respond` | Reveal handshake |

Public: `GET /api/public/text-whisps/:token` (guest page for `/tw/:token`).

## SMS & phone verification

- **Twilio via raw REST** (`lib/sms.ts`): `sendSms`, `sendWhatsApp` (WhatsApp
  requires an approved Content Template — `ContentSid` + `{{1}}` link variable).
  Every send logs a `delivery_attempts` row. Twilio 2xx = accepted/queued only;
  no status webhooks are consumed. Missing config = soft no-op.
- **Compliance:** `COMPLIANCE_FOOTER` ("Reply STOP to opt out, HELP for help…")
  is appended to **every** outbound SMS (A2P 10DLC requirement). STOP/HELP are
  handled by Twilio Advanced Opt-Out — **there is no in-app opt-out table or
  inbound webhook** (known gap; email opt-out is separate and app-managed).
- **Normalization** (`lib/phone.ts`): `normalizePhoneE164` via libphonenumber-js,
  using `isPossible()` (not `isValid()`) so new ranges aren't false-rejected.
- **Verification** (`lib/phoneVerification.ts`): **Twilio Verify** (separate
  service SID). Routes in `routes/user.ts`:
  `POST /api/user/phone/start-verification` (5/hr) and
  `/confirm-verification` (15/hr). Success clears the same number off any other
  user row (recycled-SIM defense), then sets `users.phone` +
  `users.phoneVerifiedAt`. The Clerk-synced `users.phone` alone is **never**
  proof of ownership.

## Subscribe & Ghost Boost matching (`match_subscribers`)

Not related to Text Whisps despite living nearby: this is the audience side of
**Ghost Boost** — people opt in (email + 1–8 category keys, no account needed) to
receive anonymous whisps on topics they picked.

- `routes/subscribe.ts` (`/api/public`): `POST /subscribe` (double opt-in email;
  constant response so it can't be used as a membership oracle),
  `GET /subscribe/verify?token=`, `GET /subscribe/unsubscribe?token=` (one
  token serves both — holding it implies inbox access). Re-subscribing after
  unsubscribe requires re-confirmation. Emails are always lowercased/trimmed.
- **Matching** (`lib/matching.ts`): cooldown 48 h per subscriber, max 10 matches
  per campaign, 14-day matching window, 5-min grace for async categorization.
  Eligible = verified, not unsubscribed, cooldown ok, category array overlap.
  Each match inserts a new `whisps` row (`deliveryMethod: 'ghost_boost'`,
  `groupSendId` = campaign id) and emails the subscriber with an unsubscribe
  footer. Stats are aggregate-only.
- **Scheduler** (`matchScheduler`, 10-min poll): processes `pending` ghost_boost
  campaigns; terminal state is `delivered` (reached anyone) or `failed`.
- Ghost Boost sending is currently disabled (`GHOST_BOOST_ENABLED = false`), so
  this pipeline is dormant but intact.

## Push notifications

`lib/push.ts` (web-push + VAPID). `push_subscriptions`: one row per browser
(unique `endpoint`), registered via `POST/DELETE /api/user/push-subscription`;
`GET /api/user/push-public-key` serves the VAPID key (503 unconfigured).
Helpers: `notifyUser` (push only), **`notifyUserPersisted`** (persisted
notification row + push — the one everything user-facing should use),
`notifyAllUsers` (broadcast). HTTP 404/410 from a push service deletes the dead
subscription.

## Notifications (in-app)

`notifications` table: `targetUserId` (null = broadcast), title/body/url/`kind`,
`createdByAdminId` (null = system). `kind: "reply"` is load-bearing — the Replies
tab badge counts only unread replies. `notification_reads` holds per-(notification,
user) read state (broadcasts share one row). Endpoints in `routes/user.ts`:
`GET /notifications`, `GET /notifications/unread-count`,
`POST /notifications/:id/read`, `POST /notifications/read-all`.

## Scheduler infrastructure

No framework: each `lib/*Scheduler.ts` exports a `start*()` installing a bare
`setInterval`, all invoked once in `src/index.ts` after `app.listen`. Conventions:
60 s poll for delivery-critical dispatchers (10 min matching, hourly media
retention, 30 min takeaways, 24 h agents), batch limit 100, whole body
try/caught, and **`PUBLIC_APP_URL` mandatory** — without it due rows stay queued
(never silently marked sent). Due-row selection is factored into exported
functions (`getDueTextWhisps`, `getDueReplyNotifications`) for testability.
