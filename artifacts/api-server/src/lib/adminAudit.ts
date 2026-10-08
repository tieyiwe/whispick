import { db, adminAuditLogTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";

// Fire-and-forget on purpose, same posture as this app's other "record what
// happened" side effects (e.g. push.ts's notifyUserPersisted) — a logging
// failure must never block or fail the admin action it's describing.
export function logAdminAction(
  adminUserId: string,
  action: string,
  target?: { type: string; id: string },
  metadata?: Record<string, unknown>,
): void {
  void db
    .insert(adminAuditLogTable)
    .values({
      id: randomUUID(),
      adminUserId,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      metadata: metadata ?? null,
    })
    .catch((err) => logger.error({ err, adminUserId, action }, "Failed to write admin audit log entry"));
}

export async function listAdminAuditLog(opts: { page: number; pageSize: number; adminUserId?: string; targetType?: string }) {
  const conditions = [];
  if (opts.adminUserId) conditions.push(eq(adminAuditLogTable.adminUserId, opts.adminUserId));
  if (opts.targetType) conditions.push(eq(adminAuditLogTable.targetType, opts.targetType));
  const where = conditions.length ? and(...conditions) : undefined;

  const items = await db
    .select()
    .from(adminAuditLogTable)
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);

  return items;
}
