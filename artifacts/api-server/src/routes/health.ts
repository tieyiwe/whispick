import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // TEMPORARY: diagnosing a Clerk auth misconfiguration (backend falling
  // back to a host-derived publishable key instead of the real one — see
  // app.ts's CLERK_BACKEND_PUBLISHABLE_KEY comment). Exposes only booleans
  // and an 8-char key prefix, never a real secret value, so it's safe to
  // leave reachable while diagnosing — but this block should be removed
  // once the fix is confirmed live and working.
  const key = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  res.json({
    ...data,
    debug: {
      clerkPublishableKeyConfigured: !!process.env.CLERK_PUBLISHABLE_KEY,
      viteClerkPublishableKeyConfigured: !!process.env.VITE_CLERK_PUBLISHABLE_KEY,
      clerkPublishableKeyPrefix: key ? key.slice(0, 8) : null,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
  });
});

// TEMPORARY diagnostic — remove once the Clerk "session-token-iat-before-
// client-uat" investigation is resolved. Deliberately unauthenticated (the
// whole point is to inspect why auth is failing) and deliberately NOT behind
// requireAuth. Reads the raw incoming Cookie header directly — bypassing
// @clerk/express entirely — and reproduces the exact comparison
// @clerk/backend performs (decodeJwt(session).payload.iat <
// parseInt(client_uat cookie)) so we can see, from the server's own
// perspective, precisely what values it's comparing on a real request
// instead of guessing from browser-side snapshots that might not match what
// actually got sent on the wire. Only decodes JWT payloads (unverified) for
// display — never validates signatures, never touches secrets.
function decodeJwtPayloadUnsafe(token: string): unknown {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return { error: "failed to decode" };
  }
}

router.get("/debug/clerk-auth", (req, res) => {
  const rawCookieHeader = req.headers.cookie ?? "";
  const cookies = rawCookieHeader
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const eq = c.indexOf("=");
      return { name: c.slice(0, eq), value: c.slice(eq + 1) };
    });

  const clientUatCookies = cookies.filter((c) => c.name.startsWith("__client_uat"));
  const sessionCookies = cookies.filter((c) => c.name.startsWith("__session"));

  const clientUatValues = clientUatCookies.map((c) => ({
    name: c.name,
    rawValue: c.value,
    parsedAsInt: Number.parseInt(c.value, 10) || 0,
  }));

  const sessionTokens = sessionCookies.map((c) => {
    const payload = decodeJwtPayloadUnsafe(c.value) as Record<string, unknown> | null;
    return {
      name: c.name,
      iat: payload?.iat ?? null,
      iss: payload?.iss ?? null,
      azp: payload?.azp ?? null,
    };
  });

  const comparisons = sessionTokens.flatMap((session) =>
    clientUatValues.map((clientUat) => ({
      sessionCookie: session.name,
      sessionIat: session.iat,
      clientUatCookie: clientUat.name,
      clientUatValue: clientUat.parsedAsInt,
      wouldFailIatBeforeUat:
        typeof session.iat === "number" ? session.iat < clientUat.parsedAsInt : "session iat not a number",
    })),
  );

  res.json({
    requestHost: req.headers.host ?? null,
    forwardedHost: req.headers["x-forwarded-host"] ?? null,
    allCookieNames: cookies.map((c) => c.name),
    clientUatValues,
    sessionTokens,
    comparisons,
  });
});

// TEMPORARY — the previous /debug/clerk-auth reimplements @clerk/backend's
// comparison by hand from the raw Cookie header, which risks missing
// something the real SDK does differently (e.g. its own cookie-suffix
// resolution). This one instead calls getAuth(req) directly — clerkMiddleware
// already ran on this request (mounted globally in app.ts), so this reads
// the REAL, already-computed result of the real SDK's real logic, no
// reimplementation involved. auth.debug() surfaces Clerk's own internal
// reason/message even when signed out. Remove alongside the other temporary
// debug routes once this investigation is resolved. router.all (not .get):
// a plain browser-navigation GET gets Clerk's handshake-recovery handling
// (only applies when Sec-Fetch-Dest is "document"), which a background
// fetch() — like the real app's POST /api/whisps — does NOT get. Accepting
// POST here lets us reproduce the exact code path the real failing request
// takes, not just the more forgiving navigation path.
router.all("/debug/clerk-auth-real", (req, res) => {
  const auth = getAuth(req);
  // Only the fields, not the full raw request/cookie dump auth.debug()
  // includes — that payload is large enough (duplicated JWTs across
  // headers/cookies) to get truncated by console logging or copy-paste.
  const full = (typeof auth.debug === "function" ? auth.debug() : {}) as Record<string, unknown>;
  res.json({
    userId: auth.userId,
    sessionId: auth.sessionId,
    isAuthenticated: "isAuthenticated" in auth ? auth.isAuthenticated : null,
    reason: full.reason ?? null,
    message: full.message ?? null,
    cookieSuffix: full.cookieSuffix ?? null,
    clientUat: full.clientUat ?? null,
    hasSessionTokenInCookie: !!full.sessionTokenInCookie,
    hasRefreshTokenInCookie: !!full.refreshTokenInCookie,
    hasHandshakeToken: !!full.handshakeToken,
    secFetchDest: (full.secFetchDest as string | undefined) ?? null,
    method: (full.method as string | undefined) ?? null,
  });
});

export default router;
