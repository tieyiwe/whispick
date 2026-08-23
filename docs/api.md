# API

Contract-first: `lib/api-spec/openapi.yaml` is the source of truth; frontend hooks
and server zod schemas are generated from it (see
[architecture.md](architecture.md)). Everything mounts under `/api`.
`app.ts` also mounts, before JSON parsing, the raw-body Stripe webhook
`POST /api/billing/webhook`, and ends with a JSON 404 catch-all + an error
handler that never echoes messages/stacks.

## Router mount map (`routes/index.ts`, in order)

| # | Mount | File | Notes |
|---|---|---|---|
| 1 | *(none)* | health.ts | `GET /api/healthz` |
| 2 | `/whisps` | whisps.ts | |
| 3 | `/video` | video.ts | public `POST /meta` |
| 4 | `/public` | publicEndpointLimiter | **limiter registered ONCE here** (60 req / 5 min, IP-keyed) — per-router mounting double-counted requests |
| 5–10 | `/public` | public.ts, circle.ts, subscribe.ts, publicInvites.ts, publicTextWhisps.ts, usageEvents.ts | |
| 11 | *(none)* | debateTopics.ts | defines `/debate-topics` AND `/public/debate-topics…`; must stay after #4 so its public routes hit the limiter |
| 11b | *(none)* | whisperBox.ts | defines `/public/whisper-box/:handle` AND authenticated `/whisper-box…`; same reasoning as debateTopics.ts, mounted right after it |
| 12 | `/follows` | follows.ts | includes `GET /follows/online-status` |
| 13 | *(none)* | contentReports.ts | `/content-reports` |
| 14 | `/circles` | circles.ts | |
| 15 | `/user` | user.ts | profile, notifications, phone verification, push subscription, policy status/accept |
| 16 | `/credits` | credits.ts | |
| 17 | `/billing` | billing.ts | checkout only; webhook in app.ts |
| 18 | `/l` | limiter + link.ts | shared-link OG/redirect |
| 19 | `/admin-mfa` | adminMfa.ts | **outside** requireAdmin on purpose — enrollment/unlock for a locked-out admin (own inline role check) |
| 20 | `/admin/access` | adminAccess.ts | **before** `/admin` so it terminates here |
| 21 | `/admin` | admin.ts | main admin router (per-prefix `requirePermission`) |
| 22 | `/admin` | adminDebateAgent.ts | `/admin/debate-agent/*` — middleware scoped to its prefix |
| 23 | `/admin` | adminCircleAgent.ts | `/admin/circle-agent/*` — same |
| 24 | `/admin` | adminProjects.ts | `/admin/projects*`, `/admin/tasks*` (permission `projects`) |
| 24b | `/admin/text-whisps` | adminTextWhisps.ts | broadcast + staff-direct sends (permission `notifications`); own distinct prefix, so its middleware is inherently scoped |
| 25 | `/whisper-groups` | whisperGroups.ts | `/sends` registered before `/:id` |
| 26 | `/media` | media.ts | |
| 27 | `/suggestions` | suggestions.ts | |
| 28 | `/invites` | invites.ts | |
| 29 | `/text-whisps` | textWhisps.ts | |

**Ordering-sensitive mounts (do not reorder):** the single `/public` limiter
registration; debateTopics after it; `/admin-mfa` outside requireAdmin;
`/admin/access` before `/admin`; whisper-groups `/sends` before `/:id`.
Routers sharing the `/admin` base must scope their middleware to their own
prefix (`router.use("/debate-agent", …)`) — an unscoped `router.use` runs on
every `/admin/*` fall-through and 403s unrelated areas.

## Auth layers

- **Public** endpoints: no auth, but `clerkMiddleware` runs globally, so a
  signed-in caller is still recognized (used for `isPoster`, comment caps).
  IP-keyed `publicEndpointLimiter`.
- **`requireAuth`**: Clerk bearer token → 401; banned → 403. Followed by
  `ensureUser` in essentially every handler.
