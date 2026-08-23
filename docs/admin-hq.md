# Admin HQ

The admin panel lives at **`/admin_pro`** (deliberately not `/admin` — the old path 404s
on purpose, for obscurity; there is no redirect). It is designed as the owner's command
center: Odoo-style grouped left rail, charcoal/violet-grey/matte-yellow theme, and every
business function in one place. The admin UI is English-only by convention.

## Shell & theme

- `components/layout/AdminLayout.tsx` — the HQ shell. Nav groups: **Business**
  (Overview, Analytics, Projects), **Community** (Users, Moderation, Reports),
  **Content** (Whisps, Suggestions, Town Crier, Circle Scout), **Outreach**
  (Notifications, Policies), **System** (Audit Log, Staff & Access).
- Nav items carry `permission` / `ownerOnly` and are filtered by
  `useGetMyAdminAccess`; collaborators landing on `/admin_pro` without the
  `analytics` permission are redirected to their first permitted page.
- Theme: `.admin-theme` CSS token override block in `index.css`
  (charcoal `255 12% 7%`, violet-grey cards `255 10% 13%`, matte yellow primary
  `46 64% 62%`). The class is applied to both the layout root **and**
  `document.body` (Radix portals render into body).

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
analytics, audit_log, projects`.

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
- **AI insights**: `lib/usageInsights.ts` sends aggregated stats to Anthropic
  (`claude-haiku-4-5-20251001`) and returns practical product insights
  (JSON contract with raw-text fallback).
- Users page shows accurate **last seen** (`users.lastSeenAt`) and has a
  "Repair placeholder emails" backfill button.

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
(who, what, target) and browsable.

## Content agents

Town Crier (`/admin_pro/debate-agent`) and Circle Scout (`/admin_pro/circle-agent`)
panels control the two AI content agents — see
[features-community.md](features-community.md). Their routers share the `/admin`
mount; their middleware **must stay scoped** to their own prefixes
(`router.use("/debate-agent", …)`) — an unscoped `router.use` would run for every
`/admin/*` fall-through request and 403 other areas with the `agents` permission
(this bug happened once; don't reintroduce it).
