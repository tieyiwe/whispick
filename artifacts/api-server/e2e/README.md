# End-to-end harness

Runs the **real** API (routes, Postgres, schedulers) and the **real** frontend
together in a browser. Only external identities are swapped:

- **Clerk** — the API trusts an `x-test-user` header (`e2e_<name>` → verified
  email `<name>@e2e.test`). The e2e Vite proxy sets it from the browser's
  `e2e_user` cookie and strips any client-sent copy.
- **Anthropic** — canned "no issues" moderation verdicts.

Dev-only: nothing here is imported by the app or the unit-test suite.

```sh
# 1. a throwaway database
su postgres -c "createdb whispick_e2e"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/whispick_e2e pnpm --filter @workspace/db run push

# 2. the API (stays up until killed)
cd artifacts/api-server
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/whispick_e2e \
  E2E_API_PORT=4100 PUBLIC_APP_URL=http://127.0.0.1:5400 \
  pnpm exec vitest run --config vitest.e2e.config.ts

# 3. the frontend, proxied to it
cd artifacts/blindwhisper
E2E_WEB_PORT=5400 E2E_API_PORT=4100 node_modules/.bin/vite --config scripts/e2e/vite.e2e.config.ts
```

Sign in as anyone by setting the cookie `e2e_user=e2e_alice` on
`http://127.0.0.1:5400` (Playwright: `context.addCookies`).
