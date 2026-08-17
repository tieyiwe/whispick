import { Router, type IRouter } from "express";
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

export default router;
