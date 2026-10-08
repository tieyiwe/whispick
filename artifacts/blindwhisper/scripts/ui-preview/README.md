# UI preview harness (dev-only)

Renders the Blind Whisper web app with **no Clerk keys and no backend**, so
screens can be screenshotted for UI/UX review. Nothing here is imported by the
app, `vite.config.ts`, `build` or `serve` — it never ships.

| File | What it does |
|---|---|
| `vite.preview.config.ts` | Loads the real `vite.config.ts` and aliases `@clerk/react` → `clerkMock.tsx`, sets a dummy `VITE_CLERK_PUBLISHABLE_KEY`, port 5199, separate dep cache. |
| `clerkMock.tsx` | Fake Clerk: signed-in user "Maya Rivera" (`user_preview`, maya@example.com, no image, `getToken()` → `"preview-token"`). `?signedOut=1` on the first URL flips to a signed-out visitor (sticky for the tab; `?signedOut=0` resets). `<SignIn>`, `<SignUp>`, `<UserProfile>` render labelled placeholder cards. |
| `fixtures.mjs` | Route table answering every `/api/**` call (shapes from `lib/api-client-react/src/generated/api.schemas.ts`), plus `scenarios` (`empty`, `loading`) that override it per screen. |
| `capture.mjs` | Playwright script: starts the server if needed, intercepts `/api/**` + external hosts, captures each screen at mobile 390×844 and desktop 1440×900 (dark). |

## Run

From `artifacts/blindwhisper`:

```sh
# one-shot: starts the preview server itself, captures everything, stops it
node scripts/ui-preview/capture.mjs --out /tmp/ui-preview

# or keep a server running (faster when iterating) and point capture at it
UI_PREVIEW_PORT=5199 node_modules/.bin/vite --config scripts/ui-preview/vite.preview.config.ts
node scripts/ui-preview/capture.mjs --no-server --out /tmp/ui-preview
```

Options:

- `--only a,b` — exact screen names; a trailing `*` is a prefix (`--only 'dashboard*'`).
- `--viewport mobile|desktop` — one viewport only.
- `--out DIR` — output dir (default `$UI_PREVIEW_OUT` or `/tmp/ui-preview`).
- `--dsf 2` — device scale factor (default 1 to keep files small).
- `--base URL` — server URL (default `http://127.0.0.1:$UI_PREVIEW_PORT`, port 5199).
- `--list` — print the screens and exit.

Files are written as `<screen>-<viewport>.png` (full height), plus
`<screen>-top-<viewport>.png` (first viewport only) for screens with `topShot`.
At the end it prints any `/api` call that had **no fixture** (it was answered
with `{}` / `{ok:true}`) and any external host that was blocked. If a page shows
an empty state or an error toast, that list is where to look first.

You can also browse the preview manually at `http://127.0.0.1:5199/` — but
without capture.mjs nothing answers `/api`, so most pages will show errors.

Playwright is the global install (`/opt/node22/lib/node_modules/playwright`,
browsers in `/opt/pw-browsers`); override with `PLAYWRIGHT_MODULE=...`.

## What the harness fakes (and doesn't)

- **Fonts**: Google Fonts requests are answered locally from the monorepo's
  `@fontsource/inter` and `@fontsource/playfair-display` packages, so
  typography matches production.
- **Video thumbnails**: fixtures use `https://i.ytimg.com/vi/<id>/…` URLs;
  capture.mjs serves a deterministic gradient SVG per id. Embeds/iframes and all
  other external hosts are blocked.
- **Service workers** are blocked at the browser-context level; the install
  prompt is silenced via the `blindwhisper:installed` localStorage flag.
- **/welcome** normally bounces to /dashboard in headless Chromium (no install
  event, notifications "denied"); that screen fakes `beforeinstallprompt` and a
  `"default"` notification permission via `initScript`.
- Full-height shots grow the viewport to the content height (so `position:
  fixed` headers/bottom nav/composers sit where they really do); pages whose
  content scales with `vh` fall back to Playwright's stitched `fullPage`.
- Not real: the Clerk widgets (placeholder cards), any video playback, push.

## Adding things

**A fixture**: add `[METHOD | "*", /^\/api\/path$/, (ctx) => body]` to `routes`
in `fixtures.mjs` (first match wins — specific before generic). `ctx` has
`url, method, params` (regex groups), `search` (URLSearchParams), `body`
(parsed JSON) and `state.signedOut`. Return `{ __status: 204 }` for no body,
`{ __status: 404, __body: {...} }` for errors, `{ __hang: true }` to never
answer (loading state). Find the URL + response type in
`lib/api-client-react/src/generated/api.ts` (`get<Name>Url` / `Promise<Type>`).

**A scenario** (e.g. "new user, nothing yet"): add a route table under
`scenarios` and set `scenario: "<name>"` on a screen; its routes are tried
before the defaults.

**A screen**: add an entry to `screens` in `capture.mjs`:

```js
{ name: "my-screen", path: "/some/route", signedOut: false, topShot: true,
  viewports: ["mobile"], fullPage: true, scenario: "empty",
  initScript: () => { /* runs before app code */ },
  action: async (page, viewport) => { await page.locator('[data-testid="x"]').click(); } }
```

Prefer `data-testid` selectors (the app has many) inside `action`.

**Something new imported from `@clerk/react`**: add it to `clerkMock.tsx`
(otherwise Vite reports a missing export).