- **`requireAdmin`**: role → TOTP enrollment (`admin_mfa_setup_required`) →
  `X-Admin-Mfa` unlock token (`admin_mfa_code_required`) → attaches admin
  context. Then **`requirePermission(key)`** per admin area
  (403 `admin_permission_required` + which key) and **`requireOwner`** for
  Staff & Access.

## Rate limiters (`lib/rateLimit.ts`)

User-keyed (auth id, falling back to IP), 1-hour windows unless noted:

| Limiter | Limit | Protects |
|---|---|---|
| publicEndpointLimiter | 60 / 5 min (IP) | all `/public/*`, `/l/*`, unauthenticated reveal PATCHes |
| createWhispLimiter | 30 | whisp creation (real sends) |
| createTextWhispLimiter | 30 | Text Whisps (only gate against phone spam) |
| createDebateTopicLimiter | 10 | topic posts |
| reportContentLimiter | 20 | content reports |
| textWhispRevealLimiter | 20 | the phone-match oracle |
| uploadLimiter | 20 | object-storage writes |
| noteSuggestionLimiter | 20 | AI note calls |
| conciergeLimiter | 15 | AI concierge |
| inviteLimiter | 20 | invite sends |
| phoneVerificationLimiter | 5 | Twilio Verify sends |
| confirmPhoneVerificationLimiter | 15 | OTP confirms |
| billingCheckoutLimiter | 20 | Stripe checkout sessions |
| whisperBoxSendLimiter | 12 | Whisper Box public sends (IP-keyed; a public bio link is a more attractive spam target than the rest of the public surface) |

## Endpoint inventories

Per-area endpoint tables live in the feature pages:
[features-whisps.md](features-whisps.md),
[features-text-whisps.md](features-text-whisps.md),
[features-community.md](features-community.md),
[admin-hq.md](admin-hq.md). The authoritative machine-readable list is
`lib/api-spec/openapi.yaml`.

## Billing endpoints

- `POST /api/billing/checkout` (`{kind: "credit_pack"|"plan", id}`): lazily
  creates the Stripe customer; credit packs are 403 while Ghost Boost is
  disabled; plans use subscription mode. Prices are hardcoded inline
  (`CREDIT_PACKS`: 1/$6.99 … 25/$99.99; `PLAN_PRICES`: spark $9.99, ember
  $19.99/mo). Redirects to `/credits?checkout=…`.
- `POST /api/billing/webhook` (raw body): `checkout.session.completed` grants
  credits / sets plan (+ one-time monthly credit grant), idempotent via unique
  `credit_transactions.stripePaymentIntentId` (holds the session id);
  `customer.subscription.deleted` downgrades to free. **Note: there is no
  recurring monthly re-grant of plan boost credits — grant happens once at
  checkout** (known gap).
- `GET /api/credits/transactions`: caller's ledger.

## Frontend route table (wouter, `App.tsx` — order matters, first match wins)

- **Entry/auth:** `/` (signed-in → `/dashboard`, else landing), `/sign-in/*`,
  `/sign-up/*`.
- **Authed:** `/dashboard`, `/send`, `/suggestions`, `/whisps[/:id]`, `/circle`,
  `/circles[/:id]`, `/whisper-groups[/sends/:groupSendId|/:id]`,
  `/media-library`, `/replies`, `/credits`, `/settings`,
  `/account/security/*`, `/invite`, `/debate-topics/new`,
  `/debate-topics/following`, `/send-text`, `/text-whisps[/:id]`.
- **Public:** `/debate-topics[/:id]`, `/w/:token`, `/tw/:token`,
  `/invite/:token`, `/privacy(-policy)`, `/terms(-and-conditions)`,
  `/sms-terms`, `/community-guidelines`, `/subscribe`, `/verify-subscription`,
  `/unsubscribe`, 404 fallback.
- **Admin:** `/admin_pro` + `/users[/:id]`, `/whisps[/:id]`, `/analytics`,
  `/projects`, `/suggestions`, `/moderation`, `/reports`, `/policies`,
  `/access`, `/notifications`, `/debate-agent`, `/circle-agent`, `/audit-log`.
