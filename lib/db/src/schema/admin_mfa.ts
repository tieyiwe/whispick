import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The admin panel's own authenticator-app (TOTP) enrollment — Blind
// Whisper's second factor for admin accounts, replacing the earlier
// dependence on Clerk's twoFactorEnabled flag (the Replit-managed Clerk
// instance doesn't support MFA at all, so that gate could never be
// satisfied — see lib/adminMfa.ts).
//
// Deliberately its OWN table rather than columns on users: the users row is
// serialized wholesale in several places (GET /user/profile, the admin
// panel's own user lists/detail), and a TOTP secret must never ride along
// into any of those responses. Isolating it means no existing or future
// user-row read can leak it by accident.
export const adminMfaTable = pgTable("admin_mfa", {
  // users.id (internal id, not clerkId) — one enrollment per admin.
  userId: text("user_id").primaryKey(),
  // Base32 TOTP secret. Written at setup time, replaced only while
  // enrollment is still pending (enabledAt null) — an ACTIVE secret is
  // never silently regenerated, since that would lock the admin out of the
  // panel with no signal (see routes/adminMfa.ts).
  totpSecret: text("totp_secret").notNull(),
  // Null while enrollment is pending (secret issued, first code not yet
  // confirmed); set on the first successful verification. Only an enrolled
  // (non-null) row satisfies requireAdmin.
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  // JSON array of sha256 hex digests of the one-time backup codes, minus
  // the ones already consumed. Plaintext codes are shown exactly once, at
  // enrollment — only hashes are stored, same reasoning as any password.
  backupCodeHashes: text("backup_code_hashes").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminMfaSchema = createInsertSchema(adminMfaTable).omit({ createdAt: true });
export type InsertAdminMfa = z.infer<typeof insertAdminMfaSchema>;
export type AdminMfa = typeof adminMfaTable.$inferSelect;
