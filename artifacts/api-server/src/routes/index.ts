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
import whisperGroupsRouter from "./whisperGroups";
import mediaRouter from "./media";
import subscribeRouter from "./subscribe";
import suggestionsRouter from "./suggestions";
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
router.use("/circles", circlesRouter);
router.use("/user", userRouter);
router.use("/credits", creditsRouter);
router.use("/billing", billingRouter);
router.use("/l", publicEndpointLimiter, linkRouter);
router.use("/admin", adminRouter);
router.use("/whisper-groups", whisperGroupsRouter);
router.use("/media", mediaRouter);
router.use("/suggestions", suggestionsRouter);

export default router;
