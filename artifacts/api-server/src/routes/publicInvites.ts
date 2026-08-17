import { Router } from "express";
import { db, invitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/public/invites/:token — the invite landing page's data. Mirrors
// GET /api/public/w/:token's PII discipline exactly: only ever return fields
// safe to show whoever holds this link — never inviterUserId,
// recipientEmail/Phone, or signedUpUserId. The recipient never learns who
// invited them unless the inviter later reveals themselves (see
// POST/PATCH /invites/:id/reveal), same anonymity guarantee as a whisp.
router.get("/invites/:token", async (req, res): Promise<void> => {
  const invite = await db.select().from(invitesTable).where(eq(invitesTable.publicToken, req.params.token)).then((r) => r[0]);

  if (!invite) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({
    id: invite.id,
    status: invite.status,
    revealRequested: invite.revealRequested,
    revealAccepted: invite.revealAccepted,
  });
});

export default router;
