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

- **Town Crier** (debate agent, `debate_agent_settings`): generates ≤200-char
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

## Suggestions Library

`suggested_videos`: admin-curated third-party video links (never uploaded
bytes), with categories, `featured`, `status` (`pending | published |
archived`), `source` (`admin | ai_agent`), and an AI one-liner summary
(`aiSummary`, atomically claimed generation, ends `ready`/`unavailable`).
User-facing `GET /api/suggestions` (published only, category/featured filters) +
`GET /:id` feed the "Whisper this" forward flow and the concierge's matching
pool.
