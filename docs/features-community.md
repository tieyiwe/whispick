# Community: Blind Circles, Debate Now, Follows & Content Agents

## Cross-cutting design invariants

- Identity is never returned to viewers — only **roles** (`isPoster`) and
  pseudonymous handles. `authorUserId`/`visitorId` exist server-side for
  notification routing and ownership only.
- `visitorId` is a client-generated, localStorage-persisted per-device token
  (`lib/anonymousVisitor.ts`) — never returned to another viewer.
- Likes / reactions / rewhisps / follows all use the same model: a unique
  constraint making the toggle idempotent, with counts computed at read time
  (never denormalized).
- Author retraction (`deletedByAuthorAt`) and admin takedown (`removedByAdminAt`)
  are always separate timestamp columns; rows are soft-deleted, never erased, so
  moderation history survives.

## Blind Circles

Two things share the name:

- **Private Circles** — named groups (`circles`: owner + unique `inviteCode`;
  `circle_members`). Routes `/api/circles`: list mine, create (creator
  auto-joins), join by code, member-only `GET /:id/feed`.
- **Public Blind Circle feed** — account-free discovery feed:
  `GET /api/public/circle` (cursor-paginated, 20/page).

**A Circle post is a `whisps` row** with `deliveryMethod='circle_drop'`;
`circleId` null = public feed, non-null = that private circle. `postedBy`
distinguishes human posts from Circle Scout. The feed selects an explicit
no-identity column list (`CIRCLE_FEED_COLUMNS`).

**Engagement on a public post** (all on `/api/public/w/:token`, unauthenticated):
- Likes: `circle_post_likes`, unique `(whispId, visitorId)`, idempotent toggle.
- Comments: `circle_comments` (deliberately not `whisp_replies` — public vs
  private): text, flat `parentCommentId` quotes, `isPoster` role badge, optional
  image (5 MB, jpeg/png/webp/gif, magic-byte checked, proxied via
  `GET …/comments/:id/image`, 404 once flagged/removed; image moderation is
  async — posting never waits).
- Comment reactions: like/dislike via the shared `comment_reactions` table.
- Per-thread anonymous handle + rename (`PATCH /w/:token/handle`).
- **Circle DM**: `POST /w/:token/circle-dm/start` mints a NEW whisp row
  (`deliveryMethod='circle_dm'`, `originCircleWhispId`, fresh token, no expiry) —
  a private thread between the visitor and the original poster; one per visitor
  per post, token remembered in localStorage.

Anonymous commenting is capped at 3 per 24 h (`ANONYMOUS_COMMENT_LIMIT`,
`"unlimited"` disables; poster exempt on own post; signed-in never capped) →
403 `comment_limit_reached`.

## Debate Now (debate topics)

`debate_topics`: `topicText` ≤200 chars, `authorId` (never exposed — ownership
and byline resolution only), `postedBy` (`user | admin | admin_agent`).
Creation is authenticated + `createDebateTopicLimiter` (10/hr); every topic
(agent- and admin-authored included) passes `moderateDebateTopicAsync`.
Comments (`debate_topic_comments`, ≤500 chars) mirror circle comments exactly,
including images and the anonymous cap.

**Identity model — the key distinction:**
- `anonymous_handles` are scoped **per thread** (unique on
  `(contentType, rootId, visitorId)`) so the same visitor is a different handle
  in different threads — a handle can never become a cross-thread tracking
  token. Generated adjective+noun+digits ("SwiftFalcon482"); resolved by join at
  read time (rename updates history); renameable (`^[A-Za-z0-9]{3,24}$`,
  in-thread collision checked); carries a per-thread `avatarId`.
- `users.whispererHandle` (+ `whispererAvatarId`) is the **globally unique
  persistent** identity — the one deliberate exception, so topic bylines mean
  something and follows have a stable target. Lazily assigned on first topic or
  first signed-in comment; globally-unique rename;
  `userIdForWhispererHandle` is the only sanctioned handle→userId resolution.
- In a debate thread, signed-in comments render under the Whisperer handle
  (followable); anonymous ones under the per-thread handle. Circle threads use
  only per-thread handles.

**Avatars** (`lib/avatars.ts`): closed set of 24 preset ids
(`{flame, ghost, star, zap, moon, sun, feather, sparkles} × {violet, amber,
rose}`); **no upload path by design** — this identity must never carry a real
photo. `null` = explicit "no avatar" (falls back to the handle initial).

**Reactions** (`comment_reactions`): one table for both surfaces, discriminated
by `commentType`; unique per `(commentType, commentId, visitorId)`;
`toggleReaction` handles insert/switch/remove and returns
`{likeCount, dislikeCount, viewerReaction}`.

**Rewhisps** (`debate_topic_rewhisps`): retweet-equivalent, unique per
`(debateTopicId, visitorId)`, count-only. Debate-only.

