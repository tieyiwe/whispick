# Video Whisps

A **Whisp** is one anonymously-sent short video (a pasted platform URL or a device
upload) plus an optional anonymous note, mood tag, and sender alias, addressed to a
recipient who opens it through an unguessable public token. The sender is a signed-in
Whisperer; the recipient is normally anonymous — **token possession is the entire
trust model on public routes**.

Table: `whisps` (PK `id`, unique `public_token`).

## Delivery methods (`delivery_method`)

| Value | Meaning |
|---|---|
| `whisper_link` | One addressed recipient over email / SMS / WhatsApp |
| `group_whisper` | Fan-out to a Whisper Group — one whisp row per member, tied by `group_send_id` / `whisper_group_id` |
| `ghost_boost` | Fan-out to opted-in strangers (currently **disabled**: `GHOST_BOOST_ENABLED = false` in `lib/plans.ts`) |
| `circle_drop` | Post to the public Blind Circle feed or a private circle (`circle_id`) |
| `circle_dm` | Private conversation spawned from a circle_drop (`origin_circle_whisp_id`); never expires |

## Status machine

`pending` (ghost_boost queued) → `scheduled` (future `scheduled_at`) → `delivered` →
`opened` → `watched` → `replied`; `failed` when the initial transport fails.
`replied` is terminal — a late `watched_complete` sets `watched_at` but never
regresses the status.

## Lifecycle

1. **Create** — `POST /api/whisps`. Gate order: demographics gate (428
   `demographics_required`) → zod validation (`videoUrl` XOR `uploadedVideoId`) →
   Ghost Boost kill-switch → upload ownership + readiness → schedule cap
   (`MAX_SCHEDULE_DAYS` 30; 5 with an upload) → channel/contact validation →
   **atomic guarded UPDATEs** for the monthly Whisper Link quota
   (`users.whisperLinksUsed`) and boost credit spend (single-statement, 402 on zero
   rows — prevents concurrent-send races). Video fields are always derived
   **server-side** by `deriveVideoFields` (never trusted from the client — iframe
   injection / IP-deanonymization sinks). `expires_at` = now + 48 h for
   non-scheduled whisper_links. The response is sent *before* three fire-and-forget
   jobs: `deliverWhisperLink`, `categorizeWhispAsync`, `moderateWhispAsync`.
   Recipient matching (`findVerifiedRecipient[ByEmail]`) persists
   `recipient_user_id` at insert time so signed-in recipients get a "Received" box.
2. **Deliver** — `lib/deliver.ts` sends the `/api/l/:token` link over the chosen
   channel; scheduled sends dispatch via `lib/scheduler.ts`; reminders via
   `lib/reminderScheduler.ts` (max 2; recipient can self-schedule
   1h/4h/1d via `POST /api/public/w/:token/remind-me`).
3. **View** — `/l/:token` (crawler-aware OG page → 302 to `/w/:token`) →
   `GET /api/public/w/:token`. `POST /api/public/w/:token/track` records
   `tracking_events` (`opened | clicked | watched_10s | watched_50pct |
   watched_complete`), sets `opened_at`/`watched_at`, notifies the sender, and
   triggers the AI takeaway. Expired whisps silently no-op.
4. **Reply** — see below.
5. **Expire** — links go stale after `WHISP_EXPIRATION_HOURS = 48`
   (`lib/expiration.ts`); uploaded bytes phase out separately (7-day retention).

Other notable columns: `deleted_by_sender_at` (soft delete; recipient link keeps
working), `removed_by_admin_at` (real takedown — public page 404s), per-role
pin/archive timestamps (flattened to `pinned`/`archived`/`viewerRole` by
`toWhispResponse`), `posted_by` ('user' | 'admin_agent'), `video_transcript`,
`ai_takeaway*`, `reply_credits_purchased`.

## Endpoints

`routes/whisps.ts` → `/api/whisps` (all Clerk-authed):

