# Database

PostgreSQL via Drizzle ORM. Schema lives in `lib/db/src/schema/` (one file per
domain, all exported from `index.ts`). Schema changes deploy with
`pnpm --filter @workspace/db run push` — **run against both the dev and the
production database** (see [operations.md](operations.md)).

Conventions: text UUID primary keys, `timestamptz` timestamps, soft-delete
timestamp columns instead of row deletion, drizzle-zod insert schemas exported
per table. New tables must also be added to the test truncate list in
`artifacts/api-server/src/__tests__/setup.ts`.

## Users & identity

| Table | Purpose |
|---|---|
| `users` | One row per account. Identity (id = Clerk user id, unique `clerkId`, unique `email` — placeholder form `<clerkId>@blindwhisper.com` is detected/healed, `fullName`, `avatarUrl`); two-tier phone trust (`phone` = unverified Clerk sync, `phoneVerifiedAt` = Twilio Verify OTP proof — only the pair proves ownership); demographics (`gender`, `ageRange`, `countryCode`); `preferredLanguage`; billing (`plan` free/spark/ember, `boostCredits`, `whisperLinksUsed` + `whisperLinksResetAt`, Stripe ids); `role` user/admin, `banned`; IP-geo at signup (`country/region/city`, admin analytics only); `lastSeenAt`; `emailNotificationsEnabled`; `showOnlineStatus` (default true, reciprocal presence toggle — see security-auth.md); `twoFactorEnabled` (nullable best-effort Clerk mirror, admin compliance signal only); `whisperBoxEnabled` (default false — the public pull-link opt-in, see features-community.md); anonymous public pseudonym (`whispererHandle` unique + `whispererAvatarId` — deliberately separate from the real `avatarUrl`, Debate Now/follows only); `whisperBoxHandle` (unique, SEPARATE from whispererHandle — display-name-derived when possible, so a friend recognizes it; see features-community.md's Whisper Box section for why these two handles must never share a value); `mfaNudgeDismissedAt` |
| `follows` | Follower/followed pairs, unique per pair; Debate Now only |
| `anonymous_handles` | Per-thread pseudonyms: unique `(contentType, rootId, visitorId)` + per-thread `avatarId` — never cross-thread trackable |

## Whisps & media

| Table | Purpose |
|---|---|
| `whisps` | The core content row for video whisps AND circle posts AND circle DMs (`delivery_method`: whisper_link / group_whisper / ghost_boost / circle_drop / circle_dm). Status machine, `public_token` (unique capability token), video fields (always server-derived), note/alias/mood, recipient matching (`recipient_user_id`), scheduling, expiry, per-role pin/archive, soft-delete + admin takedown, AI takeaway fields, `posted_by`, reply credits, group fan-out ids |
| `whisp_replies` | Private whisp thread: `from_recipient`, optional video, flat quote `parent_reply_id`, `read_at` receipts, deferred sender-notification stamps, `is_guess`/`guess_reaction` (sender-only manual reaction to a "guess who sent it" reply — never an automated identity check, see features-whisps.md) |
| `whisp_categories` | Keyword-taxonomy categorization results (top 3, rank + score) |
| `uploaded_videos` | Media Library rows: object-storage keys only, `status` (ready/deleted/expired), 7-day retention stamps. Rows are never deleted (stale refs 410) |
| `tracking_events` | Public-page events per whisp (opened/clicked/watched_*) |
| `delivery_attempts` | One row per outbound send attempt (channel, purpose, to, success, provider id/status, error) |
| `moderation_flags` | AI moderation verdicts (severity + reason); author warned at exactly 2 non-dismissed flags |

## Text Whisps

| Table | Purpose |
|---|---|
| `text_whisps` | Text-only anonymous messages by phone: `recipientPhone` (E.164) + nullable `recipientUserId` (verified match at send time only), `publicToken`, status scheduled/sent/read/replied, `scheduledAt`, typing indicator columns, reveal handshake, sender soft delete, `source` ('user' default \| 'admin' — admin broadcast/staff-direct sends, always in-app-only) |
| `text_whisp_replies` | Authenticated two-party thread: `senderId`, quote `parentReplyId`, `readAt` receipts |

## Community

| Table | Purpose |
|---|---|
| `circles` / `circle_members` | Private circles: owner + unique invite code; membership |
| `circle_comments` | Public comments on circle posts: visitorId, flat quotes, `isPoster` role, `authorUserId` (routing only), optional moderated image, admin takedown |
| `circle_post_likes` | Idempotent likes, unique `(whispId, visitorId)` |
| `debate_topics` | Debate Now topics ≤200 chars: `authorId` (never exposed), retraction + takedown timestamps, `postedBy` |
| `debate_topic_comments` | Same shape as circle_comments, per topic |
| `debate_topic_rewhisps` | Retweet-equivalent, unique `(topicId, visitorId)`, count-only |
| `comment_reactions` | Like/dislike for BOTH comment surfaces, discriminated by `commentType`, unique per visitor |
| `content_reports` | Community reports: target ref, reason (priority-mapped), ≤300-word detail, status, admin handling |
| `suggested_videos` | Curated Suggestions Library links: categories, featured, status pending/published/archived, source admin/ai_agent, AI summary fields |
| `suggestion_agent_status` | Singleton status row for the discovery agent |
| `whisper_box_messages` | Anonymous inbound messages via a user's public Whisper Box link: `recipientUserId`, `messageText` (≤500), `senderAlias` (decorative only), status unread/read, `removedByAdminAt`. Deliberately no `senderId` — no account, no way to trace or warn an author |
| `debate_agent_settings` / `circle_agent_settings` | Singleton config+status for Debado / Circle Scout (enabled, dailyPostCount, topics, run health) |

## Growth & delivery

| Table | Purpose |
|---|---|
| `invites` | Anonymous invite-a-friend: channel, `publicToken`, status sent/failed/joined, push-only claim attribution (`signedUpUserId`), reveal handshake |
| `whisper_groups` / `whisper_group_members` | Sender-owned address books (plain contacts, not accounts); ≤500 members, fan-out sends tied by `groupSendId` on whisps |
| `match_subscribers` | Ghost Boost audience: unique lowercased email, category array, single verify/unsubscribe token, `verifiedAt`/`unsubscribedAt`/`lastMatchedAt` |
| `push_subscriptions` | Web Push endpoints per browser (unique endpoint, VAPID keys p256dh/auth) |
| `notifications` / `notification_reads` | In-app notifications (null target = broadcast; `kind` — "reply" drives the badge) + per-user read state |
| `concierge_requests` | "Not sure what to send?" runs: situation, matched categories, suggested video ids, note draft |
| `credit_transactions` | Boost-credit ledger (purchase/spend/refund/plan_grant); `stripePaymentIntentId` unique = webhook idempotency key |

## Admin HQ

| Table | Purpose |
|---|---|
| `admin_mfa` | In-house TOTP secrets + hashed backup codes — its own table so secrets can never leak via user serialization |
| `admin_grants` | Staff access: lowercased email key, roleTitle, materialized permissions array, `userId`/`linkedAt` once the account links |
| `admin_audit_log` | Sensitive admin actions (who/what/target) |
| `policy_versions` / `policy_acceptances` | Policy re-consent: draft→publish immutable versions per docType; unique (user, version) acceptances |
| `feature_events` | Aggregated click analytics (normalized data-testid counts) |
| `hq_projects` / `hq_tasks` / `hq_task_comments` | Internal projects/tasks workspace: task status todo/in_progress/done (+`completedAt`), assignee, due date, comment threads |
