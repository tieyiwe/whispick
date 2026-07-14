import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
});

export const insertCircleMemberSchema = createInsertSchema(circleMembersTable).omit({ joinedAt: true });
export type InsertCircleMember = z.infer<typeof insertCircleMemberSchema>;
export type CircleMember = typeof circleMembersTable.$inferSelect;
