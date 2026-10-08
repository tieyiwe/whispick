import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The policy re-consent system: when the Privacy Policy or Terms of Service
// materially changes, an admin drafts a version here (a short summary of
// what changed — the full text itself lives on the /privacy and /terms
// pages), then hits Publish. From that moment every signed-in user is
// prompted — live in the app, on refresh, or at next login — to review and
// agree; who agreed to what, and when, is the policy_acceptances table
// below. Versions are append-only history: a published version is never
// edited (the record of what users agreed to must stay exactly what they
// saw), a correction is a new version.
export const policyVersionsTable = pgTable("policy_versions", {
  id: text("id").primaryKey(),
  docType: text("doc_type").notNull(), // 'privacy' | 'terms'
  // The short, user-facing "what changed" message shown in the consent
  // prompt — not the policy text itself.
  summary: text("summary").notNull(),
  // Null = draft (visible only in the admin panel). Set by the Publish
  // action, at which point the prompt goes live for every user and the
  // version becomes immutable.
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdByAdminId: text("created_by_admin_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // "Latest published version per docType" — the query behind every
  // user's pending-consent check.
  index("policy_versions_doc_type_published_at_idx").on(table.docType, table.publishedAt),
]);

export const insertPolicyVersionSchema = createInsertSchema(policyVersionsTable).omit({ createdAt: true });
export type InsertPolicyVersion = z.infer<typeof insertPolicyVersionSchema>;
export type PolicyVersion = typeof policyVersionsTable.$inferSelect;

// One row per (user, published version) once that user has clicked Agree —
// the durable consent record. Unique so a double-click can't create two
// rows, and so "has this user accepted this version" is a single indexed
// lookup.
export const policyAcceptancesTable = pgTable("policy_acceptances", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  policyVersionId: text("policy_version_id").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("policy_acceptances_user_version_unique").on(table.userId, table.policyVersionId),
  index("policy_acceptances_user_id_idx").on(table.userId),
]);

export const insertPolicyAcceptanceSchema = createInsertSchema(policyAcceptancesTable).omit({ acceptedAt: true });
export type InsertPolicyAcceptance = z.infer<typeof insertPolicyAcceptanceSchema>;
export type PolicyAcceptance = typeof policyAcceptancesTable.$inferSelect;
