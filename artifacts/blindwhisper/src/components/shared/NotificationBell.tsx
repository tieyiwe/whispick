import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetMyNotifications,
  useGetMyUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getGetMyNotificationsQueryKey,
  getGetMyUnreadNotificationCountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

// The persistent, in-app counterpart to push notifications (see
// lib/push.ts server-side) — a bell with an unread badge, shown in both the
// desktop sidebar and mobile header of AppLayout. Polls on an interval
// rather than websockets, matching the rest of this app's "no realtime
// infra" posture.
export function NotificationBell() {
  const { t } = useTranslation("sharedB");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useGetMyNotifications({
    query: { queryKey: getGetMyNotificationsQueryKey(), refetchInterval: 60_000 },
  });
  // The dot comes from the dedicated count endpoint, NOT from the list's own
  // unreadCount. That one is computed by filtering the rows it returns, and
  // that query is capped at 50 — so a user whose 50 newest notifications were
  // all read got a count of zero while older unread ones sat there, and the
  // bell showed nothing. This endpoint counts across every row.
  const { data: unread } = useGetMyUnreadNotificationCount({
    query: {
      queryKey: getGetMyUnreadNotificationCountQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = unread?.unreadCount ?? 0;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
    // Without this the dot survived its own dismissal — marking everything
    // read refreshed the list but left the separately-cached count stale
    // until the next poll, up to a minute of a red dot over an empty bell.
    queryClient.invalidateQueries({ queryKey: getGetMyUnreadNotificationCountQueryKey() });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Used to mark everything read the instant the popover opened — which
    // erased the read/unread distinction before anyone had a chance to see
    // it, since the list re-fetches (via invalidate()) almost immediately
    // after. Now opening the bell only ever REVEALS which notifications are
    // unread; something is only ever marked read by actually clicking into
    // it (below), or via the explicit "Mark all as read" button.
  }

  function handleMarkAllRead() {
    markAllRead.mutate(undefined, { onSuccess: invalidate });
  }

  function handleNotificationClick(n: { id: string; read?: boolean }) {
    if (!n.read) markRead.mutate({ id: n.id }, { onSuccess: invalidate });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" data-testid="button-notification-bell">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            // Red, not the primary purple it used to be: on a purple-themed
            // app a purple dot on a purple-tinted header is close to
            // invisible, which defeats the one job it has. The ring in the
            // surrounding surface colour keeps it legible where it overlaps
            // the bell itself.
            <span
              className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background"
              aria-label={t("notificationBell.unreadAriaLabel", { count: unreadCount })}
              data-testid="badge-unread-notifications"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 max-h-[70vh] overflow-y-auto">
        <div className="p-3 border-b border-border/50 flex items-center justify-between gap-2">
          <p className="font-medium text-sm text-foreground">{t("notificationBell.notifications")}</p>
          {unreadCount > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">{t("notificationBell.unreadCount", { count: unreadCount })}</span>
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markAllRead.isPending}
                className="text-xs text-primary hover:underline disabled:opacity-50"
                data-testid="button-mark-all-read"
              >
                {t("notificationBell.markAllRead")}
              </button>
            </div>
          )}
        </div>
        {data?.items.length ? (
          <div className="divide-y divide-border/30">
            {data.items.map((n) => {
              // Unread gets a real presence, not a hint: a solid left-edge
              // accent bar, a filled dot instead of the read state's plain
              // spacer, a tinted background, and a bolder title — read
              // fades back to ordinary text the instant it's opened, so the
              // two states stay obviously different at a glance rather than
              // both reading as "basically the same row."
              const content = (
                <div
                  className={`relative p-3 pl-4 text-sm border-l-2 ${
                    !n.read ? "bg-primary/[0.06] border-l-primary" : "border-l-transparent"
                  }`}
                  data-testid={`notification-row-${n.id}`}
                  data-unread={!n.read}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${!n.read ? "bg-primary" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-foreground ${!n.read ? "font-semibold" : "font-normal"}`}>{n.title}</p>
                      <p className={!n.read ? "text-foreground/80 mt-0.5" : "text-muted-foreground mt-0.5"}>{n.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              );
              return n.url ? (
                <Link
                  key={n.id}
                  href={n.url}
                  onClick={() => handleNotificationClick(n)}
                  className="block hover:bg-muted/30 transition-colors"
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  className="block w-full text-left hover:bg-muted/30 transition-colors"
                >
                  {content}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">{t("notificationBell.noNotificationsYet")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
