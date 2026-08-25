# Admin HQ

The admin panel lives at **`/admin_pro`** (deliberately not `/admin` — the old path 404s
on purpose, for obscurity; there is no redirect). It is designed as the owner's command
center: Odoo-style grouped left rail, charcoal/violet-grey/matte-yellow theme, and every
business function in one place. The admin UI is English-only by convention.

## Shell & theme

- `components/layout/AdminLayout.tsx` — the HQ shell. Nav groups: **Business**
  (Overview, Analytics, Projects), **Community** (Users, Moderation, Reports),
  **Content** (Whisps, Suggestions, Town Crier, Circle Scout), **Outreach**
  (Notifications, Policies), **System** (Audit Log, BugRabbit, Staff & Access).
- Nav items carry `permission` / `ownerOnly` and are filtered by
  `useGetMyAdminAccess`; collaborators landing on `/admin_pro` without the
  `analytics` permission are redirected to their first permitted page.
- Theme: `.admin-theme` CSS token override block in `index.css`
  (charcoal `255 12% 7%`, violet-grey cards `255 10% 13%`, matte yellow primary
  `46 64% 62%`). The class is applied to both the layout root **and**
  `document.body` (Radix portals render into body).
- The shell is viewport-height with **only `<main>` scrolling**, so the header
  and left rail stay static. Don't switch the rail to `position: sticky` —
  `overflow-x: hidden` on html/body (index.css) defeats sticky positioning.
- **Ghost Boost is hidden from the admin UI while the feature is paused**
  (no credits column/editor, no ledger card, no delivery-method filter option,
  no analytics rows). Backend fields (`users.boostCredits`,
  `credit_transactions`) are untouched — restoring the feature is a UI change.

## Access model (three layers)

1. **Role** — `users.role = 'admin'` (or the bootstrap owner). Checked first.
2. **Admin 2FA** — in-house TOTP; every admin request needs a valid `X-Admin-Mfa`
   unlock token (see [security-auth.md](security-auth.md)).
3. **Permission** — per-area grants from `admin_grants`, enforced by
   `requirePermission(key)` middleware per route prefix.

The **owner** (super admin) is whoever matches `ADMIN_EMAILS`
(`isBootstrapAdminEmail`) — implicitly holds all permissions and is the only one who
can manage Staff & Access.

Permission keys (`ALL_ADMIN_PERMISSIONS` in `lib/adminAuth.ts`):
`users, whisps, moderation, reports, suggestions, agents, notifications, policies,
analytics, audit_log, projects, bugrabbit`.

Role presets (`ROLE_PRESETS`): Admin (all), Content Manager (agents, suggestions,
whisps, projects), Moderator (moderation, reports, projects), Assistant
(notifications, policies, analytics, projects), Contributor (suggestions, projects).
Presets are starting points — grants store a materialized permission array and
enforcement reads **only** that array, never the role title.

## Staff & Access (`/admin_pro/access`, owner-only)

Backend `routes/adminAccess.ts` (mounted at `/admin/access` **before** the main admin
router). Invite a collaborator by email with a role title + permission set:

- If the user already exists, they are promoted to `role='admin'` immediately and the
  grant is linked (`grant.userId`, `linkedAt`).
- If not, the grant waits; `ensureUser.maybeApplyAdminGrant` applies it automatically
  on their first sign-in with that email (grants are keyed by lowercased email).
- Editing a grant rescopes live (next admin request). Revoking demotes the account
  back to `role='user'` (never the owner).
- Each staff member enrolls their own TOTP authenticator on first admin access.

## Reports queue (`/admin_pro/reports`)

Community reporting for Debate Now content (`content_reports` table). Reports carry a
reason (inappropriate, sexual, child abuse, threat, …) + optional 300-word detail, and
are auto-prioritized by reason severity. Admin tools: priority-ordered queue,
categorized views, status updates, **warn the author** and **reply to the reporter**
(so reporters learn the outcome). Users file reports via the report dialog on debate
topics/comments (rate-limited: 20/hr).

## Policies (`/admin_pro/policies`)

Policy re-consent system (`policy_versions` + `policy_acceptances`):

- Draft a new Privacy Policy or Terms version in admin, then **Publish** (immutable
  after publish). Only the **latest published** version per docType requires consent.
- `PolicyUpdateGate` (frontend, mounted app-wide) polls every 5 min + on window focus;
  when a user hasn't accepted the latest version it shows an animated red-glow prompt
  (`.policy-pulse`, static under `prefers-reduced-motion`). "Review later" collapses it
  to a pinned pulsing pill. Accepting records a row in `policy_acceptances`
  (unique user+version). Localized in all 8 languages (`sharedA.json → policyUpdate.*`).

