import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  whisperGroupsTable,
  whisperGroupMembersTable,
  whispsTable,
  whispRepliesTable,
  usersTable,
  uploadedVideosTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { deliverWhisperLink, findVerifiedRecipient, findVerifiedRecipientByEmail } from "../lib/deliver";
import { categorizeWhispsAsync } from "../lib/categorizeWhisp";
import { moderateWhispAsync } from "../lib/moderation";
import { needsDemographics } from "../lib/demographics";
import { groupHookLine } from "../lib/copy";
import { whisperLinkLimitFor } from "../lib/plans";
import { createWhispLimiter } from "../lib/rateLimit";
import { computeExpiresAt, MAX_SCHEDULE_DAYS } from "../lib/expiration";
import { MAX_SCHEDULE_DAYS_WITH_UPLOAD } from "../lib/uploads";
import { httpUrlString } from "../lib/safeUrl";
import { deriveVideoFields } from "../lib/videoMeta";
import { consentedPhones, recordSmsConsent } from "../lib/smsConsent";

const router = Router();

const WHISPER_CHANNELS = ["email", "sms", "whatsapp"] as const;

// POST /:id/send fans out one real Whisper Link (a Twilio/Resend send, or an
// in-app delivery) per deliverable member in a single request — and unlike
// every other real-cost action in this app, that fan-out isn't bounded by
// createWhispLimiter (which only counts requests, 30/hour, not recipients
// per request) or by the free-plan Whisper Link cap (spark/ember are
// unlimited — see lib/plans.ts's PLAN_LIMITS). POST /:id/members only caps
// a single call at 200, but nothing stops calling it repeatedly to build an
// unbounded group over time. Capping total group size here is what actually
// bounds a single POST /:id/send's real-world cost and blast radius.
const MAX_GROUP_MEMBERS = 500;

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
      videoPlatform: members[0]!.videoPlatform,
      uploadedVideoId: members[0]!.uploadedVideoId,
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

  const existingCountRow = await db
    .select({ count: count() })
    .from(whisperGroupMembersTable)
    .where(eq(whisperGroupMembersTable.groupId, group.id))
    .then((r) => r[0]);
  const existingCount = existingCountRow?.count ?? 0;
  if (existingCount + parsed.data.members.length > MAX_GROUP_MEMBERS) {
    res.status(400).json({
      error: `A group can have at most ${MAX_GROUP_MEMBERS} members — this group has ${existingCount} and adding ${parsed.data.members.length} more would go over.`,
    });
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

const sendSchema = z
  .object({
    // httpUrlString, not plain string — same stored-XSS guard as the single
    // whisp composer (see routes/whisps.ts).
    videoUrl: httpUrlString.nullable().optional(),
    videoTitle: z.string().max(300).nullable().optional(),
    videoThumbnail: httpUrlString.nullable().optional(),
    videoEmbedUrl: httpUrlString.nullable().optional(),
    videoStartSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    // min(1), not min(0): an end trim of 0 seconds is meaningless (no clip
    // has zero length) and the falsy 0 would otherwise slip past a
    // `!data.videoEndSeconds` check further down as if unset.
    videoEndSeconds: z.number().int().min(1).max(86400).nullable().optional(),
    videoPlatform: z.string().nullable().optional(),
    uploadedVideoId: z.string().nullable().optional(),
    whisperChannel: z.enum(WHISPER_CHANNELS),
    anonymousNote: z.string().nullable().optional(),
    senderAlias: z.string().nullable().optional(),
    moodTag: z.string().nullable().optional(),
    scheduledAt: z.string().nullable().optional(),
    // Same server-enforced consent gate as POST /whisps — see its own
    // schema comment. A Group Whisper fans out to every member's own phone
    // number, so this matters just as much here.
    smsConsentConfirmed: z.boolean().nullable().optional(),
  })
  .refine((data) => !!data.videoUrl || !!data.uploadedVideoId, {
    message: "A video URL or an uploaded video is required",
  })
  .refine(
    (data) => data.videoEndSeconds == null || data.videoStartSeconds == null || data.videoEndSeconds > data.videoStartSeconds,
    { message: "The end time must be after the start time" },
  );

// POST /api/whisper-groups/:id/send — fans out one whisp per member that has
// the contact info the chosen channel needs; members missing it are skipped
// and reported back rather than silently dropped.
router.post("/:id/send", requireAuth, createWhispLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  // Same one-time demographic confirmation gate as POST /whisps — see
  // lib/demographics.ts.
  if (needsDemographics(user)) {
    res.status(428).json({ error: "Please confirm your gender, age range, and preferred language before sending your first whisp.", code: "demographics_required" });
    return;
  }

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

  let uploadedVideo: typeof uploadedVideosTable.$inferSelect | null = null;
  if (data.uploadedVideoId) {
    const media = await db
      .select()
      .from(uploadedVideosTable)
      .where(and(eq(uploadedVideosTable.id, data.uploadedVideoId), eq(uploadedVideosTable.ownerId, user.id)))
      .then((r) => r[0]);
    if (!media || media.status !== "ready") {
      res.status(400).json({ error: "That uploaded video is no longer available" });
      return;
    }
    uploadedVideo = media;
  }

  // Validated before any quota is spent below, so a rejected schedule never
  // costs the sender their Whisper Link allowance for this batch.
  const scheduledDateCheck = data.scheduledAt ? new Date(data.scheduledAt) : null;
  // Unparseable dates must be rejected here too — Invalid Date skips the
  // window check (NaN comparisons are false) and then crashes the inserts
  // AFTER the whole batch's quota was spent.
  if (scheduledDateCheck && Number.isNaN(scheduledDateCheck.getTime())) {
    res.status(400).json({ error: "That schedule date isn't valid." });
    return;
  }
  if (scheduledDateCheck !== null && scheduledDateCheck.getTime() > Date.now()) {
    const maxDays = uploadedVideo ? MAX_SCHEDULE_DAYS_WITH_UPLOAD : MAX_SCHEDULE_DAYS;
    const maxDate = new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000);
    if (scheduledDateCheck.getTime() > maxDate.getTime()) {
      res.status(400).json({
        error: uploadedVideo
          ? `An uploaded video can only be scheduled up to ${maxDays} days out, so it doesn't expire before it's sent.`
          : `Please schedule within ${maxDays} days.`,
      });
      return;
    }
    // Also measure against the upload's OWN remaining life (media uploaded
    // six days ago phases out tomorrow) — recipients need their full 48-hour
    // window before the bytes are deleted. Same rule as routes/whisps.ts.
    if (uploadedVideo?.expiresAt && scheduledDateCheck.getTime() > uploadedVideo.expiresAt.getTime() - 48 * 60 * 60 * 1000) {
      res.status(400).json({
        error: "That upload is close to phasing out — schedule it sooner, or re-upload the video for a fresh 7-day window.",
      });
      return;
    }
  }

  const allMembers = await db.select().from(whisperGroupMembersTable).where(eq(whisperGroupMembersTable.groupId, group.id));
  const needsEmail = data.whisperChannel === "email";
  const deliverable = allMembers.filter((m) => (needsEmail ? !!m.email : !!m.phone));

  // Once-per-recipient SMS consent, per member phone (see lib/smsConsent.ts).
  // The checkbox is required only when at least one deliverable member's
  // number hasn't been consented before; an affirmative checkbox covers all
  // of them at once. Consent for every deliverable number is then recorded
  // below so a later group send (or a 1:1 send to the same person) skips it.
  if (data.whisperChannel === "sms") {
    const memberPhones = deliverable.map((m) => m.phone!).filter(Boolean);
    if (!data.smsConsentConfirmed) {
      const consented = new Set(await consentedPhones(user.id, memberPhones));
      const anyNew = memberPhones.some((p) => !consented.has(p));
      if (anyNew) {
        res.status(400).json({ error: "Please confirm you have this group's members' permission to receive a text from you.", code: "sms_consent_required" });
        return;
      }
    } else {
      for (const p of memberPhones) void recordSmsConsent(user.id, p);
    }
  }
  const skipped = allMembers
    .filter((m) => !(needsEmail ? !!m.email : !!m.phone))
    .map((m) => ({ id: m.id, name: m.name, reason: needsEmail ? "No email on file" : "No phone number on file" }));

  if (!deliverable.length) {
    res.status(400).json({ error: `No members in this group have ${needsEmail ? "an email" : "a phone number"} on file for that channel.` });
    return;
  }

  // Free-plan Whisper Link monthly limit applies the same way to a group
  // send as to any other Whisper Link — each member delivered counts as one.
  // Like the single-send path (routes/whisps.ts), the check-and-increment is
  // one atomic UPDATE so concurrent group sends can't each pass a stale
  // under-limit read and collectively blow past the cap.
  const limit = whisperLinkLimitFor(user.plan);
  const now = new Date();
  const resetDue = !user.whisperLinksResetAt || user.whisperLinksResetAt <= now;
  const usedThisPeriod = resetDue ? 0 : user.whisperLinksUsed;

  if (resetDue) {
    // First send of a fresh window — the running count is 0, but the limit
    // still applies to this send's own size.
    if (limit !== null && deliverable.length > limit) {
      res.status(402).json({
        error: `Sending to this group would use ${deliverable.length} Whisper Links, but the ${user.plan} plan allows ${limit} per month. Upgrade to send to larger groups.`,
      });
      return;
    }
    const nextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.update(usersTable).set({ whisperLinksUsed: deliverable.length, whisperLinksResetAt: nextReset }).where(eq(usersTable.id, user.id));
  } else if (limit === null) {
    await db.update(usersTable).set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + ${deliverable.length}` }).where(eq(usersTable.id, user.id));
  } else {
    const incremented = await db
      .update(usersTable)
      .set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + ${deliverable.length}` })
      .where(and(eq(usersTable.id, user.id), sql`${usersTable.whisperLinksUsed} + ${deliverable.length} <= ${limit}`))
      .returning({ id: usersTable.id });
    if (incremented.length === 0) {
      const remaining = Math.max(0, limit - usedThisPeriod);
      res.status(402).json({
        error: `Sending to this group would use ${deliverable.length} Whisper Links, but you only have ${remaining} left this month on the ${user.plan} plan. Upgrade to send to larger groups.`,
      });
      return;
    }
  }

  const groupSendId = randomUUID();
  const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : null;
  const isScheduled = scheduledDate !== null && scheduledDate.getTime() > Date.now();
  const hookLine = groupHookLine(deliverable.length);
  const appUrl = getPublicAppUrl(req);

  const effectiveVideoUrl = uploadedVideo ? `upload:${uploadedVideo.id}` : data.videoUrl!;
  const effectiveVideoTitle = data.videoTitle ?? uploadedVideo?.originalFilename ?? null;
  // Derived server-side, not taken from the client — see routes/whisps.ts and
  // lib/videoMeta.ts deriveVideoFields for why the thumbnail/embed/platform
  // must never be attacker-controlled.
  const derived = uploadedVideo ? null : deriveVideoFields(data.videoUrl!, data.videoThumbnail);
  const effectiveVideoEmbedUrl = uploadedVideo ? null : derived!.embedUrl;
  const effectiveVideoPlatform = uploadedVideo ? "upload" : derived!.platform;

  // An immediate group send near the end of an upload's retention would have
  // its bytes deleted mid-way through the recipients' 48-hour windows —
  // extend the media's life to cover them (same rule as routes/whisps.ts).
  if (uploadedVideo?.expiresAt && !isScheduled) {
    const needUntil = new Date(Date.now() + 49 * 60 * 60 * 1000);
    if (uploadedVideo.expiresAt.getTime() < needUntil.getTime()) {
      await db.update(uploadedVideosTable).set({ expiresAt: needUntil }).where(eq(uploadedVideosTable.id, uploadedVideo.id));
    }
  }

  const whispIds: string[] = [];
  for (const member of deliverable) {
    const id = randomUUID();
    const publicToken = randomUUID().replace(/-/g, "");
    whispIds.push(id);

    // Token-scoped (not media-id-scoped) so it resolves for ANY viewer, not
    // just the sender — see the identical comment in routes/whisps.ts. Each
    // member's whisp gets its own token, all pointing at the same bytes.
    const effectiveVideoThumbnail = uploadedVideo
      ? uploadedVideo.thumbnailObjectKey
        ? `/api/public/w/${publicToken}/media/thumbnail`
        : null
      : derived!.thumbnail;

    // Same insert-time match as routes/whisps.ts's single-send POST / — see
    // whisps.recipientUserId's own comment for why this is looked up once
    // here rather than left to deliverWhisperLink's internal (delivery-time
    // only, never persisted) matching.
    // Non-null assertions are safe here: `deliverable` (above) already
    // filtered to members that have the field this channel needs.
    const recipientUserId = needsEmail
      ? (await findVerifiedRecipientByEmail(member.email!))?.id ?? null
      : (await findVerifiedRecipient(member.phone!))?.id ?? null;

    await db.insert(whispsTable).values({
      id,
      senderId: user.id,
      videoUrl: effectiveVideoUrl,
      videoTitle: effectiveVideoTitle,
      videoThumbnail: effectiveVideoThumbnail,
      videoEmbedUrl: effectiveVideoEmbedUrl,
      videoStartSeconds: data.videoStartSeconds ?? null,
      videoEndSeconds: data.videoEndSeconds ?? null,
      videoPlatform: effectiveVideoPlatform,
      uploadedVideoId: uploadedVideo?.id ?? null,
      deliveryMethod: "group_whisper",
      whisperChannel: data.whisperChannel,
      groupSendId,
      whisperGroupId: group.id,
      recipientEmail: needsEmail ? member.email : null,
      recipientPhone: needsEmail ? null : member.phone,
      recipientUserId,
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
      void deliverWhisperLink(
        { id, publicToken, whisperChannel: data.whisperChannel, recipientEmail: needsEmail ? member.email : null, recipientPhone: needsEmail ? null : member.phone },
        appUrl,
        hookLine,
      );
    }
  }

  void categorizeWhispsAsync(whispIds, { videoUrl: effectiveVideoUrl, videoTitle: effectiveVideoTitle, videoPlatform: effectiveVideoPlatform });

  // Every member's whisp in this send carries the same video/note, so one
  // classification covers the whole batch — flagging it against each
  // member's own whisp id would multiply the same content into N flags for
  // this sender and unfairly inflate their warning count for a single send.
  if (whispIds[0]) {
    void moderateWhispAsync({
      id: whispIds[0],
      senderId: user.id,
      videoUrl: effectiveVideoUrl,
      videoTitle: effectiveVideoTitle,
      videoPlatform: effectiveVideoPlatform,
      anonymousNote: data.anonymousNote ?? null,
    });
  }

  res.status(201).json({
    groupSendId,
    memberCount: deliverable.length,
    skippedMembers: skipped,
  });
});

export default router;
