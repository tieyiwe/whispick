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
import { publicEndpointLimiter } from "../lib/rateLimit";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/whisps", whispsRouter);
router.use("/video", videoRouter);
router.use("/public", publicEndpointLimiter, publicRouter);
router.use("/public", publicEndpointLimiter, circleRouter);
router.use("/circles", circlesRouter);
router.use("/user", userRouter);
router.use("/credits", creditsRouter);
router.use("/billing", billingRouter);
router.use("/l", publicEndpointLimiter, linkRouter);
router.use("/admin", adminRouter);

export default router;
