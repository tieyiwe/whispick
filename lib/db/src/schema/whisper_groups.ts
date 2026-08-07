import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A reusable, sender-owned list of contacts (not Blind Whisper accounts — just
// names/emails/phones, like a saved address-book group) that a Group Whisper
// send can target all at once. Saved independently of any particular send —
// editing membership later doesn't change who received a past send (see
// whisps.groupSendId/whisperGroupId).
export const whisperGroupsTable = pgTable("whisper_groups", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhisperGroupSchema = createInsertSchema(whisperGroupsTable).omit({ createdAt: true });
export type InsertWhisperGroup = z.infer<typeof insertWhisperGroupSchema>;
export type WhisperGroup = typeof whisperGroupsTable.$inferSelect;

export const whisperGroupMembersTable = pgTable("whisper_group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  name: text("name"),
  // At least one of email/phone is required at the application layer (which
  // one actually gets used at send time depends on the channel the sender
  // picks — same as a regular Whisper Link recipient).
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhisperGroupMemberSchema = createInsertSchema(whisperGroupMembersTable).omit({ createdAt: true });
export type InsertWhisperGroupMember = z.infer<typeof insertWhisperGroupMemberSchema>;
export type WhisperGroupMember = typeof whisperGroupMembersTable.$inferSelect;