| Method | Path | Purpose |
|---|---|---|
| POST | `/note-suggestions` | AI note suggestions for the composer (rate-limited) |
| POST | `/concierge` | "Not sure what to send?" — matches Suggestions Library videos + drafts a note (`concierge_requests`) |
| GET | `/` | List whisps (`?box=sent\|received\|archived`, `?status=`) |
| POST | `/` | Create + send (the main compose endpoint, `createWhispLimiter`) |
| GET | `/stats` | Sender dashboard aggregates |
| GET | `/:id` | Detail: tracking, replies (marks read), remaining replies, circle engagement, DM threads |
| GET | `/:id/matches` | Ghost Boost aggregate reach (never per-subscriber) |
| DELETE | `/:id` | Sender soft delete |
| POST | `/:id/pin`, `/:id/archive` | Toggle for the caller's role (sender or matched recipient) |
| GET/POST | `/:id/replies` | Thread / sender follow-up (`fromRecipient` forced false) |
| PATCH | `/:id/replies/:replyId/guess-reaction` | Sender reacts to a "guess who sent it" reply |
| POST | `/:id/reveal` | Sender requests identity reveal |
| PATCH | `/:id/reveal` | **Unauthenticated** — recipient accepts/declines |

`routes/media.ts` → `/api/media`: `POST /upload` (multer, 30 MB video / 2 MB
thumbnail / ≤60 s, magic-byte format check), `GET /` (Media Library with per-item
`usageCount`), `DELETE /:id`, owner-only `GET /:id/file` and `/:id/thumbnail`.

`routes/video.ts` → `/api/video`: `POST /meta` (public) resolves a pasted URL to
title/thumbnail/platform/embed (`resolveVideoMeta`; 422 `video_private`/
`video_not_found`).

`routes/link.ts` → `/api/l/:token` (public): the actual shared URL. Known crawler
UAs get a server-rendered escaped OG/Twitter card; humans 302 to `/w/:token`.

Recipient endpoints in `routes/public.ts` (`/api/public`, unauthenticated):
`GET /w/:token`, `POST /w/:token/track|reply|appreciation|remind-me|
video-reply-request`, `GET /w/:token/media[/thumbnail]` (token-scoped — media is
never served by raw id to anonymous viewers).

## Video storage

Replit Object Storage (`@replit/object-storage`, no API key — bucket bound by a
Replit sidecar). Off-Replit, every call degrades gracefully (upload→false,
download→null). Keys: `uploads/<userId>/<mediaId>/video.<ext>` + `thumb.jpg`; the
`uploaded_videos` row stores keys only. No server-side transcoding; the thumbnail
is a client-side canvas frame grab. **Retention** (`mediaRetentionScheduler`,
hourly, batch 200): 7 days; owner warned by email + push 2 days ahead; at expiry
bytes are deleted and the row flips to `status='expired'` — the row itself is never
deleted, so stale references 410 instead of dangling. Scheduled sends with uploads
are capped at 5 days and re-checked at dispatch.

## Delivery channels & logging

Channels: email (Resend, SMTP fallback), SMS + WhatsApp (Twilio; WhatsApp requires
an approved Content Template), and in-app (persisted notification + Web Push).
Matched recipients get both in-app and the transport (email suppressed if opted
out). A `whisper_link` transport failure flips the whisp to `failed`.

Every attempt writes one `delivery_attempts` row (`lib/deliveryLog.ts`): channel,
purpose, to_address, success, provider message id/status, error. Logging never
throws. **Anti-enumeration:** creators always get their HTTP response before
delivery runs, so matched-vs-unmatched never leaks via timing.

## AI features

All Anthropic (`claude-haiku-4-5-20251001` via `@anthropic-ai/sdk`), fire-and-forget,
no-op without `ANTHROPIC_API_KEY`:

- **Takeaway** (`lib/aiTakeaway.ts`): 2–4 sentence recipient-facing reflection from
  the YouTube transcript (≤6000 chars, wrapped in tags with prompt-injection
  defenses). Claimed via conditional UPDATE (`ai_takeaway_status IS NULL` →
  `pending`) so the watch trigger and the 30-min sweeper (`takeawayScheduler`,
  whisps unwatched 6 h after delivery) never double-spend. Ends `ready` or
  `unavailable` (no retry).
- **Categorization** (`lib/categorize.ts`): deliberately NOT an LLM — a fixed
  15-key keyword taxonomy scored `titleHits*3 + transcriptHits`; top 3 written to
  `whisp_categories` (rank + score) or `uncategorized`. Feeds admin analytics and
  Ghost Boost matching. Group fan-outs share one transcript fetch.
