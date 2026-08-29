import { Router } from "express";
import { db, textWhispsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { excludeRemoved } from "./textWhisps";

const router = Router();

// GET /api/public/text-whisps/:token — the guest landing page's data (see
// lib/db/src/schema/text_whisps.ts's dual-path comment and
// routes/textWhisps.ts's POST /). Mirrors routes/publicInvites.ts's
// GET /invites/:token PII discipline exactly: only ever return fields safe
// to show whoever holds this link — never senderId, recipientUserId, or
// recipientPhone. Deliberately no reply endpoint here at all — guests can
// view but never reply without an account (text_whisp_replies.senderId is a
// real user id, not an anonymous flag like whisp_replies.fromRecipient, so
// there's no way to attribute an unauthenticated reply to anyone).
router.get("/text-whisps/:token", async (req, res): Promise<void> => {
  const textWhisp = await db
    .select()
    .from(textWhispsTable)
    .where(and(eq(textWhispsTable.publicToken, req.params.token), excludeRemoved()))
    .then((r) => r[0]);

  // Same identical-404 shape for "no such token" and "removed by a
  // moderator" — an admin takedown must not become an oracle telling a
  // guest which is which (same anti-enumeration posture as every other
  // public lookup in this codebase).
  if (!textWhisp) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Mark it read on first guest view, same as GET /text-whisps/:id does for
  // a fresh authenticated recipient view. Idempotent and defensive: only
  // ever moves 'sent' -> 'read', never regresses a 'replied' status — a
  // guest can't reply here at all (see the file comment above), so in
  // practice this path only ever sees 'sent', but this stays written the
  // same defensive way as the authenticated route regardless.
  if (!textWhisp.readAt) {
    await db
      .update(textWhispsTable)
      .set({ readAt: new Date(), status: textWhisp.status === "replied" ? "replied" : "read" })
      .where(eq(textWhispsTable.id, textWhisp.id));
    const refreshed = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, textWhisp.id)).then((r) => r[0]!);
    res.json({
      id: refreshed.id,
      messageText: refreshed.messageText,
      senderAlias: refreshed.senderAlias,
      status: refreshed.status,
      revealRequested: refreshed.revealRequested,
      createdAt: refreshed.createdAt,
    });
    return;
  }

  res.json({
    id: textWhisp.id,
    messageText: textWhisp.messageText,
    senderAlias: textWhisp.senderAlias,
    status: textWhisp.status,
    revealRequested: textWhisp.revealRequested,
    createdAt: textWhisp.createdAt,
  });
});

export default router;
