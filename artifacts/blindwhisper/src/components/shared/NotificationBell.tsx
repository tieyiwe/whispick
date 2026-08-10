import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useGetMyNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getGetMyNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";

// The persistent, in-app counterpart to push notifications (see
// lib/push.ts server-side) — a bell with an unread badge, shown in both the
// desktop sidebar and mobile header of AppLayout. Polls on an interval
// rather than websockets, matching the rest of this app's "no realtime
// infra" posture.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useGetMyNotifications({
    query: { queryKey: getGetMyNotificationsQueryKey(), refetchInterval: 60_000 },
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = data?.unreadCount ?? 0;

  // A short pulse the moment a genuinely new notification shows up while
  // the app is open (unread count rising between polls) — the one clear
  // "reply received" in-app moment this component has. Guarded against
  // firing on the very first fetch (prevCount starts undefined) so opening
  // the app with existing unread notifications doesn't buzz on load.
  const prevUnreadCountRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (data?.unreadCount == null) return;
    if (prevUnreadCountRef.current !== undefined && data.unreadCount > prevUnreadCountRef.current) {
      triggerHaptic();
    }
    prevUnreadCountRef.current = data.unreadCount;
  }, [data?.unreadCount]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && unreadCount > 0) {
      markAllRead.mutate(undefined, { onSuccess: invalidate });
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" data-testid="button-notification-bell">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" data-testid="badge-unread-notifications" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 max-h-[70vh] overflow-y-auto">
        <div className="p-3 border-b border-border/50 flex items-center justify-between">
          <p className="font-medium text-sm text-foreground">Notifications</p>
          {unreadCount > 0 && <span className="text-xs text-muted-foreground">{unreadCount} unread</span>}
        </div>
        {data?.items.length ? (
          <div className="divide-y divide-border/30">
            {data.items.map((n) => {
              const content = (
                <div className={`p-3 text-sm ${!n.read ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{n.title}</p>
                    {!n.read && <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />}
                  </div>
                  <p className="text-muted-foreground mt-0.5">{n.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              );
              return n.url ? (
                <Link
                  key={n.id}
                  href={n.url}
                  onClick={() => {
                    if (!n.read) markRead.mutate({ id: n.id }, { onSuccess: invalidate });
                    setOpen(false);
                  }}
                  className="block hover:bg-muted/30 transition-colors"
                >
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No notifications yet.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