**Whisper this topic** (`debate_topic_whisps`, `routes/debateTopicWhisps.ts`,
mounted at `/debate-topics`): sends a topic to one contact over
email/SMS/WhatsApp, anonymously — a real point-to-point send through the same
delivery primitives every whisp type uses (`findVerifiedRecipient(ByEmail)` +
`deliverInApp` for a matched account, `sendEmail`/`sendSms`/`sendWhatsApp`
otherwise; see `lib/deliver.ts`), not the plain native-share/copy-link `handleShareTopic` used to be. Deliberately its own small table
rather than living in `whisps.ts` (`videoUrl` is `NOT NULL` there) or growing
into a Text-Whisp-style mini-app — the destination is just the topic's own
already-public, already-anonymous-comment-capable page
(`/debate-topics/:id`), so there's no guest landing page or reply thread to
build. Open to any signed-in viewer, not only the topic's author. Both
channels are offered (unlike Invites, which are phone/email but never
in-app-matched, and Text Whisps, which are phone-only). `sendDebateTopicWhispLimiter`
caps it at 20/hr per sender. DebateTopicDetail.tsx's "Whisper this topic"
button opens `SendDebateTopicWhispDialog.tsx`, which also keeps the original
plain-link share/copy as a secondary option in the same dialog.

**Notifications** (only ever to real `authorUserId`, never self):
`debate_comment_reply`, `debate_topic_comment`, `debate_comment_reaction`, and
the `circle_*` equivalents.

**Endpoints** (`routes/debateTopics.ts`, no mount prefix — defines full paths):
authed `POST /api/debate-topics`, `DELETE /:id` (retraction),
`GET /following-feed`, `GET /my-stats`; public `GET /api/public/debate-topics`
(+ `/:id` detail with thread, rewhisp/follow/reaction state), comment/reaction/
rewhisp/handle/avatar POST/PATCH endpoints, comment image proxy.

**Reporting:** users can report topics/comments (reason + ≤300-word detail,
`content_reports`, 20/hr) — see [admin-hq.md](admin-hq.md) for the admin queue.
Community Guidelines page at `/community-guidelines`, linked inside Debate Now.

## Follow system

`follows` (unique `(followerUserId, followedUserId)`).
`POST /api/follows` toggles by **handle** (never raw userId);
`GET /api/follows/stats` returns own counts;
`GET /api/debate-topics/following-feed` shows topics by followed accounts.
Follow state on detail reads is tri-state (`null` = can't follow: anonymous
viewer or own content). Follows are wired into Debate Now only.

## AI content agents

Three agents, all `claude-haiku-4-5-20251001` + the `web_search_20250305` server
tool, singleton config/status rows, daily schedulers (enabled check inside the
sweep), run-now with `force: true` from admin, run results persisted to the DB
(`lastRunAt/lastRunOk/lastErrorMessage/lowCreditSuspected/consecutiveFailures`).
A run only counts as failed when *every* item fails (systemic problem);
`looksLikeLowCreditError` is a loose substring heuristic. Web search output is
declared untrusted data in every prompt. Missing `ANTHROPIC_API_KEY` = "not
attempted".

- **Debado** (debate agent, `debate_agent_settings`): generates ≤200-char
  debate prompts straight to the public feed (no approval queue). Default 3/day,
  themes rotated daily; news-flavored themes get web search restricted to
  apnews/reuters/bbc/npr; output cleaned + hard-truncated; 30-day dedupe.
  `postSingleDebateTopic` is shared with admin-typed topics (also moderated).
- **Circle Scout** (circle agent, `circle_agent_settings`): finds real public
  videos (search restricted to the `ALLOWED_HOSTS` platforms) and posts them to
  the public Circle feed. **Legal constraint: only ever embeds/links the
  original — never downloads or re-hosts.** Every URL re-validated through
  `resolveVideoMeta()` even when admin-pasted; 30-day URL dedupe.
- **Suggestion agent** (`suggestion_agent_status`, no config knobs — always on):
  discovers library candidates (3 categories × 2 videos daily) inserted as
  `status='pending'` / `source='ai_agent'` — **awaiting admin approval**, unlike
  the other two which post directly.

**System user** (`lib/systemUser.ts`): reserved account
(`clerkId "system:content-agent"`, name "Blind Whisper") owns agent-authored
content so it's never attributed to the admin who configured the agent. It has a
Whisperer identity so agent topics get a byline.

## Whisper Box (public pull-link)

The platform's one deliberately anonymous-**sender** surface, and its main
pull-growth mechanic: a signed-in user opts in (`users.whisperBoxEnabled`,
default **false**) and gets a public page at `/whisper-box/:whisperBoxHandle`
where literally anyone — no account, no sign-in — can send them one short
(≤500 char) anonymous message. Meant to be shared on a public bio link
(Instagram/TikTok/etc.), the same growth mechanic NGL/Sarahah/tbh used.

