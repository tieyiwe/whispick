import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import helmet from "helmet";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { getPublicAppUrl, requestOriginFromHeaders } from "./lib/publicUrl";
import router from "./routes";
import { handleStripeWebhook } from "./routes/billing";
import whisperBoxLinkRouter from "./routes/whisperBoxLink";
import debateTopicLinkRouter from "./routes/debateTopicLink";
import inviteLinkRouter from "./routes/inviteLink";
import textWhispLinkRouter from "./routes/textWhispLink";
import { publicEndpointLimiter } from "./lib/rateLimit";
import { logger } from "./lib/logger";
import { recordBugReport } from "./lib/bugRabbit";
import { scrubPathTokens } from "./lib/piiScrub";

const app: Express = express();

// Needed so req.ip (used by rate limiting) and X-Forwarded-Proto/Host
// reflect the real client behind Replit's edge proxy rather than the proxy
// itself.
app.set("trust proxy", 1);
app.disable("x-powered-by");

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
          // Capability tokens live in paths (/w/<token>, /api/public/w/<token>/
          // reply, ...) — never write a usable one into the logs.
          url: req.url ? scrubPathTokens(req.url.split("?")[0]) : req.url,
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

// Standard security headers (HSTS, nosniff, frameguard, referrer policy,
// COOP, ...). Mounted AFTER the Clerk proxy on purpose so Clerk's Frontend
// API responses (OAuth redirects, JS bundles) pass through exactly as Clerk
// sent them. Deliberate relaxations:
// - CSP off for now: the server-rendered preview/redirect pages (/l, /wb,
//   /dt, /iv, /tx) use inline markup + redirects — a real policy is a follow-up.
// - COEP off and CORP cross-origin: media/thumbnails served here are loaded
//   by email clients, link-preview crawlers and the frontend's origin.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

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

// Compares the FULL origin (scheme included), not just the host. Matching on
// host alone treated http://app.example.com as same-origin for an https
// deployment, so a network attacker able to serve plaintext on the app's own
// hostname would pass this check and then get to make credentialed
// cross-origin requests. Unreachable behind an https-only edge with HSTS, but
// the check shouldn't be the thing relying on that.
function isSameOrigin(origin: string, req: import("express").Request): boolean {
  try {
    const o = new URL(origin).origin;
    // The request's own host (genuinely same-origin) or the configured app
    // origin — the CORS check compares, it never builds an outbound link.
    return o === new URL(requestOriginFromHeaders(req)).origin || o === new URL(getPublicAppUrl(req)).origin;
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

// Mounted at the bare "/wb" prefix (not under "/api") so a shared Whisper
// Box link reads as blindwhisper.com/wb/handle — see this repo's
// .replit-artifact/artifact.toml, which registers "/wb" as this service's
// own second top-level path alongside "/api" (Replit's path router sends
// anything under either prefix here; everything else goes to the
// static-hosted frontend). Has to be this server, not the frontend: only a
// running Node process can tell a link-preview crawler apart from a real
// browser and return real per-handle Open Graph tags — see
// routes/whisperBoxLink.ts's own comment.
app.use("/wb", publicEndpointLimiter, whisperBoxLinkRouter);
// Same reasoning for shared debate topics: blindwhisper.com/dt/<id> must
// reach this server (registered in artifact.toml) — the static frontend
// can't tell a link-preview crawler from a browser, and has no /dt route at
// all, so emailed /dt links used to land on a blank app shell. The old
// /api/dt mount in routes/index.ts stays for links already shared.
app.use("/dt", publicEndpointLimiter, debateTopicLinkRouter);
// Same again for invites (/iv → /invite/:token) and guest Text Whisps
// (/tx → /tw/:token): the links those features send now point here so they
// unfurl a real preview. The SPA routes they redirect to are unchanged, so
// links already sent in the old form keep working.
app.use("/iv", publicEndpointLimiter, inviteLinkRouter);
app.use("/tx", publicEndpointLimiter, textWhispLinkRouter);

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
  // body-parser attaches the raw request body to its errors (err.body) —
  // up to the full JSON limit of possibly-PII user input. Never log it.
  if (err && typeof err === "object" && "body" in err) delete (err as { body?: unknown }).body;

  // Client errors raised by middleware (malformed JSON → 400, body too
  // large → 413, a malformed URI, ...) are the CLIENT's fault: answer with
  // that status, and don't file them in BugRabbit — otherwise any anonymous
  // caller could mint error-tracker rows (and 500s) at will. Keyed on the
  // http-errors `expose` flag (what body-parser/Express set), NOT any 4xx
  // status: an upstream SDK error (Stripe/Anthropic carry status 400/429)
  // is still OUR failure and must stay a reported 500.
  const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : undefined;
  if (err?.expose === true && status !== undefined && status >= 400 && status < 500) {
    req.log?.warn({ err: { type: err?.type, message: err?.message, status } }, "Client error");
    if (res.headersSent) return;
    res.status(status).json({ error: status === 413 ? "Request body too large" : "Bad request" });
    return;
  }

  req.log?.error({ err }, "Unhandled error");
  // BugRabbit capture — fire-and-forget (recordBugReport catches its own
  // failures, see lib/bugRabbit.ts), so this never delays or risks the
  // response below. userId is left null rather than resolved from the
  // Clerk session here: that would add a DB round trip to every unhandled-
  // error path for a best-effort tracker, and the request is already fully
  // captured in the structured log line just above via req.log.
  void recordBugReport({
    source: "backend",
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? (err.stack ?? null) : null,
    url: req.originalUrl,
    userAgent: req.headers["user-agent"] ?? null,
    userId: null,
  });
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

export default app;
