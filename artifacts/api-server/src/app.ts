import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { getPublicAppUrl } from "./lib/publicUrl";
import router from "./routes";
import { handleStripeWebhook } from "./routes/billing";
import { logger } from "./lib/logger";

const app: Express = express();

// Needed so req.ip (used by rate limiting) and X-Forwarded-Proto/Host
// reflect the real client behind Replit's edge proxy rather than the proxy
// itself.
app.set("trust proxy", 1);

// Gzip/brotli-negotiated compression for every response this server sends —
// biggest win on the admin analytics/list JSON payloads (large arrays of
// whisps/users serialized as JSON compress very well) but free for
// everything else too. Placed before the Stripe webhook route on purpose:
// compression only touches response bodies, never the raw request body
// express.raw() needs for signature verification, so it's safe there.
app.use(compression());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Reflecting all origins (origin: true) with credentials: true would let any
// website make credentialed cross-origin requests here — since Clerk auth is
// cookie-based, that's a cross-site data-theft vector for a logged-in user.
// Only the app's own origin (+ configured/dev origins) may use credentials.
// Browsers send an Origin header on same-origin state-changing requests too,
// not just cross-origin ones, so we can't just require a configured
// PUBLIC_APP_URL — that would break same-origin requests in any deployment
// where it hasn't been set. Instead, allow an Origin whose host matches the
// Host header this request actually arrived on (genuinely same-origin),
// plus an explicit allowlist for legitimately cross-origin dev setups.
// The localhost dev origins are only allowed outside production — in a real
// deployment nothing should be making credentialed cross-origin requests
// from a loopback address, and leaving them in the allowlist would let a
// malicious app bound to that port on a victim's machine ride the victim's
// Clerk session cookie. In production the same-origin check (isSameOrigin)
// plus an explicit PUBLIC_APP_URL is the whole allowlist.
const isProduction = process.env.NODE_ENV === "production";
const explicitAllowedOrigins = new Set(
  [
    process.env.PUBLIC_APP_URL,
    ...(isProduction ? [] : ["http://localhost:22964", "http://127.0.0.1:22964"]),
  ].filter((v): v is string => !!v),
);

function isSameOrigin(origin: string, req: import("express").Request): boolean {
  try {
    return new URL(origin).host === getPublicAppUrl(req).replace(/^https?:\/\//, "");
  } catch {
    return false;
  }
}

app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    const allowed = !origin || explicitAllowedOrigins.has(origin) || isSameOrigin(origin, req);
    callback(null, { credentials: true, origin: allowed });
  }),
);

// Stripe requires the raw request body to verify webhook signatures, so this
// route is mounted before the JSON body parser below.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Must be the exact same publishable key the frontend uses (App.tsx's
// clerkPubKey) — NOT run through @clerk/shared's publishableKeyFromHost.
// That helper only returns a literal key as-is for development-mode
// (pk_test_) keys; for a production (pk_live_) key it unconditionally
// derives a synthetic host-based key instead (`clerk.<hostname>`), ignoring
// whatever real key is configured. This app's custom domain support comes
// entirely from the frontend's proxyUrl (VITE_CLERK_PROXY_URL, routed
// through clerkProxyMiddleware below) — the frontend already gets a
// correctly-issued, correctly-scoped token for this exact domain via that
// proxy, with no host-derivation needed. Wrapping the BACKEND's key in
// publishableKeyFromHost made it verify against a synthetic identity Clerk
// has never issued anything for, instead of the real instance the frontend
// is actually using: every request looked unauthenticated
// (x-clerk-auth-reason: session-token-iat-before-client-uat) no matter how
// many times a user signed in, on every domain, since it wasn't a session
// problem — the two sides were never even checking the same instance.
//
// The frontend only ever gets VITE_CLERK_PUBLISHABLE_KEY (Vite bakes VITE_*
// vars into the client bundle; a plain, unprefixed var isn't visible there),
// so fall back to it here if a separate backend-only CLERK_PUBLISHABLE_KEY
// isn't set — one configured secret is then enough for both sides to agree.
const CLERK_BACKEND_PUBLISHABLE_KEY =
  process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY;

app.use(
  clerkMiddleware(() => ({
    publishableKey: CLERK_BACKEND_PUBLISHABLE_KEY,
  })),
);

app.use("/api", router);

// Unknown /api/* routes previously fell through to Express's default HTML
// 404 page — every real endpoint in this API returns JSON, so an unknown
// path should too.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Terminal error handler. Individual routes rely on Express 5's built-in
// promise-rejection-to-next(err) behavior rather than their own try/catch,
// so without this, any unhandled exception previously fell through to
// Express's default handler — an HTML page, not the {error: "..."} JSON
// shape every other endpoint here returns, which the frontend can't parse.
// Never echo err.message/stack to the client: full detail goes to the
// logger only, since an unhandled exception can carry information (query
// values, internal state) that wasn't meant to be user-facing.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  req.log?.error({ err }, "Unhandled error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

export default app;
