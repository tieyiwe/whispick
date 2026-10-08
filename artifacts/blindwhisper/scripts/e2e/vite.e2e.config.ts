// DEV-ONLY end-to-end Vite config (see README.md). The real app, served
// against the REAL API (artifacts/api-server's e2e server) instead of
// fixtures. Only Clerk is swapped: `@clerk/react` → clerkMock.e2e.tsx, and the
// proxy forwards the browser's `e2e_user` cookie as `x-test-user`, which the
// e2e API server reads as the signed-in Clerk id.
//
//   E2E_WEB_PORT=5400 E2E_API_PORT=4100 node_modules/.bin/vite --config scripts/e2e/vite.e2e.config.ts
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { mergeConfig, type UserConfig, type ProxyOptions } from "vite";

const port = process.env.E2E_WEB_PORT ?? "5400";
const apiPort = process.env.E2E_API_PORT ?? "4100";

process.env.PORT ??= port;
process.env.BASE_PATH ??= "/";
process.env.VITE_CLERK_PUBLISHABLE_KEY ??= "pk_test_e2e";

const { default: baseConfig } = (await import("../../vite.config.ts")) as { default: UserConfig };

const here = import.meta.dirname;

function e2eUser(req: IncomingMessage): string | null {
  const m = (req.headers.cookie ?? "").match(/(?:^|;\s*)e2e_user=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

const toApi: ProxyOptions = {
  target: `http://127.0.0.1:${apiPort}`,
  changeOrigin: false,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => {
      // Never let the browser choose its identity by header — only the cookie.
      proxyReq.removeHeader("x-test-user");
      const user = e2eUser(req);
      if (user) proxyReq.setHeader("x-test-user", user);
    });
  },
};

export default mergeConfig(baseConfig, {
  resolve: {
    alias: [{ find: /^@clerk\/react$/, replacement: path.resolve(here, "clerkMock.e2e.tsx") }],
  },
  server: {
    port: Number(port),
    strictPort: true,
    host: "127.0.0.1",
    hmr: false,
    proxy: {
      "/api": toApi,
      "^/(wb|dt|iv|tx)(/|$)": toApi,
    },
  },
  cacheDir: path.resolve(here, `../../node_modules/.vite-e2e-${port}`),
} satisfies UserConfig);
