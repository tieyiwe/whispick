# Security & Auth

## User authentication — Replit-managed Clerk

- Clerk is provisioned by Replit's Auth integration (`sk_test`/`pk_test` keys in
  Replit secrets). The instance is **not visible in any Clerk dashboard** — it is
  managed through Replit, and it supports **no Clerk-side MFA**. This is why admin
  2FA is built in-house (below).
- Frontend attaches the Clerk session token as a bearer header via
  `lib/api-client-react/src/custom-fetch.ts`.
- Backend `lib/auth.ts` middleware verifies the token; `lib/ensureUser.ts` upserts
  the `users` row on each authenticated request.
- **Placeholder emails:** if Clerk's profile fetch fails, users historically got
  `<clerkId>@blindwhisper.com` emails. `isPlaceholderEmail(email, clerkId)` detects
  these; `ensureUser` self-heals them on sign-in (10-min per-user throttle), and the
  admin Users page has a bulk "Repair placeholder emails" backfill.
  `fetchClerkProfile` guards with optional chaining (`emailAddresses?.find`) — the
  original production bug was a TypeError here.
- In tests, auth is short-circuited by the `TEST_USER_HEADER` header (see setup.ts).
- **Scale note:** Clerk free tier covers 10k MAU. A future migration (e.g. to a
  dashboard-controlled Clerk instance or Supabase Auth) would keep users — they'd
  re-sign-in with Google and be relinked by email. Flagged for the pre-marketing
  launch checklist.

## Admin two-factor (in-house TOTP)

`lib/adminMfa.ts` — RFC 6238 TOTP on `node:crypto`, zero dependencies.

- Enrollment: secret generated server-side, shown as QR (qrcode npm pkg) +
  manual base32; verified with a first code; 8 one-time backup codes issued
  (stored as sha256 hashes).
- Secrets live in the dedicated **`admin_mfa`** table — deliberately not on the
  users row, so they can never leak through user serialization.
- Verification accepts ±1 time-step. Success mints an HMAC-SHA256 unlock token
  `userId.exp.sig` signed with `ADMIN_MFA_TOKEN_SECRET || CLERK_SECRET_KEY`,
  TTL 12 h, stored in sessionStorage (`bw_admin_mfa_token`) and sent as
  `X-Admin-Mfa` on every admin request (wired via `setExtraHeadersGetter`).
- `requireAdmin` (lib/adminAuth.ts) enforces, in order: role check → MFA enrollment
  (`admin_mfa_setup_required`) → valid unlock token (`admin_mfa_code_required`) →
  attaches `req.adminUser`, `req.adminPermissions`, `req.adminIsOwner`.
- Frontend `AdminRoute.tsx` renders the enroll (QR + backup codes, shown once) and
  unlock screens and proactively checks status.

## Admin authorization

See [admin-hq.md](admin-hq.md) for the full model. Summary: owner via
`ADMIN_EMAILS` (implicit all permissions); staff via `admin_grants`
(materialized permission arrays); `requirePermission(key)` per admin route prefix
(403 `admin_permission_required` + which permission); `requireOwner` for
Staff & Access management.

**The owner account itself is untouchable from the Users admin surface**
(`routes/admin.ts` PATCH/DELETE `/users/:id`): a collaborator holding the
`users` permission cannot ban, demote, or delete the `isOwner` account, and
role changes / bans on any other admin account require `req.adminIsOwner` —
otherwise a collaborator could mint or remove fellow admins outside the
Staff & Access grant system.

## Rate limiting

`lib/rateLimit.ts` defines per-user limiters. Known limits:
`createDebateTopicLimiter` 10/hr, `reportContentLimiter` 20/hr,
`createTextWhispLimiter` 30/hr, `adminMfaVerifyLimiter` 10/15min (others exist
per feature — check the file). Tests must use fresh random clerk IDs to avoid
cross-test 429 pollution; `adminMfaVerifyLimiter` additionally `skip`s under
`NODE_ENV === "test"` (vitest's default) because the test harness re-enrolls
and re-verifies a real TOTP code before every admin-gated test — far more
often than any legitimate admin unlocks in production.

## Online presence

`users.showOnlineStatus` (default `true`) is a single **reciprocal** toggle
(Settings → Privacy): turning it off both hides your own online status from
everyone and stops you from seeing anyone else's (`lib/presence.ts`'s
`presenceFor`). "Online" = active within the last 5 minutes
(`ONLINE_WINDOW_MS`).

**Deliberately NOT wired into Whisper Links or Text Whisps at all** — the
codebase enforces an absolute, unconditional rule that a whisp/text-whisp's
`recipientUserId` is never exposed to the sender via the API, not even after
an accepted Reveal. Computing "is the recipient online" from that id, in
either direction, would break that invariant and hand back exactly the live
proximity/timing signal `lib/replyNotificationScheduler.ts`'s randomized
reply-notification delay was built to hide (see that scheduler's own
anti-correlation note). Presence is visible **only** in Debate Now, between
a follower and an account they follow (`GET /follows/online-status`) — a
`whispererHandle` is a persistent, opt-in-followable pseudonym by design,
not an anonymity boundary, so surfacing presence there adds nothing an
attacker didn't already have. Don't extend presence to any anonymous thread
without re-reading this reasoning first.

## Privacy rules (product-level)

- Whisper Links (`/w/…`) and Text Whisp links (`/tw/…`) are capability URLs —
  possession grants access. Never log, index, or publish them.
- No absolute-anonymity promises in any user-facing copy or marketing.
- Usage analytics ingestion (`/api/public/usage-events`) accepts only normalized
  testid strings (regex-validated), optional Clerk attribution, and never calls
  ensureUser — it cannot create accounts or store free text.
- Public policy/consent state is per-version; drafts are never shown to users.

## Secrets / env vars (names only — values live in Replit secrets)

`DATABASE_URL` (dev DB in workspace; production DB is separate),
`CLERK_SECRET_KEY` / publishable key, `ADMIN_EMAILS`, `ADMIN_MFA_TOKEN_SECRET`
(optional, falls back to Clerk secret), `ANTHROPIC_API_KEY`, Stripe keys,
SMS provider credentials, object storage credentials. See
[operations.md](operations.md).
