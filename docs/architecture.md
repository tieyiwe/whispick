# Architecture

## Monorepo layout (pnpm workspaces)

```
whispick/
├── artifacts/
│   ├── api-server/        Express backend (TypeScript, esbuild bundle)
│   ├── blindwhisper/      React frontend (Vite, wouter, TanStack Query, Tailwind + shadcn/ui)
│   └── mockup-sandbox/    Design sandbox (excluded from production build)
├── lib/
│   ├── db/                Drizzle ORM schema + drizzle-kit push config
│   ├── api-spec/          openapi.yaml — the single source of truth for the HTTP API
│   ├── api-client-react/  GENERATED TanStack Query hooks (orval) + custom fetch layer
│   └── api-zod/           GENERATED zod schemas used by the server for validation
├── scripts/               Build/utility scripts
└── docs/                  This documentation
```

## Stack

- **Frontend:** React 18, Vite, wouter (routing), TanStack Query v5 (all server state via
  generated hooks), Tailwind CSS + shadcn/ui (Radix), i18next (8 languages), PWA
  (service worker + push), lazy-loaded routes via `React.lazy`.
- **Backend:** Express, pino logging, Drizzle ORM on node-postgres, zod validation from
  the generated `@workspace/api-zod` package.
- **Database:** PostgreSQL (Replit-hosted; separate dev and production databases).
- **Auth:** Replit-managed Clerk (see [security-auth.md](security-auth.md)).
- **AI:** Anthropic API (takeaways, categorization, content agents, usage insights).
- **Payments:** Stripe (reply credits).
- **Hosting:** Replit Deployments serving the built frontend + API from one Express process.

## API contract workflow (critical)

The HTTP API is contract-first. Any endpoint change follows this exact sequence:

1. Edit `lib/api-spec/openapi.yaml` (paths + component schemas).
2. Run codegen: `pnpm run codegen` (from `lib/api-spec`). This regenerates:
   - `lib/api-client-react/src/generated/*` — typed TanStack Query hooks for the frontend
     (hook names derive from `operationId`, e.g. `useAdminListProjects`).
   - `lib/api-zod/src/generated/*` — zod schemas the server imports to validate
     request bodies/params.
3. Implement the route in `artifacts/api-server/src/routes/…` using the zod schemas.
4. Use the generated hooks in the frontend. Never hand-write fetch calls.
5. `npx tsc --build` at the repo root rebuilds lib type outputs before frontend typecheck.

## Request flow

```
Browser ──(bearer token via custom-fetch)──▶ Express api-server
  │  lib/api-client-react/src/custom-fetch.ts attaches:
  │    • Clerk session token (Authorization: Bearer …)
  │    • X-Admin-Mfa unlock token (admin surface only, via setExtraHeadersGetter)
  ▼
routes/index.ts mounts routers under /api (see api.md for the full map)
  • auth middleware resolves the Clerk user → ensureUser upserts/heals the users row
  • requireAdmin / requirePermission gate the admin surface
  • zod (api-zod) validates inputs; Drizzle executes queries
```

## Frontend structure

- `src/App.tsx` — the entire route table (public, authed, admin `/admin_pro/*`), plus
  app-level wiring: auto-update, ErrorBoundary, `initFeatureUsage()`, admin MFA header
  getter, `PolicyUpdateGate`.
- `src/pages/` — one file per page; `src/pages/admin/` for the HQ.
- `src/components/layout/` — `AppLayout` (user app shell), `AdminLayout` (HQ shell + nav
  rail), `AdminRoute` (admin gate + MFA enroll/unlock screens), `ProtectedRoute`.
- `src/i18n/` — locale JSON namespaces (see [i18n.md](i18n.md)).
- `src/lib/featureUsage.ts` — zero-instrumentation click analytics (see admin-hq.md).

## Build pipeline

`PORT=22964 BASE_PATH="/" pnpm run build` runs, in order:

1. `pnpm run typecheck` — `tsc --build` for libs, then per-package `--noEmit` typechecks.
2. `api-server` — esbuild bundle to `dist/index.mjs` (+ pino workers).
3. `blindwhisper` — Vite build, then `scripts/prerender.mjs` writes static prerendered
   HTML for SEO-critical routes: `/` (index), `/privacy`, `/terms`,
   `/community-guidelines`, `/sms-terms`, `/subscribe`, plus `app-shell.html` as the SPA
   fallback. A drift guard asserts the homepage `<title>` matches `HOME_TITLE`.

Prerender + `sitemap.xml`/`robots.txt`/`llms.txt` are the SEO/AIO surface — keep them in
sync with public pages.

## Background schedulers

The api-server registers recurring in-process jobs on boot (`lib/scheduler.ts` +
per-feature `*Scheduler.ts` files): whisp expiration, media retention, AI takeaways,
reply notifications, text-whisp scheduled sends, subscriber matching, reminders, and the
two content agents (Town Crier, Circle Scout). Details in the feature pages.