## Notifications / comms (`/admin_pro/notifications`)

Admin → user messaging. Sends persisted in-app notifications and, optionally, **email**
(toggle). Email sends skip opted-out, banned, and placeholder-email accounts; the
result reports `emailsSent` / `emailsSkipped`.

## Analytics (`/admin_pro/analytics` + Overview)

- Platform stats + **feature usage analytics**: the frontend
  (`lib/featureUsage.ts`) captures every click on elements with a `data-testid`
  (capture-phase listener; uuids/digit-runs normalized to `*`), batches ≤50 events
  every 20 s to public `/api/public/usage-events`, stored in `feature_events`.
  Admin sees most-used / least-used features — for trimming clutter later.
- **Traffic by hour**: `GET /admin/analytics/traffic-by-hour` sums
  `feature_events.count` (not row count — one row can represent many clicks)
  into a 24-bucket UTC histogram over a configurable window, for a "when is
  the app actually used" chart alongside the peak-hour text insight
  `lib/insights.ts` already surfaces.
- **Online now**: `GET /admin/users/online-now` — a platform-wide headcount
  of accounts active in the last 5 minutes. This aggregate is visible to
  admins regardless of any individual's presence-visibility toggle (see
  below) — that toggle governs what OTHER USERS can see about one person,
  not the platform operators' own aggregate view.
- **AI insights**: `lib/usageInsights.ts` sends aggregated stats to Anthropic
  (`claude-haiku-4-5-20251001`) and returns practical product insights
  (JSON contract with raw-text fallback).
- Users page shows accurate **last seen** (`users.lastSeenAt`, polled live)
  and has a "Repair placeholder emails" backfill button.

## Projects & Tasks (`/admin_pro/projects`)

Internal collaboration workspace (permission `projects`, included in every preset).
Tables `hq_projects`, `hq_tasks`, `hq_task_comments`; routes in
`routes/adminProjects.ts` (`/api/admin/projects`, `/api/admin/tasks/…`).

- Projects hold tasks; tasks have status (`todo → in_progress → done`, done stamps
  `completedAt`), an assignee (any staff member; owner listed as "Super Admin"),
  a due date, and a comment thread.
- Assigning a task or commenting on it notifies the assignee in-app
  (notification kind `hq_task`), never self-notifying.
- Projects can be archived; deleting a task cascades its comments.
- UI: project cards grid → three-column board with quick-add row, status advance
  button, per-task comments dialog.

## Audit log (`/admin_pro/audit-log`)

`admin_audit_log` table + `logAdminAction` — sensitive admin actions are recorded
(who, what, target) and browsable, filterable by admin and target type
(`listAdminAuditLog`). Coverage includes: user role/plan/ban changes and
deletion, whisp deletion, moderation flag review (dismiss/undismiss) and
takedown, content report updates, admin notification/announcement sends,
compliance reminder sends, HQ project archiving and task deletion, access
grant create/update/revoke, policy draft/discard/publish, profile-repair
sweeps, usage-insight runs, and content-agent config changes/manual posts —
plus every admin **login**: each successful MFA unlock (`admin_mfa.unlock`,
distinct from one-time `admin_mfa.enroll`) is logged with the method used
(TOTP vs. backup code), so "who accessed the HQ and when" is answerable
alongside "what they did once inside."

## BugRabbit (`/admin_pro/bug-rabbit`)

In-house, Sentry-shaped error tracker (permission `bugrabbit`, not in any
preset by default — the owner grants it explicitly). Tables `bug_issues`
(one row per distinct bug) and `bug_occurrences` (one row per time it
actually happened, capped at `MAX_STORED_OCCURRENCES` — 20 — per issue so a
hot error loop can't grow the table unbounded; `occurrenceCount`/
`lastSeenAt` on the issue keep counting past that cap regardless). Core
logic in `lib/bugRabbit.ts` (fingerprinting + the upsert) and
`lib/piiScrub.ts` (redacts emails/phone-shaped digit runs/JWTs/known
secret-key prefixes from every message/stack/url before it's ever stored —
the only writer, so no call site can skip it); routes in
`routes/adminBugRabbit.ts` (`/api/admin/bug-rabbit/issues`).

- **Capture**: frontend `window.onerror`/`unhandledrejection`
  (`lib/bugRabbitCapture.ts`, imported for its side effect in `App.tsx`,
  live from first script evaluation) and `AppErrorBoundary`'s
  `componentDidCatch` (skipping the stale-chunk-reload case, which isn't a
  real bug to fix) POST to public `POST /api/public/bug-reports` — anonymous
  allowed, since a crash can happen before sign-in resolves. The backend's
  own terminal Express error handler (`app.ts`) records every unhandled
  exception the same way, in-process.