**Why it's opt-in and separate from just having a Debate Now handle:** a
`whispererHandle` is already assigned automatically the first time someone
posts or comments in Debate Now (`lib/whispererHandle.ts`). Without a
separate flag, everyone active in Debate Now would silently become
receivable by strangers the moment they got a handle. `whisperBoxEnabled`
is the only thing that turns the public page on.

**Two SEPARATE handles, deliberately never the same value**
(`lib/whispererHandle.ts`): `whispererHandle` stays a random,
non-identifying word-pair (`SwiftFalcon482`) — it has to, since Debate Now
is anonymous even to followers. `whisperBoxHandle` is the opposite case: the
whole point of Whisper Box is a friend recognizing the link, so it's derived
from the account's display name (`users.fullName`) when one is set —
`assignOrGetWhisperBoxHandle`/`assignWhisperBoxHandle` slugify it (strip to
`[A-Za-z0-9]`, cap at 20 chars), try the bare name first, then the name plus
a random 3-digit suffix on a collision — and falls back to the same
non-identifying random generator whispererHandle uses when there's no
display name yet, so the feature still works before that's captured. Once
assigned it's stable across enable/disable toggles (changing it would 404
any link already shared) — the only way it changes is the explicit
`POST /whisper-box/refresh-handle` (personalize-my-link) flow below.
`POST /whisper-box/enable` (Settings) assigns both handles in one call —
`whisperBoxHandle` from `fullName`, and `whispererHandle` lazily too, so
Debate Now stays ready — then flips the opt-in on; `POST /whisper-box/disable`
turns the page off without touching either handle.

**Personalize-my-link capture flow** (`WhisperBoxLinkDialog.tsx`, shared by
Settings' Whisper Box card and the Whisper Box inbox's "Get your link" /
Share-to-Story actions): if the account has no `fullName` yet, the dialog
asks for one first (skippable), `PATCH /user/profile`s it, then calls
`POST /whisper-box/refresh-handle` to regenerate `whisperBoxHandle` from it
before showing the QR/link — so a friend actually recognizes the handle by
the time it's shared, rather than getting the anonymous-style fallback.
Settings' own Full Name field carries a hint (`account.json`'s
`displayNameHandleHint`) saying as much.

**Backward compatibility**: `resolveWhisperBoxOwner()` (`routes/whisperBox.ts`,
exported for reuse) tries `whisperBoxHandle` first; on a miss it falls back
to the legacy `whispererHandle` resolution and — only if that account is
still `whisperBoxEnabled` and has no `whisperBoxHandle` of its own yet —
lazily migrates it onto one built from that same legacy value, so a link
shared before this split existed keeps resolving to the exact same URL
instead of 404ing.

**The core architectural inversion:** every other send path (Whisper Link,
Text Whisp, Whisper Group) requires the SENDER to be a signed-in,
accountable Whisperer. Here the sender has no account at all. Consequences,
all reflected in `whisper_box_messages.ts`'s schema:
- No `senderId` — nothing to warn or ban an author for; `moderateWhisperBoxMessageAsync`
  (`lib/moderation.ts`) can only ever lead to an admin taking the message
  down, never tracing it to anyone.
- No reply channel — nothing points back to the sender, unlike a Text
  Whisp's guest link. The recipient can only read and delete.
- `senderAlias` is purely decorative flavor text, same as elsewhere.

**Public endpoints** (`routes/whisperBox.ts`, own file, no router prefix —
defines both its public and authenticated paths, same pattern as
`debateTopics.ts`): `GET /public/whisper-box/:handle` (resolves a handle;
**identical 404** whether the handle doesn't exist or the box is off — never
distinguishes the two) and `POST /public/whisper-box/:handle` (the send;
constant `{ok:true}` response, no id leaked back — same anti-enumeration
posture as `POST /subscribe`). The send is IP-rate-limited
(`whisperBoxSendLimiter`, 12/hr) on top of the shared `publicEndpointLimiter`
the GET rides — a public bio link is a more attractive spam target than the
rest of the public surface.

**Authenticated inbox** (`/whisper-box`): list, unread count, mark-read,
delete (hard delete — no sender-side copy to preserve). Moderation flags
carry `contentType: 'whisper_box_message'`; admin takedown sets
`removedByAdminAt`, which the recipient's own inbox also excludes. The
inbox also has a "Find someone's Whisper Box" search bar
(`WhisperBoxSearchBar.tsx`) — normalizes an `@handle` and navigates straight
to `/whisper-box/:handle`, letting that page's own fetch resolve it rather
than duplicating a pre-check; the same bar appears on the public page's own
not-found state.

