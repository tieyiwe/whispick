// DEV-ONLY UI preview Vite config. Not used by `dev`, `build` or `serve`.
//
// Reuses the app's real vite.config.ts (plugins, aliases, root) and layers on:
//   - `@clerk/react` → ./clerkMock.tsx (fixed signed-in "Maya", or signed-out
//     via `?signedOut=1`), so no Clerk keys / network are needed;
//   - a dummy VITE_CLERK_PUBLISHABLE_KEY so App.tsx doesn't throw at boot.
//
// Everything else that would need a backend (/api/**) is answered by the
// Playwright capture script (capture.mjs) via page.route() fixtures, and
// service workers are blocked at the browser-context level there, so no app
// source has to change.
//
// Run from artifacts/blindwhisper:
//   UI_PREVIEW_PORT=5199 node_modules/.bin/vite --config scripts/ui-preview/vite.preview.config.ts
import path from "node:path";
import { mergeConfig, type UserConfig } from "vite";

const port = process.env.UI_PREVIEW_PORT ?? "5199";

// The base config throws unless these are set (it's written for Replit's
// workflow runner). Set them before importing it.
process.env.PORT ??= port;
process.env.BASE_PATH ??= "/";
// Vite exposes VITE_* vars from process.env to import.meta.env.
process.env.VITE_CLERK_PUBLISHABLE_KEY ??= "pk_test_uipreview";

const { default: baseConfig } = (await import("../../vite.config.ts")) as { default: UserConfig };

const here = import.meta.dirname;

export default mergeConfig(baseConfig, {
  resolve: {
    alias: [
      { find: /^@clerk\/react$/, replacement: path.resolve(here, "clerkMock.tsx") },
    ],
  },
  define: {
    "import.meta.env.VITE_UI_PREVIEW": JSON.stringify("1"),
  },
  server: {
    port: Number(port),
    strictPort: true,
    host: "127.0.0.1",
    hmr: false,
  },
  // Keep the preview's dep-optimizer cache separate from the real dev server's
  // so the two never invalidate each other.
  cacheDir: path.resolve(here, "../../node_modules/.vite-ui-preview"),
} satisfies UserConfig);
