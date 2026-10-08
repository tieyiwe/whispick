import { db, uploadedVideosTable, usersTable } from "@workspace/db";
import { eq, and, lte, isNull } from "drizzle-orm";
import { deleteObject } from "./objectStorage";
import { sendEmail, mediaExpiringEmailHtml, mediaExpiredEmailHtml } from "./email";
import { notifyUserPersisted } from "./push";
import { UPLOAD_DELETION_WARNING_DAYS } from "./uploads";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // retention is day-granularity — hourly is plenty
// Same bounded-sweep reasoning as lib/scheduler.ts's BATCH_LIMIT — both
// sweeps below loop sequentially (a real email/push per row here, a real
// object-storage delete there). Leftover rows are picked up next hour.
const BATCH_LIMIT = 200;

// Phases out uploaded originals on a fixed schedule (see lib/uploads.ts):
// warns the owner a couple of days before deletion, then actually deletes
// the bytes from object storage once expiresAt passes (the DB row stays,
// flipped to 'expired', so any whisp that referenced it keeps a resolvable —
// if now-410ing — reference instead of a dangling one).
export function startMediaRetentionScheduler(): void {
  setInterval(async () => {
    try {
      await warnUpcomingDeletions();
      await deleteExpiredMedia();
    } catch (err) {
      logger.error({ err }, "Media retention sweep failed");
      reportSystemError(err, "scheduler:mediaRetentionScheduler");
    }
  }, POLL_INTERVAL_MS);
}

async function warnUpcomingDeletions(): Promise<void> {
  const warningCutoff = new Date(Date.now() + UPLOAD_DELETION_WARNING_DAYS * 24 * 60 * 60 * 1000);

  const due = await db
    .select()
    .from(uploadedVideosTable)
    .where(
      and(
        eq(uploadedVideosTable.status, "ready"),
        isNull(uploadedVideosTable.deletionWarnedAt),
        lte(uploadedVideosTable.expiresAt, warningCutoff),
      ),
    )
    .limit(BATCH_LIMIT);

  // No per-request Host header out here (same reason lib/scheduler.ts and
  // lib/reminderScheduler.ts require this explicitly), so the push
  // notification's deep link needs an explicit override to be worth sending.
  const appUrl = process.env.PUBLIC_APP_URL;

  for (const media of due) {
    const owner = await db.select().from(usersTable).where(eq(usersTable.id, media.ownerId)).then((r) => r[0]);
    if (owner?.email) {
      void sendEmail(
        owner.email,
        "Your uploaded video is about to be removed",
        mediaExpiringEmailHtml(media.originalFilename, media.expiresAt),
        { whispId: null, purpose: "media_expiring" },
      );
    }
    if (owner && appUrl) {
      void notifyUserPersisted(
        owner.id,
        "Video expiring soon",
        `"${media.originalFilename}" will be removed from your Media Library soon.`,
        "/media-library",
      );
    }
    await db
      .update(uploadedVideosTable)
      .set({ deletionWarnedAt: new Date() })
      .where(eq(uploadedVideosTable.id, media.id));
  }

  if (due.length > 0) {
    logger.info({ count: due.length }, "Warned owners of upcoming media deletions");
  }
}

async function deleteExpiredMedia(): Promise<void> {
  const due = await db
    .select()
    .from(uploadedVideosTable)
    .where(and(eq(uploadedVideosTable.status, "ready"), lte(uploadedVideosTable.expiresAt, new Date())))
    .limit(BATCH_LIMIT);

  // Same PUBLIC_APP_URL gate warnUpcomingDeletions uses above, kept for
  // consistency even though notifyUserPersisted's own url param here is
  // always relative — every other scheduler-emitted notification in this
  // codebase is gated the same way.
  const appUrl = process.env.PUBLIC_APP_URL;

  for (const media of due) {
    await deleteObject(media.objectKey);
    if (media.thumbnailObjectKey) await deleteObject(media.thumbnailObjectKey);

    await db
      .update(uploadedVideosTable)
      .set({ status: "expired", deletedAt: new Date() })
      .where(eq(uploadedVideosTable.id, media.id));

    // Distinct from warnUpcomingDeletions' "about to expire" notice above —
    // this one fires once the video is actually gone, so the owner isn't
    // left wondering why "Whisp It" quietly stopped working on something
    // they saw in their library days ago and forgot about.
    const owner = await db.select().from(usersTable).where(eq(usersTable.id, media.ownerId)).then((r) => r[0]);
    if (owner?.email) {
      void sendEmail(owner.email, "Your uploaded video has been removed", mediaExpiredEmailHtml(media.originalFilename), {
        whispId: null,
        purpose: "media_expired",
      });
    }
    if (owner && appUrl) {
      void notifyUserPersisted(
        owner.id,
        "Video removed",
        `"${media.originalFilename}" has been removed from your Media Library.`,
        "/media-library",
      );
    }
  }

  if (due.length > 0) {
    logger.info({ count: due.length }, "Phased out expired uploaded videos");
  }
}
