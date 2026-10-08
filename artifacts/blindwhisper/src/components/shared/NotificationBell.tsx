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
import { Bell, BellOff } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { isSafeAppPath } from "@/lib/safeHref";

// The persistent, in-app counterpart to push notifications (see
// lib/push.ts server-side) — a bell with an unread badge, shown in both the
// desktop sidebar and mobile header of AppLayout. Polls on an interval
// rather than websockets, matching the rest of this app's "no realtime
// infra" posture.
// Relative, not toLocaleString(): "7:30:14 AM" with seconds is noise in a
// feed, and "2h ago" answers the only question a glance is asking. Under a
// minute reads as "just now" rather than "12 seconds ago".
function relativeTime(value: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const date = new Date(value);
  if (Date.now() - date.getTime() < 60_000) return t("notificationBell.justNow");
  return t("notificationBell.timeAgo", { time: formatDistanceToNowStrict(date) });
}

export function NotificationBell({
  side = "bottom",
  align = "end",
  triggerClassName = "",
}: {
  /** Where the popover opens. The desktop sidebar opens it to the right so it
   *  sits over the content instead of covering the nav it was opened from. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  triggerClassName?: string;
} = {}) {
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

  // Reflect read-state in the caches SYNCHRONOUSLY, before the click's own
  // navigation runs. Clicking a notification with a url both marks it read
  // AND navigates (the <Link> below), and that navigation unmounts/remounts
  // AppLayout (and this bell) — which drops the mutation's onSuccess callback
  // before invalidate() could ever fire, so the row stayed bold and the red
  // dot never dropped. Updating the cache up front makes the read state (and
  // the count) survive the navigation no matter how the request/unmount race
  // resolves; the mutation still persists it server-side, and the 60s poll
  // reconciles anything the optimistic guess got slightly off.
  function markOneReadInCache(id: string, kind?: string | null) {
    queryClient.setQueryData(getGetMyNotificationsQueryKey(), (old: any) =>
      old ? { ...old, items: old.items.map((i: any) => (i.id === id ? { ...i, read: true } : i)) } : old,
    );
    queryClient.setQueryData(getGetMyUnreadNotificationCountQueryKey(), (old: any) =>
      old
        ? {
            ...old,
            unreadCount: Math.max(0, (old.unreadCount ?? 0) - 1),
            unreadReplyCount: kind === "reply" ? Math.max(0, (old.unreadReplyCount ?? 0) - 1) : old.unreadReplyCount,
          }
        : old,
    );
  }

  function handleMarkAllRead() {
    // Same optimistic approach for the bulk action: zero the counts and flip
    // every row read immediately, then persist + reconcile.
    queryClient.setQueryData(getGetMyNotificationsQueryKey(), (old: any) =>
      old ? { ...old, items: old.items.map((i: any) => ({ ...i, read: true })) } : old,
    );
    queryClient.setQueryData(getGetMyUnreadNotificationCountQueryKey(), (old: any) =>
      old ? { ...old, unreadCount: 0, unreadReplyCount: 0 } : old,
    );
    markAllRead.mutate(undefined, { onSuccess: invalidate });
  }

  function handleNotificationClick(n: { id: string; read?: boolean; kind?: string | null }) {
    if (!n.read) {
      markOneReadInCache(n.id, n.kind);
      markRead.mutate({ id: n.id }, { onSuccess: invalidate });
    }
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative rounded-full text-muted-foreground hover:text-foreground data-[state=open]:bg-card data-[state=open]:text-foreground ${triggerClassName}`}
          aria-label={t("notificationBell.notifications")}
          data-testid="button-notification-bell"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            // Red, not the primary purple it used to be: on a purple-themed
            // app a purple dot on a purple-tinted header is close to
            // invisible, which defeats the one job it has. The ring in the
            // surrounding surface colour keeps it legible where it overlaps
            // the bell itself. Shows the actual count (capped at "9+", same
            // convention as every other nav badge in AppLayout) rather than
            // a bare dot, so the number is visible without opening the
            // popover.
            <span
              className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive ring-2 ring-background text-[11px] font-semibold leading-none tabular-nums text-destructive-foreground flex items-center justify-center"
              aria-label={t("notificationBell.unreadAriaLabel", { count: unreadCount })}
              data-testid="badge-unread-notifications"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={side === "right" ? 14 : 8}
        collisionPadding={12}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0 max-h-[min(70vh,34rem)] overflow-y-auto rounded-2xl border-border/60 bg-popover/95 backdrop-blur-xl shadow-2xl"
      >
        <div className="sticky top-0 z-10 px-4 py-3 border-b border-border/50 bg-popover/95 backdrop-blur-xl flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <p className="font-serif font-semibold text-base text-foreground">{t("notificationBell.notifications")}</p>
            {unreadCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">{t("notificationBell.unreadCount", { count: unreadCount })}</span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isPending}
              className="shrink-0 -mr-2 rounded-full px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              data-testid="button-mark-all-read"
            >
              {t("notificationBell.markAllRead")}
            </button>
          )}
        </div>
        {data?.items.length ? (
          <div className="divide-y divide-border/30">
            {data.items.map((n) => {
              // Unread gets a real presence, not a hint: a filled dot, a
              // tinted background and a bolder title — read fades back to
              // ordinary text the instant it's opened, so the two states stay
              // obviously different at a glance.
              const content = (
                <div
                  className={`relative px-4 py-3 text-sm ${!n.read ? "bg-primary/[0.07]" : ""}`}
                  data-testid={`notification-row-${n.id}`}
                  data-unread={!n.read}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-[7px] h-2 w-2 rounded-full shrink-0 ${!n.read ? "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={`text-foreground leading-snug ${!n.read ? "font-semibold" : "font-medium text-foreground/85"}`}>{n.title}</p>
                        <time
                          dateTime={n.createdAt}
                          title={new Date(n.createdAt).toLocaleString()}
                          className="shrink-0 text-xs text-muted-foreground tabular-nums whitespace-nowrap"
                        >
                          {relativeTime(n.createdAt, t)}
                        </time>
                      </div>
                      <p className={`mt-0.5 leading-snug ${!n.read ? "text-foreground/80" : "text-muted-foreground"}`}>{n.body}</p>
                    </div>
                  </div>
                </div>
              );
              // Only same-origin app paths become links — a "//evil.com" or
              // "/\evil.com" url would otherwise navigate off-site.
              return isSafeAppPath(n.url) ? (
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
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
              <BellOff className="h-[18px] w-[18px] text-muted-foreground" />
            </span>
            <p className="text-sm text-muted-foreground">{t("notificationBell.noNotificationsYet")}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
