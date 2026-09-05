import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  // What produced this notification ("reply", "opened", "watched",
  // "appreciation", ...). Nullable because rows predating this column (and
  // admin-composed ones, which have no single event behind them) have no
  // meaningful kind. Lets a specific surface count only what belongs to it —
  // e.g. the Replies tab badge counts unread "reply" notifications rather
  // than every unread notification, which would light it up for an
  // open/watch event that has nothing to do with replies.
  kind: text("kind"),
  // Null means system-generated (e.g. lib/moderation.ts's repeated-flag
  // warning) rather than composed by an admin through POST
  // /admin/notifications — kept distinct from "attribute it to some admin"
  // so the admin audit log doesn't misrepresent who actually sent it.
  createdByAdminId: text("created_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_target_user_id_idx").on(table.targetUserId),
]);

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
}, (table) => [
  // Serves the "is this (notification, user) pair already read" joins in
  // routes/user.ts (GET /notifications, POST /notifications/:id/read) — and
  // UNIQUE so two concurrent reads (two tabs, or read-all racing a per-item
  // read) can't insert duplicate rows, which the GET's left join would then
  // return as a duplicated notification. Inserts use onConflictDoNothing.
  uniqueIndex("notification_reads_notification_id_user_id_idx").on(table.notificationId, table.userId),
  // routes/user.ts's POST /notifications/read-all also looks up every read
  // row for a user with no notificationId in the filter — not served by the
  // composite index above since userId isn't its leftmost column.
  index("notification_reads_user_id_idx").on(table.userId),
]);

export const insertNotificationReadSchema = createInsertSchema(notificationReadsTable).omit({ readAt: true });
export type InsertNotificationRead = z.infer<typeof insertNotificationReadSchema>;
export type NotificationRead = typeof notificationReadsTable.$inferSelect;