**Link preview** (`GET /wb/:handle`, `routes/whisperBoxLink.ts`, mounted
directly in `app.ts` at the bare `/wb` prefix — not under `/api` — so a
shared link reads as `blindwhisper.com/wb/handle`; see
`.replit-artifact/artifact.toml`, which registers `/wb` as this service's
own second top-level path alongside `/api`): the actual URL every share
action (Settings' Share/Copy,
Share-to-Story, `WhisperBoxLinkDialog`, the Story card's embedded QR)
constructs — `lib/whisperBoxUrl.ts`'s `whisperBoxShareUrl()` on the
frontend. Same pattern as `link.ts`'s `GET /l/:token` for whisp links: the
production frontend is static files with one `index.html` for every route,
so it can never show a crawler a per-account preview. A recognized
link-unfurling crawler UA gets a small server-rendered page with real Open
Graph tags (`WHISPER_BOX_HOOK_LINE` in `lib/copy.ts` as the description,
kept in sync by hand with `PublicWhisperBoxPage.tsx`'s own prompt line);
everyone else — and an unknown/disabled handle even to a crawler, so this
can't become an enumeration oracle — gets redirected straight to the real
`/whisper-box/:handle` page.

## Personal Recap (shareable stats)

`GET /user/recap?period=all_time|last_30_days` (`routes/user.ts`) — a
"Wrapped"-style personal stat card meant to be screenshotted and shared.
Only ever the caller's own real, honestly-computed numbers (no invented
percentile/"top X%" claims — there's no leaderboard infra to back that up):
`totalSent`, `totalReceived` (matched Whisper Link/Group deliveries only),
`repliesReceived`, `circlePosts`, `debateTopicsPosted`, `followerCount`
(never period-scoped — a running total), `whisperBoxMessagesReceived`
(`null` unless the box is enabled), `topCategory` (rank-1
`whisp_categories`, most frequent), `memberSince`, `whispererHandle`.

**Share to Story** (`lib/whisperBoxStoryCard.ts`, frontend-only, no backend
endpoint): generates a branded, Story-aspect-ratio (1080×1920) PNG client-side
via the raw Canvas 2D API — logo mark, handle, prompt line, QR code (the
`qrcode` package, already a dependency for admin 2FA) + the Whisper Box URL as
text. Shared via the Web Share API's file-sharing path
(`navigator.canShare({files})`) so it lands directly in the native share sheet
where Instagram/Snapchat/TikTok Stories appear as targets; falls back to
link-only share, then a plain browser download, on unsupported browsers.
Buttons live next to the existing copy-link share action in Settings' Whisper
Box card and in the Whisper Box inbox's empty state.

## Contact bulk-send onboarding ("first Whispers")

A `/onboarding/first-whispers` flow (frontend-only — reuses existing Whisper
Group + concierge endpoints, no new backend) surfaced as a dismissible
Dashboard card for accounts with zero sent whisps
(`FirstWhispersOnboardingCta.tsx`, dismiss state in `localStorage`, mirrors
`phoneVerificationDialog.ts`'s pattern). Three steps: (1) add up to 5 contacts
by hand or via the Contact Picker API where supported (Android Chrome only —
progressive enhancement, manual entry is the real path everywhere else); (2)
one-tap video pick from `POST /whisps/concierge`'s suggestions (custom
situation text re-runs it; pasting a URL is the fallback), (3) pick a channel
filtered to what the entered contacts actually support, then
`POST /whisper-groups` → `.../members` → `.../send` — a real, persistent
Whisper Group named "My First Whispers," same fan-out machinery as any manual
group send. Same `demographics_required` gate/retry pattern as `SendWhisp.tsx`.
Skipped contacts (missing the chosen channel's contact info) are reported back
on success, never silently dropped.

## Suggestions Library

`suggested_videos`: admin-curated third-party video links (never uploaded
bytes), with categories, `featured`, `status` (`pending | published |
archived`), `source` (`admin | ai_agent`), and an AI one-liner summary
(`aiSummary`, atomically claimed generation, ends `ready`/`unavailable`).
User-facing `GET /api/suggestions` (published only, category/featured filters) +
`GET /:id` feed the "Whisper this" forward flow and the concierge's matching
pool.

**Intelo** (`lib/suggestionAgent.ts`, surfaced on the `/admin_pro/suggestions`
page itself rather than its own nav entry) is the AI discovery agent behind
`source: 'ai_agent'` rows: rotates through `VIDEO_CATEGORIES` day-by-day,
asks Claude (with the `web_search` tool, results treated as untrusted data —
never instructions) for real video URLs per category, validates every one
through `resolveVideoMeta()`'s allowlist before inserting as `status:
'pending'` for admin review. Prompted to return a mix of short-form (under
~3 min — Shorts/Reels count) and longer videos rather than all one length,
and to actively draw from both YouTube and Facebook specifically, not just
whichever platform the search happens to settle on first.
