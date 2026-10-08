import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// An append-only trail of sensitive actions an admin took — who did what,
// to what, and when. Distinct from moderation_flags.ts (content-safety
// FINDINGS awaiting review) and from a user's own activity timeline
// (routes/admin.ts's GET /users/:id/whisps, their own content) — this table
// is specifically ADMIN-side accountability: bans, role changes, content
// takedowns, and the new content-posting agents' config changes, so a
// second admin (or a later investigation) can see exactly what happened
// without trusting memory or chat logs. Never deleted or edited once
// written — see lib/adminAudit.ts, the only writer.
export const adminAuditLogTable = pgTable("admin_audit_log", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  action: text("action").notNull(), // e.g. 'user.ban', 'user.role_change', 'content.remove', 'debate_agent.config_update'
  targetType: text("target_type"), // e.g. 'user', 'whisp', 'debate_topic' — null for actions with no single target (e.g. a config change)
  targetId: text("target_id"),
  // Freeform action-specific detail (e.g. { from: "user", to: "admin" } for
  // a role change) — every writer decides its own shape; this table makes
  // no assumptions about it beyond "JSON, small."
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("admin_audit_log_created_at_idx").on(table.createdAt),
  index("admin_audit_log_admin_user_id_idx").on(table.adminUserId),
  index("admin_audit_log_target_idx").on(table.targetType, table.targetId),
]);

export type AdminAuditLog = typeof adminAuditLogTable.$inferSelect;
