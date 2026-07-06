import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whispsRouter from "./whisps";
import videoRouter from "./video";
import publicRouter from "./public";
import userRouter from "./user";
import creditsRouter from "./credits";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/whisps", whispsRouter);
router.use("/video", videoRouter);
router.use("/public", publicRouter);
router.use("/user", userRouter);
router.use("/credits", creditsRouter);

export default router;
