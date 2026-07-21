import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  whisperGroupsTable,
  whisperGroupMembersTable,
  whispsTable,
  whispRepliesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { deliverWhisperLink } from "../lib/deliver";
import { categorizeWhispsAsync } from "../lib/categorizeWhisp";
import { groupHookLine } from "../lib/copy";
import { whisperLinkLimitFor } from "../lib/plans";
import { createWhispLimiter } from "../lib/rateLimit";
import { computeExpiresAt } from "../lib/expiration";

const router = Router();

const WHISPER_CHANNELS = ["email", "sms", "whatsapp"] as const;

async function requireOwnedGroup(groupId: string, ownerId: string) {
  return db
    .select()
    .from(whisperGroupsTable)
    .where(and(eq(whisperGroupsTable.id, groupId), eq(whisperGroupsTable.ownerId, ownerId)))
    .then((r) => r[0]);
}

// GET /api/whisper-groups — the sender's saved groups, with member counts
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const groups = await db
    .select({
      id: whisperGroupsTable.id,
      name: whisperGroupsTable.name,
      createdAt: whisperGroupsTable.createdAt,
      memberCount: count(whisperGroupMembersTable.id),
    })
    .from(whisperGroupsTable)
    .leftJoin(whisperGroupMembersTable, eq(whisperGroupMembersTable.groupId, whisperGroupsTable.id))
    .where(eq(whisperGroupsTable.ownerId, user.id))
    .groupBy(whisperGroupsTable.id)
    .orderBy(desc(whisperGroupsTable.createdAt));

  res.json(groups);
});

// POST /api/whisper-groups — create a group
router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = randomUUID();
  await db.insert(whisperGroupsTable).values({ id, ownerId: user.id, name: parsed.data.name });

  const group = await db.select().from(whisperGroupsTable).where(eq(whisperGroupsTable.id, id)).then((r) => r[0]);
  res.status(201).json({ ...group, memberCount: 0 });
});

// ---------------------------------------------------------------------------
// Past group sends — registered before the /:id routes so "sends" isn't
// swallowed by the :id param matcher.
// ---------------------------------------------------------------------------

// GET /api/whisper-groups/sends — one row per past group send, aggregated
router.get("/sends", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const rows = await db
    .select({
      groupSendId: whispsTable.groupSendId,
      whisperGroupId: whispsTable.whisperGroupId,
      videoUrl: sql<string>`min(${whispsTable.videoUrl})`,
      videoTitle: sql<string | null>`min(${whispsTable.videoTitle})`,
      videoThumbnail: sql<string | null>`min(${whispsTable.videoThumbnail})`,
      whisperChannel: sql<string | null>`min(${whispsTable.whisperChannel})`,
      createdAt: sql<string>`min(${whispsTable.createdAt})`,
      memberCount: count(),
      openedCount: sql<number>`count(*) filter (where ${whispsTable.openedAt} is not null)`,
      watchedCount: sql<number>`count(*) filter (where ${whispsTable.watchedAt} is not null)`,
      repliedCount: sql<number>`count(*) filter (where ${whispsTable.status} = 'replied')`,
      // Not min(status) — that's alphabetical over an unordered set of
      // labels ('delivered'/'opened'/'replied'/'scheduled'/'watched'), which
      // isn't a meaningful "worst" or "best" state. A per-member count of
      // whichever are still scheduled is the only aggregate that means
      // anything for a batch of otherwise-independent deliveries.
      scheduledCount: sql<number>`count(*) filter (where ${whispsTable.status} = 'scheduled')`,
    })
    .from(whispsTable)
    .where(and(eq(whispsTable.senderId, user.id), eq(whispsTable.deliveryMethod, "group_whisper")))
    .groupBy(whispsTable.groupSendId, whispsTable.whisperGroupId)
    .orderBy(desc(sql`min(${whispsTable.createdAt})`));

  const groupIds = [...new Set(rows.map((r) => r.whisperGroupId).filter((id): id is string => !!id))];
  const groups = groupIds.length
    ? await db.select({ id: whisperGroupsTable.id, name: whisperGroupsTable.name }).from(whisperGroupsTable).where(inArray(whisperGroupsTable.id, groupIds))
    : [];
  const groupNameById = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  res.json(rows.map((r) => ({ ...r, groupName: r.whisperGroupId ? groupNameById[r.whisperGroupId] ?? "Deleted group" : null })));
});

