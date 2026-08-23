import { Router, type IRouter } from "express";
import { db, textWhispsTable, usersTable, type User } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../lib/adminAuth";
import { logAdminAction } from "../lib/adminAudit";
import { deliverInApp } from "../lib/deliver";
import { ensureSystemAgentUser } from "../lib/systemUser";
import { listStaff } from "../lib/staff";

const router: IRouter = Router();

// Admin Text Whisp tools — the same "/admin" base path, separate file
// (pattern shared with adminProjects.ts): /api/admin/text-whisps/broadcast
// and /api/admin/text-whisps/to-staff. Gated by "notifications" — sending a
// platform-wide message is the same class of action as the existing
// POST /admin/notifications broadcast, just delivered as a Text Whisp
// instead of a bell notification.
router.use(requireAdmin);
router.use(requirePermission("notifications"));

// Keep in sync with routes/textWhisps.ts's own MESSAGE_MAX_LENGTH — both
// bound the same textWhisps.messageText column for the same UI reason
// (fits without scrolling in the Text Whisp thread view).
const MESSAGE_MAX_LENGTH = 260;

// These rows always have a real recipientUserId (never a guessed phone), so
// delivery is always in-app only — recipientPhone is NOT NULL on the table,
// but has no delivery role here; it's informational only, filled from the
// user's own number when on file so support/admin can still see it.
function internalRecipientPhone(user: { id: string; phone: string | null }): string {
  return user.phone ?? `internal:${user.id}`;
}

// Takes the recipient's phone already resolved by the caller — broadcasts
// fan out to potentially every user on the platform, and re-querying the
// same row per recipient here would turn that into an N+1.
async function createInternalTextWhisp(opts: {
  senderId: string;
  recipientUserId: string;
  recipientPhone: string | null;
  senderAlias: string;
  messageText: string;
  source: "admin";
}): Promise<string> {
  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");
  await db.insert(textWhispsTable).values({
    id,
    senderId: opts.senderId,
    recipientUserId: opts.recipientUserId,
    recipientPhone: internalRecipientPhone({ id: opts.recipientUserId, phone: opts.recipientPhone }),
    publicToken,
    senderAlias: opts.senderAlias,
    messageText: opts.messageText,
    status: "sent",
    source: opts.source,
  });
  void deliverInApp(opts.recipientUserId, "You have a new Text Whisp", opts.senderAlias, `/text-whisps/${id}`, opts.recipientPhone ?? "(no phone on file)", {
    whispId: null,
    purpose: "text_whisp",
  });
  return id;
}

const broadcastSchema = z.object({
  messageText: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
  audience: z.enum(["all", "selected"]),
  userIds: z.array(z.string().max(64)).max(5000).optional(),
});

// POST /api/admin/text-whisps/broadcast — a platform Text Whisp to every
// user or a chosen set. Always sent from the reserved system account (see
// lib/systemUser.ts), not the acting admin — same reasoning as Town
// Crier/Circle Scout content: "3 topics a day" shouldn't make every topic
// look like something one specific staffer personally wrote, and a platform
// broadcast shouldn't be attributed to whichever admin happened to click
// Send. Deliberately NOT anonymous to the recipient — senderAlias says who
// this really is, unlike a normal person-to-person Text Whisp.
router.post("/broadcast", async (req: any, res): Promise<void> => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.audience === "selected" && !parsed.data.userIds?.length) {
    res.status(400).json({ error: "Pick at least one recipient, or choose \"All users\"." });
    return;
  }

  const system = await ensureSystemAgentUser();
  const targets =
    parsed.data.audience === "all"
      ? await db.select({ id: usersTable.id, phone: usersTable.phone }).from(usersTable)
      : await db
          .select({ id: usersTable.id, phone: usersTable.phone })
          .from(usersTable)
          .where(inArray(usersTable.id, [...new Set(parsed.data.userIds!)]));

  for (const target of targets) {
    if (target.id === system.id) continue; // never message the reserved account itself
    await createInternalTextWhisp({
      senderId: system.id,
      recipientUserId: target.id,
      recipientPhone: target.phone,
      senderAlias: "Blind Whisper Team",
      messageText: parsed.data.messageText,
      source: "admin",
    });
  }

  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "text_whisp.broadcast", { type: "text_whisp", id: "batch" }, { audience: parsed.data.audience, recipientCount: targets.length });

  res.status(201).json({ recipientCount: targets.length });
});

const toStaffSchema = z.object({
  recipientAdminId: z.string().max(64),
  messageText: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

// POST /api/admin/text-whisps/to-staff — one staff member reaching a
// colleague directly by account, skipping the phone-number lookup a normal
// Text Whisp needs (staff already know each other; no need to pretend
// otherwise). Sent from the ACTING admin's own account, not the system
// user — unlike a broadcast, this is genuinely one named colleague writing
// to another, and they should be able to tell who.
router.post("/to-staff", async (req: any, res): Promise<void> => {
  const parsed = toStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const adminUser = req.adminUser as User;
  if (parsed.data.recipientAdminId === adminUser.id) {
    res.status(400).json({ error: "You can't Text Whisp yourself." });
    return;
  }

  const staff = await listStaff();
  if (!staff.some((s) => s.id === parsed.data.recipientAdminId)) {
    res.status(400).json({ error: "That's not a current staff member." });
    return;
  }
  const recipient = await db.select({ phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, parsed.data.recipientAdminId)).then((r) => r[0]!);

  const id = await createInternalTextWhisp({
    senderId: adminUser.id,
    recipientUserId: parsed.data.recipientAdminId,
    recipientPhone: recipient.phone,
    senderAlias: adminUser.fullName || adminUser.email,
    messageText: parsed.data.messageText,
    source: "admin",
  });

  logAdminAction(adminUser.id, "text_whisp.to_staff", { type: "text_whisp", id }, { recipientAdminId: parsed.data.recipientAdminId });

  res.status(201).json({ id });
});

export default router;
