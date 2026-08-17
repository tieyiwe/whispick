import type { Request } from "express";

/**
 * Base URL of the public-facing frontend, used to build links embedded in
 * emails and Stripe redirect URLs. The frontend proxies /api/* to this
 * server, so absent an explicit override the request's forwarded host is
 * the frontend's own public origin.
 */
export function getPublicAppUrl(req: Request): string {
  const override = process.env.PUBLIC_APP_URL;
  if (override) return override.replace(/\/$/, "");

  const protocol = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https";
  const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "localhost";
  return `${protocol}://${host}`;
}