// GET /api/whisper-groups/sends/:groupSendId — per-member breakdown
router.get("/sends/:groupSendId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const members = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.groupSendId, req.params.groupSendId), eq(whispsTable.senderId, user.id)))
    .orderBy(desc(whispsTable.createdAt));

  if (!members.length) {
    res.status(404).json({ error: "Group send not found" });
    return;
  }

  const replies = await db
    .select()
    .from(whispRepliesTable)
    .where(inArray(whispRepliesTable.whispId, members.map((m) => m.id)));

  const repliesByWhispId: Record<string, typeof replies> = {};
  for (const reply of replies) {
    (repliesByWhispId[reply.whispId] ??= []).push(reply);
  }

  const groupName = members[0]!.whisperGroupId
    ? await db.select({ name: whisperGroupsTable.name }).from(whisperGroupsTable).where(eq(whisperGroupsTable.id, members[0]!.whisperGroupId)).then((r) => r[0]?.name ?? null)
    : null;

  res.json({
    groupSendId: req.params.groupSendId,
    groupName,
    video: {
      videoUrl: members[0]!.videoUrl,
      videoTitle: members[0]!.videoTitle,
      videoThumbnail: members[0]!.videoThumbnail,
    },
    members: members.map((m) => ({
      whispId: m.id,
      recipientEmail: m.recipientEmail,
      recipientPhone: m.recipientPhone,
      status: m.status,
      deliveredAt: m.deliveredAt,
      openedAt: m.openedAt,
      watchedAt: m.watchedAt,
      revealRequested: m.revealRequested,
      revealAccepted: m.revealAccepted,
      appreciationResponse: m.appreciationResponse,
      replies: repliesByWhispId[m.id] ?? [],
    })),
  });
});

// GET /api/whisper-groups/:id — a single group with its members
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const group = await requireOwnedGroup(req.params.id, user.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const members = await db
    .select()
    .from(whisperGroupMembersTable)
    .where(eq(whisperGroupMembersTable.groupId, group.id))
    .orderBy(desc(whisperGroupMembersTable.createdAt));

  res.json({ ...group, members });
});

// PATCH /api/whisper-groups/:id — rename
router.patch("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const group = await requireOwnedGroup(req.params.id, user.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const parsed = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.update(whisperGroupsTable).set({ name: parsed.data.name }).where(eq(whisperGroupsTable.id, group.id));
  const updated = await db.select().from(whisperGroupsTable).where(eq(whisperGroupsTable.id, group.id)).then((r) => r[0]);
  res.json(updated);
});

// DELETE /api/whisper-groups/:id — deletes the saved group + its member list.
// Past sends made with this group are untouched (whisperGroupId on those
// whisp rows just becomes an informational dangling reference, same
// simplification as everywhere else this schema doesn't enforce real FKs).
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const group = await requireOwnedGroup(req.params.id, user.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  await db.delete(whisperGroupMembersTable).where(eq(whisperGroupMembersTable.groupId, group.id));
  await db.delete(whisperGroupsTable).where(eq(whisperGroupsTable.id, group.id));
  res.status(204).send();
});

const memberInputSchema = z
  .object({
    name: z.string().max(80).nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
  })
  .refine((m) => !!m.email || !!m.phone, { message: "Each member needs an email or a phone number" });