- **Moderation** (`lib/moderation.ts`): four prompts (whisp/text-whisp = sexual
  content only; circle comment and debate topic add harassment/threats/hate;
  plus an image prompt) with one JSON verdict contract
  `{severity: none|low|medium|high, reason}`. Non-`none` verdicts persist a
  `moderation_flags` row; **nothing is auto-removed or auto-banned**.
  `maybeWarnUser` notifies the author exactly at 2 non-dismissed flags.
- **Note suggestions** and **concierge** round out the compose-side AI (both
  rate-limited).

## Reply system

Table `whisp_replies`: text ≤300, `from_recipient`, optional video columns,
`mood_tag`, `parent_reply_id` (flat quote reference, same-whisp constrained),
`read_at`, `notify_sender_at` / `sender_notified_at`.

- Recipient replies (`POST /api/public/w/:token/reply`, unauthenticated) validate
  any video URL against the `ALLOWED_HOSTS` allowlist (arbitrary hosts are an
  IP/geo leak). Cap check + insert run in one transaction with
  `SELECT … FOR UPDATE`. Success flips status to `replied`.
- **Read receipts** (`read_at`): set instantly when the other party loads the
  thread — WhatsApp-style, pull-based.
- **Deferred sender notifications:** the "you got a reply" email/push is delayed a
  random 3/5/9 minutes and dispatched by `replyNotificationScheduler` (60 s poll)
  — deliberately breaking the timing correlation that would out a sender whose
  phone buzzes next to the recipient. Read receipts are not deferred (no proximity
  signal).
- **Reply credits** (`lib/plans.ts`): `recipientFreeReplies()` reads
  `RECIPIENT_FREE_REPLIES` (default currently uncapped, pending the purchase
  flow); allowance = free + per-whisp `reply_credits_purchased`. Signed-in
  repliers are never capped. Cap hit → 403 `reply_limit_reached`; sender notified
  exactly once on the transition. Video replies gate separately
  (`canRecipientWhispVideoBack`); a blocked attempt records a one-time
  "wanted to whisp a video back" request via conditional update (unauthenticated
  endpoint pointed at the sender's inbox — must stay once-only).

## Guess who sent it (light gamification)

The recipient can flag a reply as a guess (`is_guess`, `POST
/api/public/w/:token/reply` body `isGuess: true`, requires text). **The system
never auto-checks a guess against the real sender** — that would be an
identity-enumeration oracle (try names one at a time, watch for "correct"),
the exact thing `toWhispResponse`'s `recipientUserId`-stripping exists to
prevent. Instead the sender manually picks a reaction on their own reply
(`PATCH /:id/replies/:replyId/guess-reaction`, one of `hot | cold |
no_comment | confirmed`, only valid on a row with `is_guess=true` and
`from_recipient=true`), stored on `guess_reaction`. Same trust model as
Reveal below: the platform relays a manual human decision, it never verifies
identity itself. A guess consumes a reply the same as any other reply (same
credit pool, same rate limiting) — no separate spam surface.

## Reveal & appreciation

Sender may request identity reveal (`reveal_requested`); recipient
accepts/declines via the public PATCH (response exposes only the reveal fields).
Recipients can answer an appreciation prompt (`appreciation_response` yes/no).

**Reveal countdown** (`components/shared/RevealCountdownDialog.tsx`): clicking
"Reveal Yourself" — here, on a Text Whisp (`TextWhispDetail.tsx`), and on an
Invite (`InvitePage.tsx`) — no longer fires the reveal-request immediately. It
opens a shared dialog that ticks down from 20s (an animated ring + "your
identity will be revealed in Xs"); the actual `POST .../reveal` call only
fires if the countdown reaches 0. A "Stop Reveal Now" button, Escape, or a
backdrop click all cancel identically — nothing has happened server-side
until the countdown completes, so there's nothing to undo either way. All
three backend `.../reveal` endpoints are unchanged: a single idempotent "set
revealRequested=true + notify the other party," which is what makes delaying
the call client-side safe.

## External touch points

YouTube watch/caption scraping (no API key), oEmbed (YouTube/Vimeo/TikTok/Twitter),
OpenGraph scraping for FB/IG. All outbound resolution is SSRF-guarded by the
`ALLOWED_HOSTS` / `ALLOWED_THUMBNAIL_DOMAINS` allowlists in `lib/videoMeta.ts`.
