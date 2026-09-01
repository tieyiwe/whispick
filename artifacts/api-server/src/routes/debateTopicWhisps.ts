import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, debateTopicWhispsTable, debateTopicsTable, type DebateTopicWhisp } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { sendEmail, debateTopicWhispEmailHtml } from "../lib/email";
import { sendSms, sendWhatsApp, debateTopicWhispSmsBody } from "../lib/sms";
import { logDeliveryAttempt } from "../lib/deliveryLog";
import { debateTopicWhispHookLine } from "../lib/copy";
import { sendDebateTopicWhispLimiter } from "../lib/rateLimit";
import { findVerifiedRecipient, findVerifiedRecipientByEmail, deliverInApp } from "../lib/deliver";
import { logger } from "../lib/logger";
import { notRetracted, topicUrl } from "./debateTopics";

const router = Router();

const CHANNELS = ["email", "sms", "whatsapp"] as const;

// Dispatches a Debate Topic Whisp over whichever channel the sender chose —
// same overall shape as lib/deliver.ts's deliverWhisperLink (matched
// recipient gets in-app + the real send; unmatched gets only the real
// send), but built locally rather than growing deliverWhisperLink to cover
// a second, unrelated content type keyed to a different table. See
// routes/invites.ts's dispatchInvite for the closest precedent — this adds
// back the matched-recipient in-app branch that invites deliberately skip
// (an invite recipient who's already a user doesn't need one; a debate
// topic recipient who already has the app very much benefits from seeing
// it show up in their own notification bell too).
//
// Fire-and-forget, called after the create response has already gone out —
// same anti-latency posture every other real Twilio/Resend round-trip in
// this app takes.
async function dispatchDebateTopicWhisp(whisp: DebateTopicWhisp, topicText: string, appUrl: string): Promise<void> {
  const topicPageUrl = `${appUrl}${topicUrl(whisp.debateTopicId)}`;
  const logCtx = { whispId: null, purpose: "debate_topic_whisp" as const };
  const hookLine = debateTopicWhispHookLine();
  const notifyTitle = "New Debate Now topic for you 🗣️";

  let success: boolean;
  if (whisp.channel === "email" && whisp.recipientEmail) {
    const matched = await findVerifiedRecipientByEmail(whisp.recipientEmail);
    const inAppOk = matched
      ? await deliverInApp(matched.id, notifyTitle, hookLine, topicUrl(whisp.debateTopicId), whisp.recipientEmail, logCtx)
      : false;
    const shouldEmail = !matched || matched.emailNotificationsEnabled;
    const emailOk = shouldEmail
      ? await sendEmail(whisp.recipientEmail, hookLine, debateTopicWhispEmailHtml(topicText, topicPageUrl, whisp.note), logCtx)
      : true; // opted out, not a failure
    success = matched ? inAppOk || emailOk : emailOk;
  } else if ((whisp.channel === "sms" || whisp.channel === "whatsapp") && whisp.recipientPhone) {
    const matched = await findVerifiedRecipient(whisp.recipientPhone);
    const inAppOk = matched
      ? await deliverInApp(matched.id, notifyTitle, hookLine, topicUrl(whisp.debateTopicId), whisp.recipientPhone, logCtx)
      : false;
    const transportOk =
      whisp.channel === "sms"
        ? await sendSms(whisp.recipientPhone, debateTopicWhispSmsBody(topicPageUrl, whisp.note), logCtx)
        : await sendWhatsApp(whisp.recipientPhone, topicPageUrl, logCtx);
    success = matched ? inAppOk || transportOk : transportOk;
  } else {
    logger.error({ whispId: whisp.id, channel: whisp.channel }, "No deliverable channel/contact for debate topic whisp");
    await logDeliveryAttempt((whisp.channel as "email" | "sms" | "whatsapp") ?? "email", whisp.recipientEmail ?? whisp.recipientPhone ?? "unknown", logCtx, {
      success: false,
      errorMessage: "No recipient contact on file for the selected channel",
    });
    success = false;
  }

  if (!success) {
    await db.update(debateTopicWhispsTable).set({ status: "failed" }).where(eq(debateTopicWhispsTable.id, whisp.id));
  }
}

const sendDebateTopicWhispSchema = z
  .object({
    // Validated, not bare strings — these go straight to the mail/SMS
    // transports as the destination address, same reasoning as
    // routes/invites.ts's createInviteSchema.
    recipientEmail: z.string().email().max(320).nullable().optional(),
    recipientPhone: z.string().max(32).regex(/^[+0-9()\-.\s]+$/, "Not a valid phone number").nullable().optional(),
    channel: z.enum(CHANNELS),
    note: z.string().trim().max(200).nullable().optional(),
    senderAlias: z.string().trim().max(60).nullable().optional(),
  })
  .refine((data) => (data.channel === "email" ? !!data.recipientEmail : !!data.recipientPhone), {
    message: "Email needs a recipient email; text/WhatsApp needs a recipient phone number",
  });

// POST /api/debate-topics/:id/whisp — Whisper this topic to one contact,
// anonymously, over email/SMS/WhatsApp. Open to any signed-in viewer of the
// topic, not just its author (see debate_topic_whisps.ts's own comment) —
// same "anyone can pass this forward" posture a video whisp's recipient
// page already has.
router.post("/:id/whisp", requireAuth, sendDebateTopicWhispLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  // sendDebateTopicWhispLimiter's explicit Request/Response typing widens
  // this handler chain's params to Express's generic ParamsDictionary (see
  // requireAuth's own comment in lib/auth.ts, and whisperGroups.ts's
  // identical cast) — cast back to the string this route's `:id` segment
  // actually is.
  const topicId = req.params.id as string;

  const topic = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText })
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, topicId), notRetracted()))
    .then((r) => r[0]);
  if (!topic) {
    res.status(404).json({ error: "Debate topic not found" });
    return;
  }

  const parsed = sendDebateTopicWhispSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { channel, recipientEmail, recipientPhone, note, senderAlias } = parsed.data;

  const id = randomUUID();
  await db.insert(debateTopicWhispsTable).values({
    id,
    senderId: user.id,
    debateTopicId: topic.id,
    recipientEmail: channel === "email" ? recipientEmail ?? null : null,
    recipientPhone: channel !== "email" ? recipientPhone ?? null : null,
    channel,
    note: note ?? null,
    senderAlias: senderAlias ?? null,
    status: "sent",
  });

  // Read back and respond before kicking off the fire-and-forget send below
  // — same race-avoidance reasoning as POST /whisps and POST /invites.
  const whisp = await db.select().from(debateTopicWhispsTable).where(eq(debateTopicWhispsTable.id, id)).then((r) => r[0]!);
  res.status(201).json(whisp);

  void dispatchDebateTopicWhisp(whisp, topic.topicText, getPublicAppUrl(req));
});

export default router;
