import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whispsRouter from "./whisps";
import videoRouter from "./video";
import publicRouter from "./public";
import circleRouter from "./circle";
import circlesRouter from "./circles";
import userRouter from "./user";
import creditsRouter from "./credits";
import billingRouter from "./billing";
import linkRouter from "./link";
import adminRouter from "./admin";
import adminMfaRouter from "./adminMfa";
import adminAccessRouter from "./adminAccess";
import adminDebateAgentRouter from "./adminDebateAgent";
import adminCircleAgentRouter from "./adminCircleAgent";
import whisperGroupsRouter from "./whisperGroups";
import mediaRouter from "./media";
import subscribeRouter from "./subscribe";
import suggestionsRouter from "./suggestions";
import invitesRouter from "./invites";
import publicInvitesRouter from "./publicInvites";
import publicTextWhispsRouter from "./publicTextWhisps";
import textWhispsRouter from "./textWhisps";
import debateTopicsRouter from "./debateTopics";
import followsRouter from "./follows";
import contentReportsRouter from "./contentReports";
import usageEventsRouter from "./usageEvents";
import { publicEndpointLimiter } from "../lib/rateLimit";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/whisps", whispsRouter);
router.use("/video", videoRouter);
// One limiter application per request, not one per sub-router: mounting
// publicEndpointLimiter separately on each of these three `.use("/public", ...)`
// registrations re-ran it (and re-incremented its counter) for every router
// that fell through without a matching route before the request finally
// matched — a request to /public/subscribe, for instance, passed through
// (and got counted against) publicRouter's and circleRouter's limiter
// instances before ever reaching subscribeRouter's own. That silently cut
// the real quota to a fraction of the intended 60 requests / 5 minutes,
// worse the later a router's own routes appear in this list.
router.use("/public", publicEndpointLimiter);
router.use("/public", publicRouter);
router.use("/public", circleRouter);
router.use("/public", subscribeRouter);
router.use("/public", publicInvitesRouter);
router.use("/public", publicTextWhispsRouter);
router.use("/public", usageEventsRouter);
// No prefix: debateTopicsRouter defines its own full paths (both the
// authenticated "/debate-topics" create/delete and the public
// "/public/debate-topics..." routes), same pattern healthRouter uses above.
// Mounted after the "/public" limiter registration so requests to its
// public routes still pass through publicEndpointLimiter first.
router.use(debateTopicsRouter);
router.use("/follows", followsRouter);
// No prefix, same reasoning as debateTopicsRouter above — it defines its
// own full "/content-reports" path.
router.use(contentReportsRouter);
router.use("/circles", circlesRouter);
router.use("/user", userRouter);
router.use("/credits", creditsRouter);
router.use("/billing", billingRouter);
router.use("/l", publicEndpointLimiter, linkRouter);
// Mounted OUTSIDE the /admin router's requireAdmin chain on purpose: these
// are the enrollment/unlock endpoints the MFA gate sends a locked-out
// admin through (they do their own signed-in + admin-role check inline).
router.use("/admin-mfa", adminMfaRouter);
// Before the main admin router so /admin/access terminates here instead of
// running the main router's middleware chain first.
router.use("/admin/access", adminAccessRouter);
router.use("/admin", adminRouter);
// Separate router/file from adminRouter (see routes/adminDebateAgent.ts's
// own comment for why) but the same "/admin" base path, so its routes still
// read as /api/admin/debate-agent/....
router.use("/admin", adminDebateAgentRouter);
// Same "/admin" base path, separate router/file for the same reason (see
// routes/adminCircleAgent.ts's own comment) — its routes read as
// /api/admin/circle-agent/....
router.use("/admin", adminCircleAgentRouter);
router.use("/whisper-groups", whisperGroupsRouter);
router.use("/media", mediaRouter);
router.use("/suggestions", suggestionsRouter);
router.use("/invites", invitesRouter);
router.use("/text-whisps", textWhispsRouter);

export default router;
