# Whispick

An anonymous video recommendation platform — paste a video URL, add a mood tag and optional note, then send it via Whisper Link (SMS/email) or Ghost Boost (social ads) without revealing your identity.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/whispick run dev` — run the frontend (port 22964)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth
- Optional env: `RESEND_API_KEY`, `EMAIL_FROM` — Whisper Link delivery + reply notification emails (skipped with a log warning if unset)
- Optional env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Credits & Plan checkout (returns 503 if unset)
- Optional env: `PUBLIC_APP_URL` — overrides the auto-detected frontend origin used in email links and Stripe redirect URLs
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
- Three delivery methods: `whisper_link` (real email via Resend, status goes straight to `delivered`), `ghost_boost` (internal credit-spend only — no live ad-platform API integration; status `pending` until a real integration exists), `circle_drop` (no recipient, visible in the public `/api/public/circle` community feed, status `delivered`)
- Stripe Checkout (redirect-based, no client-side Stripe.js) wired for credit packs (one-time) and plan upgrades (subscription); webhook at `/api/billing/webhook` grants credits/plan on `checkout.session.completed`
- Free plan is capped at 3 Whisper Links per rolling 30-day window (`lib/plans.ts`); Spark/Ember are unlimited

## Product

- **Send Whisp**: 6-step composer — paste URL → mood tag → anonymous note → delivery method → recipient → confirm
- **Dashboard**: stat cards (sent, open rate, watched, replies) + recent whisps + boost credit counter
- **My Whisps**: filterable list with status badges, thumbnails, mood tags
- **Whisp Detail**: delivery timeline, anonymous reply thread, follow-up send, reveal flow
- **Replies Inbox**: all whisps that received an anonymous reply
- **Circle**: community discovery feed of Circle Drop whisps — no recipient, organic browsing
- **Credits & Plan**: subscription tiers (Spark/Ember), Ghost Boost credit packs — real Stripe Checkout
- **Settings**: profile edit, account info, privacy policy
- **Public `/w/:token`**: recipient landing page — watch video, see mood/note, reply anonymously, accept/decline reveal (wired to the reveal-response API)
- Mobile: native-style bottom tab bar with a raised Send action, safe-area-aware header/footer padding throughout

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
