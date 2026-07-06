import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whispsRouter from "./whisps";
import videoRouter from "./video";
import publicRouter from "./public";
import circleRouter from "./circle";
import userRouter from "./user";
import creditsRouter from "./credits";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/whisps", whispsRouter);
router.use("/video", videoRouter);
router.use("/public", publicRouter);
router.use("/public", circleRouter);
router.use("/user", userRouter);
router.use("/credits", creditsRouter);
router.use("/billing", billingRouter);

export default router;
