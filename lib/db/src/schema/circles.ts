import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const circlesTable = pgTable("circles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull(),
  inviteCode: text("invite_code").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCircleSchema = createInsertSchema(circlesTable).omit({ createdAt: true });
export type InsertCircle = z.infer<typeof insertCircleSchema>;
export type Circle = typeof circlesTable.$inferSelect;

export const circleMembersTable = pgTable("circle_members", {
  id: text("id").primaryKey(),
  circleId: text("circle_id").notNull(),
  userId: text("user_id").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // "is this user a member of this circle" membership checks (routes/circles.ts, routes/whisps.ts).
  index("circle_members_circle_id_user_id_idx").on(table.circleId, table.userId),
  // "every circle this user belongs to" (routes/circles.ts) and cascading
  // deletes on account removal (routes/admin.ts) both filter by userId
  // alone — not served by the composite index above.
  index("circle_members_user_id_idx").on(table.userId),
]);

export const insertCircleMemberSchema = createInsertSchema(circleMembersTable).omit({ joinedAt: true });
export type InsertCircleMember = z.infer<typeof insertCircleMemberSchema>;
export type CircleMember = typeof circleMembersTable.$inferSelect;
