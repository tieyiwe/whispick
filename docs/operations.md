# Operations

## Environments

| Where | What | Branch | Database |
|---|---|---|---|
| Replit **workspace** | dev/build environment + Deployments source | `main` | `$DATABASE_URL` → dev DB (`helium/heliumdb`) |
| Replit **Deployment** | blindwhisper.com production | built from workspace `main` | **separate production DB** (connection string in Database pane → Production tab) |
| Claude session | development | `claude/codebase-exploration-if110f` (PR #1) | local Postgres for tests |

**The two databases are the biggest operational trap.** The workspace
`$DATABASE_URL` is the dev database. Schema pushes and data fixes must be run
**twice** — once plain (dev) and once with the production connection string
substituted. Production writes may require toggling off read-only mode in the
Database pane first.

## Deploy runbook (run in the Replit workspace shell)

```bash
git pull
git merge origin/claude/codebase-exploration-if110f   # workspace is on main; a plain pull is NOT enough
pnpm install
pnpm --filter @workspace/db run push                   # dev DB
DATABASE_URL="<real production connection string>" pnpm --filter @workspace/db run push   # production DB — substitute the actual string!
PORT=22964 BASE_PATH="/" pnpm run build
```

Then **Republish** in the Replit Deployments pane. After republishing, hard-refresh
or use incognito once — the service worker caches the old bundle.

Notes:
- `drizzle-kit push` is additive-interactive; approve new tables/columns. Nothing
  in the current schema drops data.
- If the production push exits 1 immediately, the usual cause is a placeholder or
  malformed connection string.

## Testing

- Backend: `cd artifacts/api-server && npx vitest run` (46 files / ~529 tests).
  Requires local Postgres: `sudo pg_ctlcluster 16 main start` if connection refused.
- Test auth: `TEST_USER_HEADER`; admin tests use `adminTestUtils.ts`
  (`adminHeaders` = owner + real computed TOTP; `collaboratorHeaders` = staff
  without owner env). `setup.ts` truncates all tables between tests — new tables
  must be added to its truncate list.
- Rate limiters persist across tests in a file — use fresh `randomUUID()` clerk IDs.
- Frontend: `cd artifacts/blindwhisper && npx tsc -p tsconfig.json --noEmit`
  (run `npx tsc --build` at repo root first if lib types changed).

## Env vars / secrets (Replit Secrets)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (dev in workspace; production string used explicitly for prod pushes) |
| `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | Replit-managed Clerk auth |
| `ADMIN_EMAILS` | Bootstrap owner (super admin) email(s) |
| `ADMIN_MFA_TOKEN_SECRET` | Signs admin MFA unlock tokens (optional; falls back to Clerk secret) |
| `ANTHROPIC_API_KEY` | AI takeaways, categorization, content agents, usage insights |
| Stripe keys | Reply-credit purchases + webhook |
| SMS provider keys | Text Whisp SMS delivery + phone verification |
| Object storage keys | Video upload/storage |

(Values live only in Replit Secrets; keep this table's *names* current.)

## Schedulers

In-process recurring jobs start with the api-server. If a scheduled behavior
misfires in production, remember there is exactly one deployed process — check the
Deployment logs. See feature pages for each scheduler's behavior.

## Git / branches

- Development happens on `claude/codebase-exploration-if110f`; PR #1 tracks it.
- The Replit workspace sits on `main` and merges the dev branch at deploy time
  (see runbook). Deployments silently build whatever `main` holds — a stale merge
  means a stale deploy even when the push succeeded.

## Launch checklist (standing items)

- Migrate/verify Clerk instance strategy before the big marketing push.
- Production DB schema parity: after any batch that adds tables, confirm the
  production push actually ran (the dev push succeeding is not enough).
- Prerendered pages + sitemap/robots/llms.txt stay in sync with public routes.
