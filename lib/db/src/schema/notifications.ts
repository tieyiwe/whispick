import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-composed, persistent in-app notifications — distinct from the
// ephemeral push notifications in lib/push.ts (opt-in, only reach a user
// who's subscribed and online right then). targetUserId null means a
// broadcast to every user; set it for a one-to-one notification. Read state
// lives in notificationReadsTable (below) rather than a column here, since a
// broadcast row is shared by every recipient and each needs their own
// read/unread state.
export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey(),
  targetUserId: text("target_user_id"), // null = broadcast to all users
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"), // optional in-app link the notification points at
  // Null means system-generated (e.g. lib/moderation.ts's repeated-flag
  // warning) rather than composed by an admin through POST
  // /admin/notifications — kept distinct from "attribute it to some admin"
  // so the admin audit log doesn't misrepresent who actually sent it.
  createdByAdminId: text("created_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

// One row per (notification, user) once that user has read it — presence of
// a row means read. Kept separate from notificationsTable instead of a
// per-notification readAt column so a single broadcast row can be read by
// one user without affecting anyone else's unread state.
export const notificationReadsTable = pgTable("notification_reads", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").notNull(),
  userId: text("user_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationReadSchema = createInsertSchema(notificationReadsTable).omit({ readAt: true });
export type InsertNotificationRead = z.infer<typeof insertNotificationReadSchema>;
export type NotificationRead = typeof notificationReadsTable.$inferSelect;
