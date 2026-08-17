import { useEffect, useRef } from "react";
import {
  useListWhisps,
  useGetMyNotifications,
  useMarkNotificationRead,
  getGetMyNotificationsQueryKey,
  getGetMyUnreadNotificationCountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { MessageSquareHeart, ArrowRight, UserCircle2 } from "lucide-react";

export function RepliesInbox() {
  const { data: whisps, isLoading } = useListWhisps({ status: "replied" });
  const queryClient = useQueryClient();
  const { data: notifications } = useGetMyNotifications({
    query: { queryKey: getGetMyNotificationsQueryKey() },
  });
  const markRead = useMarkNotificationRead();
  // Opening this page IS reading the replies, so clear their unread badge —
  // otherwise it would stay lit until the user separately opened the
  // notification bell, pointing them back at a page they're already on.
  // Guarded by a ref so a re-render (or the list refetching) can't fire the
  // same mutations twice.
  const clearedRef = useRef(false);

  useEffect(() => {
    if (clearedRef.current || !notifications?.items) return;
    const unreadReplies = notifications.items.filter((n) => n.kind === "reply" && !n.read);
    if (unreadReplies.length === 0) return;

    clearedRef.current = true;
    Promise.all(unreadReplies.map((n) => markRead.mutateAsync({ id: n.id })))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyUnreadNotificationCountQueryKey() });
      })
      // A failed mark-read just means the badge stays up — not worth
      // surfacing an error toast over, but allow a later retry.
      .catch(() => {
        clearedRef.current = false;
      });
  }, [notifications, markRead, queryClient]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </AppLayout>
    );
  }

  const repliedWhisps = whisps?.filter((w) => w.status === "replied") ?? [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Replies</h1>
          <p className="text-muted-foreground mt-1">Anonymous responses from the people you reached.</p>
        </div>

        {repliedWhisps.length === 0 ? (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <MessageSquareHeart className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-serif font-medium text-foreground mb-2">No replies yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              When someone replies to your whisp, it'll appear here — anonymously.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {repliedWhisps.map((whisp) => (
              <Link key={whisp.id} href={`/whisps/${whisp.id}`}>
                <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer group" data-testid={`reply-card-${whisp.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {whisp.videoThumbnail ? (
                        <img
                          src={whisp.videoThumbnail}
                          alt="Video"
                          className="w-16 h-12 object-cover rounded-xl flex-shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-12 bg-muted rounded-xl flex items-center justify-center flex-shrink-0">
                          <MessageSquareHeart className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{whisp.videoTitle || "Video"}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <UserCircle2 className="w-3 h-3" />
                          <span>Someone replied anonymously</span>
                          <span>·</span>
                          <span>{new Date(whisp.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