- **Grouping**: `fingerprintFor()` normalizes digits/quoted-strings out of
  the message and drops `:line:col` off the top few stack frames before
  hashing, so the same bug across different inputs/builds collapses into
  one issue instead of flooding the queue.
- **Rate limiting**: `bugReportLimiter` is its own dedicated instance (not
  the shared `publicEndpointLimiter` budget) so a client-side crash loop
  only ever costs itself, never other public traffic from the same IP. The
  frontend capture hook also self-throttles per fingerprint client-side.
- UI: filter by unresolved/resolved/all, sort by recency or frequency, click
  a row to expand its recent occurrences (stack, url, user, timestamp).
  Resolve/reopen is audited (`bug_issue.resolve` / `bug_issue.reopen`).

## Users: compliance dashboard & reminders

`GET /admin/users` returns a `compliance` object per row
(`lib/compliance.ts`'s `complianceFlagsFor`): `emailVerified` (not a
placeholder address), `phoneVerified` (`phoneVerifiedAt` set),
`mfaEnabled` (best-effort mirror of Clerk's `twoFactorEnabled` — see
below; `null` means never synced), and `policyUpToDate` (accepted the
latest published version of every policy doc type). Also an `online`
flag (active within the last 5 minutes) and, via
`GET /admin/users/online-now`, a platform-wide online headcount for the
Analytics tile.

A `?compliance=` filter (`mfa_missing | policy_pending | email_unverified |
phone_unverified`) narrows the list to accounts needing that one thing —
computed in application code (not SQL) over a capped scan window, since
compliance is derived from a join plus a Clerk mirror rather than a plain
column.

`POST /admin/users/compliance-reminder` (`{userIds, kind}`) sends a
pre-written persisted notification + email nudge for one compliance kind,
to one user or many — the same delivery shape as the Notifications
composer, just pre-authored per kind instead of admin-typed. Used for both
the single-user "Send reminder" action and a bulk send from a filtered/
selected list.

**`users.twoFactorEnabled`** is a best-effort mirror of Clerk's own
`user.twoFactorEnabled`, synced opportunistically in `ensureUser` on a
24-hour per-user throttle (separate from the tighter 10-minute
placeholder-email heal). Never used for any access-control decision —
Clerk itself remains the single source of truth for whether 2FA is
actually required; this column exists solely so the compliance dashboard
doesn't need a Clerk API call per row.

## Messages (`/admin_pro/notifications`)

One composer for everything "reach people" — a bell notification and a
Text Whisp broadcast are two distinct backend calls (`notifications` and
`text_whisps` are genuinely different tables: a Text Whisp can be replied
to, a notification can't), but the admin writes the message once, picks
audience once, and checks one or both channels rather than visiting two
separate pages. A "Message a colleague" section on the same page covers
staff-direct sends. Two admin-initiated Text Whisp sends, both always
delivered purely in-app (never real SMS — the recipient is always a known
account, never a phone-number guess):

- **Broadcast** (`POST /admin/text-whisps/broadcast`, permission
  `notifications`): a message to every user or a selected set. Sent from
  the reserved system account (`lib/systemUser.ts`) with `senderAlias`
  "Blind Whisper Team" — deliberately **not anonymous**, unlike a normal
  person-to-person Text Whisp.
- **Staff-direct** (`POST /admin/text-whisps/to-staff`): one staff member
  reaching a colleague directly by account (validated against `listStaff()`
  in `lib/staff.ts`), skipping the phone-number lookup a normal send needs.
  Sent from the acting admin's own account/name, since colleagues already
  know each other.

Both reuse `text_whisps.source = 'admin'` to distinguish these from normal
user sends; `recipientPhone` (NOT NULL on the table) holds the recipient's
real phone if on file, else a non-actionable `internal:<userId>` sentinel —
delivery for `source: 'admin'` rows never consults it.

## Content agents

Town Crier (`/admin_pro/debate-agent`) and Circle Scout (`/admin_pro/circle-agent`)
panels control the two AI content agents — see
[features-community.md](features-community.md). Their routers share the `/admin`
mount; their middleware **must stay scoped** to their own prefixes
(`router.use("/debate-agent", …)`) — an unscoped `router.use` would run for every
`/admin/*` fall-through request and 403 other areas with the `agents` permission
(this bug happened once; don't reintroduce it).
