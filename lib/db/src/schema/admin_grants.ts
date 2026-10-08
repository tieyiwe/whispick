import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Collaborator access to the admin HQ: the owner (ADMIN_EMAILS bootstrap —
// implicitly holds every permission and is the only one who can manage
// these rows) invites a collaborator by EMAIL with a chosen set of
// feature-area permissions. Keyed by email rather than userId so an invite
// can precede the account: the moment a user with that email exists (signs
// up, or their placeholder email heals), ensureUser promotes them to the
// admin role and links the grant. requireAdmin then scopes every /admin
// request to the grant's permissions (lib/adminAuth.ts).
export const adminGrantsTable = pgTable("admin_grants", {
  id: text("id").primaryKey(),
  // Always stored lowercased — matching happens against users.email.
  email: text("email").notNull(),
  // Filled when the grant attaches to a real account.
  userId: text("user_id"),
  // Display title for the staff role this grant represents ("Admin",
  // "Content Manager", "Moderator", "Assistant", "Contributor", or a
  // custom label). Presentation + preset bookkeeping only — enforcement
  // reads ONLY the permissions array below, so renaming a role never
  // silently changes anyone's access.
  roleTitle: text("role_title").notNull().default("Staff"),
  // JSON array of permission keys — see ALL_ADMIN_PERMISSIONS in
  // lib/adminAuth.ts for the valid set.
  permissions: text("permissions").notNull().default("[]"),
  invitedByAdminId: text("invited_by_admin_id").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("admin_grants_email_unique").on(table.email),
  index("admin_grants_user_id_idx").on(table.userId),
]);

export const insertAdminGrantSchema = createInsertSchema(adminGrantsTable).omit({ createdAt: true });
export type InsertAdminGrant = z.infer<typeof insertAdminGrantSchema>;
export type AdminGrant = typeof adminGrantsTable.$inferSelect;