// POST /api/whisper-groups/:id/members — add one or more members at once
// (a single manual add, or a batch from the Contact Picker's multi-select)
router.post("/:id/members", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const group = await requireOwnedGroup(req.params.id, user.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const parsed = z.object({ members: z.array(memberInputSchema).min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = parsed.data.members.map((m) => ({
    id: randomUUID(),
    groupId: group.id,
    name: m.name ?? null,
    email: m.email ?? null,
    phone: m.phone ?? null,
  }));
  await db.insert(whisperGroupMembersTable).values(rows);

  const members = await db.select().from(whisperGroupMembersTable).where(eq(whisperGroupMembersTable.groupId, group.id)).orderBy(desc(whisperGroupMembersTable.createdAt));
  res.status(201).json(members);
});

// DELETE /api/whisper-groups/:id/members/:memberId
router.delete("/:id/members/:memberId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const group = await requireOwnedGroup(req.params.id, user.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  await db.delete(whisperGroupMembersTable).where(and(eq(whisperGroupMembersTable.id, req.params.memberId), eq(whisperGroupMembersTable.groupId, group.id)));
  res.status(204).send();
});

const sendSchema = z.object({
  videoUrl: z.string().min(1),
  videoTitle: z.string().nullable().optional(),
  videoThumbnail: z.string().nullable().optional(),
  videoEmbedUrl: z.string().nullable().optional(),
  videoStartSeconds: z.number().int().min(0).nullable().optional(),
  videoPlatform: z.string().nullable().optional(),
  whisperChannel: z.enum(WHISPER_CHANNELS),
  anonymousNote: z.string().nullable().optional(),
  senderAlias: z.string().nullable().optional(),
  moodTag: z.string().nullable().optional(),
  scheduledAt: z.string().nullable().optional(),
});

// POST /api/whisper-groups/:id/send — fans out one whisp per member that has
// the contact info the chosen channel needs; members missing it are skipped
// and reported back rather than silently dropped.
router.post("/:id/send", requireAuth, createWhispLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  // createWhispLimiter's explicit Request/Response typing widens this
  // handler chain's params to Express's generic ParamsDictionary (see the
  // comment on requireAuth in lib/auth.ts) — cast back to the string this
  // route's `:id` segment actually is.
  const group = await requireOwnedGroup(req.params.id as string, user.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  const allMembers = await db.select().from(whisperGroupMembersTable).where(eq(whisperGroupMembersTable.groupId, group.id));
  const needsEmail = data.whisperChannel === "email";
  const deliverable = allMembers.filter((m) => (needsEmail ? !!m.email : !!m.phone));
  const skipped = allMembers
    .filter((m) => !(needsEmail ? !!m.email : !!m.phone))
    .map((m) => ({ id: m.id, name: m.name, reason: needsEmail ? "No email on file" : "No phone number on file" }));

  if (!deliverable.length) {
    res.status(400).json({ error: `No members in this group have ${needsEmail ? "an email" : "a phone number"} on file for that channel.` });
    return;
  }

  // Free-plan Whisper Link monthly limit applies the same way to a group
  // send as to any other Whisper Link — each member delivered counts as one.
  const limit = whisperLinkLimitFor(user.plan);
  const now = new Date();
  const resetDue = !user.whisperLinksResetAt || user.whisperLinksResetAt <= now;
  const usedThisPeriod = resetDue ? 0 : user.whisperLinksUsed;

  if (limit !== null && usedThisPeriod + deliverable.length > limit) {
    const remaining = Math.max(0, limit - usedThisPeriod);
    res.status(402).json({
      error: `Sending to this group would use ${deliverable.length} Whisper Links, but you only have ${remaining} left this month on the ${user.plan} plan. Upgrade to send to larger groups.`,
    });
    return;
  }

  if (resetDue) {
    const nextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.update(usersTable).set({ whisperLinksUsed: deliverable.length, whisperLinksResetAt: nextReset }).where(eq(usersTable.id, user.id));
  } else {
    await db.update(usersTable).set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + ${deliverable.length}` }).where(eq(usersTable.id, user.id));
  }

  const groupSendId = randomUUID();
  const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : null;
  const isScheduled = scheduledDate !== null && scheduledDate.getTime() > Date.now();
  const hookLine = groupHookLine(deliverable.length);
  const appUrl = getPublicAppUrl(req);

  const whispIds: string[] = [];
  for (const member of deliverable) {
    const id = randomUUID();
    const publicToken = randomUUID().replace(/-/g, "");
    whispIds.push(id);

    await db.insert(whispsTable).values({
      id,
      senderId: user.id,
      videoUrl: data.videoUrl,
      videoTitle: data.videoTitle ?? null,
      videoThumbnail: data.videoThumbnail ?? null,
      videoEmbedUrl: data.videoEmbedUrl ?? null,
      videoStartSeconds: data.videoStartSeconds ?? null,
      videoPlatform: data.videoPlatform ?? null,
      deliveryMethod: "group_whisper",
      whisperChannel: data.whisperChannel,
      groupSendId,
      whisperGroupId: group.id,
      recipientEmail: needsEmail ? member.email : null,
      recipientPhone: needsEmail ? null : member.phone,
      anonymousNote: data.anonymousNote ?? null,
      senderAlias: data.senderAlias ?? null,
      moodTag: data.moodTag ?? null,
      status: isScheduled ? "scheduled" : "delivered",
      publicToken,
      scheduledAt: scheduledDate,
      deliveredAt: isScheduled ? null : new Date(),
      expiresAt: isScheduled ? null : computeExpiresAt(),
    });

    if (!isScheduled) {
      deliverWhisperLink(
        { publicToken, whisperChannel: data.whisperChannel, recipientEmail: needsEmail ? member.email : null, recipientPhone: needsEmail ? null : member.phone },
        appUrl,
        hookLine,
      );
    }
  }

  void categorizeWhispsAsync(whispIds, { videoUrl: data.videoUrl, videoTitle: data.videoTitle ?? null, videoPlatform: data.videoPlatform ?? null });

  res.status(201).json({
    groupSendId,
    memberCount: deliverable.length,
    skippedMembers: skipped,
  });
});

export default router;
