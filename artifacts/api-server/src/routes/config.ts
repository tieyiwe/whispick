import { Router, type IRouter } from "express";
import { GetPublicConfigResponse } from "@workspace/api-zod";
import { isSmsDeliveryEnabled, isWhatsAppDeliveryEnabled } from "../lib/messagingChannels";

const router: IRouter = Router();

// GET /api/config — public, unauthenticated runtime flags the client needs
// BEFORE sign-in (the landing/send flows decide which delivery options to
// render). Nothing here is per-user or sensitive: it only mirrors env
// switches the server enforces anyway (lib/messagingChannels.ts), so the UI
// hiding an option is a courtesy, never the gate itself.
//
// Not behind publicEndpointLimiter: it's a constant-time env read every page
// load hits, and counting it against that shared quota would starve the
// public routes that actually need the limit. The short public cache keeps
// repeat loads off the server while still letting a flag flip propagate
// within a few minutes.
router.get("/config", (_req, res) => {
  const data = GetPublicConfigResponse.parse({
    smsDeliveryEnabled: isSmsDeliveryEnabled(),
    whatsappDeliveryEnabled: isWhatsAppDeliveryEnabled(),
  });
  res.set("Cache-Control", "public, max-age=300");
  res.json(data);
});

export default router;
