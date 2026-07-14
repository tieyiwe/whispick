# Whispick

An anonymous video recommendation platform — paste a video URL, add a mood tag and optional note, then send it to a known person via Whisper Link (guaranteed anonymous delivery), post it to Circle for organic community discovery, or queue it as a Ghost Boost for wider, best-effort reach — without revealing your identity.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/whispick run dev` — run the frontend (port 22964)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth
- Optional env: `RESEND_API_KEY`, `EMAIL_FROM` — Whisper Link email channel + reply notification emails (skipped with a log warning if unset)
- Optional env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — Whisper Link SMS channel (skipped with a log warning if unset)
- Optional env: `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_CONTENT_SID` — Whisper Link WhatsApp channel. Requires a Twilio-enabled WhatsApp sender AND a Meta-approved Content Template with a single `{{1}}` variable for the link (build it in the Twilio Console's Content Template Builder) — WhatsApp business-initiated messages can't use free-form text for a first contact. Skipped with a log warning if unset.
- Optional env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Credits & Plan checkout (returns 503 if unset)
- Optional env: `PUBLIC_APP_URL` — overrides the auto-detected frontend origin used in shared links and Stripe redirect URLs; **required** (not just recommended) for Scheduled Sending, since the background dispatcher has no per-request Host header to derive it from — a scheduled whisp is left queued with a warning log if this is unset when it comes due
- Optional env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address) — Web Push notifications to senders when their whisp is opened/watched/replied to. Generate a keypair with `pnpm dlx web-push generate-vapid-keys`. Skipped with a log warning if unset; `GET /api/user/push-public-key` returns 503 until configured.
- `pnpm --filter @workspace/api-server run test` — run the API server's Vitest suite (needs a reachable `DATABASE_URL`)
- After pulling schema changes, run `pnpm --filter @workspace/db run push` again — this round added the `circles`, `circle_members`, and `push_subscriptions` tables plus new columns on `whisps`/`whisp_replies`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7 + Tailwind CSS 4
- Auth: Clerk (`@clerk/react`, `@clerk/express`)
- API: Express 5 + Zod validation (not `zod/v4` — use plain `zod`)
- DB: PostgreSQL + Drizzle ORM
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle schema files (users, whisps, whisp_replies, tracking_events, credit_transactions, circles, push_subscriptions)
- `artifacts/whispick/src/index.css` — design tokens (Midnight bg, Whispick Glow primary, Ember accent)
- `artifacts/api-server/src/routes/` — Express route handlers
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks (do not edit)

## Architecture decisions

- Contract-first: all API changes go in `openapi.yaml` → `codegen` → generated hooks/zod schemas
- Dark mode only — no light mode variants needed
- Zod schemas in routes must import from `"zod"` not `"zod/v4"` (catalog pin is ^3.25.76)
- Public whisp pages (`/w/:token`) are unauthenticated; everything else requires Clerk
- Three delivery methods: `whisper_link` (requires a known recipient, status goes straight to `delivered` — this is the only method that guarantees delivery to one specific person), `ghost_boost` (internal credit-spend/queue only, no recipient collected — no live ad-platform API integration; status `pending` until a real integration exists), `circle_drop` (no recipient, visible in the public `/api/public/circle` community feed, status `delivered`)
- Whisper Link has three channels (`whisperChannel` on the whisp: `email` | `sms` | `whatsapp`), chosen by the sender in the composer. Email uses Resend, SMS/WhatsApp use Twilio (`lib/sms.ts`) — all three are optional-config-gated the same way (log a warning and no-op if unset, the whisp still gets created).
- Shared links go through `/api/l/:token` (`routes/link.ts`), not straight to `/w/:token`. In production the frontend is served as static files with an SPA rewrite (`artifact.toml`: `/* → /index.html`), so it can never return different Open Graph tags per whisp to a link-preview crawler — `/api/l/:token` is a real server route that detects known crawler user agents (WhatsApp, iMessage-adjacent bots, Slack, Twitter, etc.) and serves a per-video OG card (title/thumbnail/hook line), then redirects everyone else straight to the real `/w/:token` SPA page.
- The recipient-facing hook line ("Someone who cares about you thought you needed to see this 👀") is defined once in `lib/copy.ts` (`HOOK_LINE`) and reused in the email, SMS, WhatsApp template variable, and OG description — keep `PublicWhispPage.tsx`'s lead text in sync by hand, since frontend and backend don't share a constants module.
- **Ghost Boost is deliberately not a real Meta/TikTok ad integration.** Those platforms enforce a minimum matched-audience size before a Custom Audience can be used for targeting, so there's no way to guarantee an ad reaches one specific identified person — and building a "target this one known person" ad system runs directly into their anti-harassment ad policies. Whisper Link is the mechanism that actually satisfies "reach a known person anonymously"; don't reintroduce Ghost Boost as a literal ad-placement feature without solving that mismatch first.
- Watch tracking: YouTube/Vimeo videos are embedded in the public whisp page (`videoEmbedUrl`, computed in `video.ts`'s `buildEmbedUrl`) and report real `watched_10s`/`watched_50pct`/`watched_complete` events via each platform's JS Player API (`VideoPlayer.tsx`). Every other platform (TikTok/Instagram/Facebook/etc.) has no embeddable player with progress events, so only `opened`/`clicked` are tracked and the recipient is redirected out.
- Stripe Checkout (redirect-based, no client-side Stripe.js) wired for credit packs (one-time) and plan upgrades (subscription); webhook at `/api/billing/webhook` grants credits/plan on `checkout.session.completed`, keyed by the Stripe checkout session id (`stripePaymentIntentId` on `credit_transactions`) so a retried webhook delivery can't double-credit
- Free plan is capped at 3 Whisper Links per rolling 30-day window (`lib/plans.ts`); Spark/Ember are unlimited
- Security posture (see `lib/rateLimit.ts`, `app.ts`, `routes/video.ts`): CORS only allows the app's own origin (same Host as the request, or an explicit `PUBLIC_APP_URL`/dev-port allowlist) — never reflects arbitrary origins, since Clerk auth is cookie-based. `/api/video/meta` only fetches URLs on an allowlisted set of video-platform hostnames (checked via `new URL().hostname`, not substring matching) to prevent SSRF against internal services. The unauthenticated public endpoints (`/api/public/*`, `/api/l/:token`) are rate-limited per IP since each triggers a real side effect (DB write, and for `/reply` an email to the sender). `PATCH /whisps/:id/reveal` (called by the unauthenticated recipient) only ever returns `{id, revealRequested, revealAccepted}` — never the full whisp row — and requires `revealRequested` to already be true.
- **Scheduled sending**: a `whisp` with a future `scheduledAt` is created with `status: "scheduled"` instead of being delivered immediately (`lib/deliver.ts` holds the shared "actually send it" logic used by both the immediate path and the scheduler). `lib/scheduler.ts`'s `startScheduledWhispDispatcher()` polls every 60s for due whisps and delivers them via the same code path, then flips status to `delivered`. Ghost Boost ignores `scheduledAt` — it's always queued as `pending` since it isn't a direct-delivery method.
- **Timestamp bookmarking**: `videoStartSeconds` on a whisp seeks the embedded YouTube/Vimeo player to that point on play (`VideoPlayer.tsx` — a `&start=` URL param for YouTube, `player.setCurrentTime()` for Vimeo). No-op for non-embeddable platforms, which just open the raw URL.
- **Whisp-back**: the public reply endpoint (`POST /api/public/w/:token/reply`) accepts an optional video (scraped via the same `/api/video/meta` the sender's composer uses) alongside or instead of text — `replyText` is nullable at the API layer but stored as `""` in the DB (which keeps that column `NOT NULL`); a reply must have text, a video, or both.
- **Private Circles**: `circles`/`circle_members` tables gate a Circle Drop whisp's `circleId` to members-only — dropping into a circle you don't belong to is a 403, and a circle's private feed (`GET /api/circles/:id/feed`) is member-gated the same way. Circle Drop whisps with a `circleId` are deliberately excluded from the public `/api/public/circle` feed (`and(..., isNull(circleId), ...)` in `routes/circle.ts`) so a private drop never leaks into public discovery.
- **Push notifications**: `lib/push.ts`'s `notifyUser()` sends a Web Push message (via the `web-push` package and the `push_subscriptions` table) when a whisp is opened, watched to completion, or replied to; dead subscriptions (404/410 from the push service) are pruned automatically. The frontend registers `public/sw.js` and subscribes through `src/lib/push.ts`, toggled from the Settings page.

## Product

- **Send Whisp**: composer — paste URL → mood tag (+ optional "start the video at mm:ss" timestamp) → anonymous note → delivery method (+ channel picker for Whisper Link: email/SMS/WhatsApp, or a circle picker for Circle Drop: public feed vs. a private circle) → optional "Schedule for later" toggle + datetime → recipient (Whisper Link only) → confirm
- **Dashboard**: stat cards (sent, open rate, watched, replies) + recent whisps + boost credit counter
- **My Whisps**: filterable list (now including a `scheduled` status filter) with status badges, thumbnails, mood tags
- **Whisp Detail**: delivery timeline (sent/delivered/opened/clicked/watched/replied) driven by real tracking events, anonymous reply thread (text and/or a "whisp-back" video), follow-up send, reveal flow, scheduled-send date shown when applicable
- **Replies Inbox**: all whisps that received an anonymous reply
- **Circle**: public community discovery feed of Circle Drop whisps — no recipient, organic browsing
- **My Circles**: invite-only private circles — create one, join with an invite code, and view a circle's own private feed at `/circles/:id`; Send Whisp's Circle Drop step can target a specific circle instead of the public feed
- **Credits & Plan**: subscription tiers (Spark/Ember), Ghost Boost credit packs — real Stripe Checkout
- **Settings**: profile edit, account info, push notification opt-in/out, privacy policy
- **Public `/w/:token`**: recipient landing page — watch video (optionally starting at the sender's chosen timestamp), see mood/note, reply anonymously (quick-reply chips, free text, and/or whisp a video back), accept/decline reveal; a confetti burst fires from the tap point right before playback starts (`VideoPlayer.tsx`)
- Mobile: native-style bottom tab bar with a raised Send action, safe-area-aware header/footer padding throughout, no browser-native `confirm()`/`alert()` dialogs (destructive actions use the in-app `AlertDialog`), tap-highlight and overscroll bounce disabled globally

## User preferences

- Design: dark only, Midnight #0D0D1A bg, Whispick Glow #7C5CFC primary, Ember #FF6B6B accent
- Fonts: Playfair Display (headings/serif), Inter (body/sans)
- All buttons use `rounded-full` pill shape
- Glow effect on key CTAs: `shadow-[0_0_15px_rgba(124,92,252,0.3)]`

## Gotchas

- Always import `zod` not `zod/v4` in server route files
- CSS: Google Fonts `@import url(...)` must be the FIRST line in `index.css` (before tailwindcss import)
- `@clerk/themes` is a separate devDependency in `@workspace/whispick` — not bundled with `@clerk/react`
- API server runs on port 8080, proxied at `/api` via artifact.toml
- Run `pnpm --filter @workspace/api-spec run codegen` after any change to `openapi.yaml`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
