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
- Optional env: `PUBLIC_APP_URL` — overrides the auto-detected frontend origin used in shared links and Stripe redirect URLs
- `pnpm --filter @workspace/api-server run test` — run the API server's Vitest suite (needs a reachable `DATABASE_URL`)

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
- `lib/db/src/schema/` — Drizzle schema files (users, whisps, whisp_replies, tracking_events, credit_transactions)
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

## Product

- **Send Whisp**: composer — paste URL → mood tag → anonymous note → delivery method (+ channel picker for Whisper Link: email/SMS/WhatsApp) → recipient (Whisper Link only) → confirm
- **Dashboard**: stat cards (sent, open rate, watched, replies) + recent whisps + boost credit counter
- **My Whisps**: filterable list with status badges, thumbnails, mood tags
- **Whisp Detail**: delivery timeline (sent/delivered/opened/clicked/watched/replied) driven by real tracking events, anonymous reply thread, follow-up send, reveal flow
- **Replies Inbox**: all whisps that received an anonymous reply
- **Circle**: community discovery feed of Circle Drop whisps — no recipient, organic browsing
- **Credits & Plan**: subscription tiers (Spark/Ember), Ghost Boost credit packs — real Stripe Checkout
- **Settings**: profile edit, account info, privacy policy
- **Public `/w/:token`**: recipient landing page — watch video, see mood/note, reply anonymously (quick-reply chips or free text), accept/decline reveal (wired to the reveal-response API); a confetti burst fires from the tap point right before playback starts (`VideoPlayer.tsx`)
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
