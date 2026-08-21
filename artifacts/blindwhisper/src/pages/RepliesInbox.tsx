import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useListWhisps,
  useListTextWhisps,
  useGetUserProfile,
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
import { MessageSquareHeart, ArrowRight, UserCircle2, ScrollText } from "lucide-react";
import { recipientLabel } from "@/lib/recipients";

// Reply notifications point at the whisp (or Text Whisp) they belong to.
// Reading the id back out is what lets a card show when the reply landed
// instead of when the whisp was created — on a Replies page, "3 days ago"
// meaning the whisp's birthday rather than the reply's is actively
// misleading. Both notification kinds share kind="reply" (see
// routes/textWhisps.ts and lib/replyNotificationScheduler.ts), so they're
// told apart by URL shape instead.
function whispIdFromNotificationUrl(url: string | null | undefined): string | null {
  const match = /^\/whisps\/([^/?#]+)$/.exec(url ?? "");
  return match ? match[1] : null;
}

function textWhispIdFromNotificationUrl(url: string | null | undefined): string | null {
  const match = /^\/text-whisps\/([^/?#]+)$/.exec(url ?? "");
  return match ? match[1] : null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function RepliesInbox() {
  const { t } = useTranslation("whisp");
  const { data: profile } = useGetUserProfile();
  const { data: whisps, isLoading } = useListWhisps({ status: "replied" });
  const { data: textWhisps, isLoading: isLoadingTextWhisps } = useListTextWhisps();
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
  // Latched for the lifetime of the page and NEVER released, including on
  // failure. Releasing it on error looked like a harmless retry, but
  // `useMutation` returns a new object identity every render, so this effect
  // re-runs on every render — and a rejection is itself a state change that
  // causes one. That turned any persistent failure (a notification deleted
  // between fetch and mark-read → permanent 404, or a flaky connection) into
  // a tight render → fail → release → render loop hammering authenticated
  // POSTs for as long as the tab stayed open. A stuck badge clears on the
  // next visit; an unthrottled request loop does not self-correct.
  const clearedRef = useRef(false);
  // mutateAsync is referentially stable, unlike the mutation result object —
  // depending on it keeps this effect from re-running every single render.
  const markReadAsync = markRead.mutateAsync;

  useEffect(() => {
    if (clearedRef.current || !notifications?.items) return;
    const unreadReplies = notifications.items.filter((n) => n.kind === "reply" && !n.read);
    if (unreadReplies.length === 0) return;

    clearedRef.current = true;
    // allSettled, not all: one already-deleted notification shouldn't stop
    // the rest of the badge from clearing.
    void Promise.allSettled(unreadReplies.map((n) => markReadAsync({ id: n.id }))).then(() => {
      queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyUnreadNotificationCountQueryKey() });
    });
  }, [notifications, markReadAsync, queryClient]);

  if (isLoading || isLoadingTextWhisps) {
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
  // Every Text Whisp with a reply thread, sent or received — mirrors
  // repliedWhisps' scope (video whisps already cover both directions here).
  const repliedTextWhisps = textWhisps?.filter((w) => w.status === "replied") ?? [];

  // Latest reply notification per whisp/Text Whisp. Notifications come
  // newest-first, so the first one seen for an id is the one to keep. Both
  // share kind="reply" (see routes/textWhisps.ts and
  // lib/replyNotificationScheduler.ts) and are told apart by URL shape.
  const lastReplyAt = new Map<string, string>();
  const lastTextReplyAt = new Map<string, string>();
  for (const n of notifications?.items ?? []) {
    if (n.kind !== "reply") continue;
    const whispId = whispIdFromNotificationUrl(n.url);
    if (whispId && !lastReplyAt.has(whispId)) lastReplyAt.set(whispId, n.createdAt);
    const textWhispId = textWhispIdFromNotificationUrl(n.url);
    if (textWhispId && !lastTextReplyAt.has(textWhispId)) lastTextReplyAt.set(textWhispId, n.createdAt);
  }

  const hasAnyReplies = repliedWhisps.length > 0 || repliedTextWhisps.length > 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("repliesInbox.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("repliesInbox.subtitle")}</p>
        </div>

        {!hasAnyReplies ? (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <MessageSquareHeart className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-serif font-medium text-foreground mb-2">{t("repliesInbox.emptyState.title")}</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              {t("repliesInbox.emptyState.description")}
            </p>
          </Card>
        ) : (
          <>
          {repliedWhisps.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <MessageSquareHeart className="w-4 h-4" /> {t("repliesInbox.videoWhispsHeading")}
            </h2>
            {repliedWhisps.map((whisp) => {
              const who = recipientLabel(whisp);
              const when = lastReplyAt.get(whisp.id) ?? whisp.createdAt;
              return (
              <Link key={whisp.id} href={`/whisps/${whisp.id}`}>
                <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer group" data-testid={`reply-card-${whisp.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {whisp.videoThumbnail ? (
                        <img
                          src={whisp.videoThumbnail}
                          alt={t("repliesInbox.videoFallback")}
                          className="w-16 h-12 object-cover rounded-xl flex-shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-12 bg-muted rounded-xl flex items-center justify-center flex-shrink-0">
                          <MessageSquareHeart className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        {/* Who replied leads, because that is what the page is
                            scanned for — which of my whisps got an answer, and
                            from whom. The video title is the supporting detail,
                            not the headline. */}
                        <p className="font-medium text-foreground truncate" data-testid={`reply-from-${whisp.id}`}>
                          {who ? (
                            <>
                              <span className="text-gilded">{who}</span> {t("repliesInbox.repliedSuffix")}
                            </>
                          ) : (
                            t("repliesInbox.someoneRepliedAnonymously")
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <UserCircle2 className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{whisp.videoTitle || t("repliesInbox.videoFallback")}</span>
                          <span>·</span>
                          <span className="flex-shrink-0">{new Date(when).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
              );
            })}
          </div>
          )}

          {repliedTextWhisps.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <ScrollText className="w-4 h-4" /> {t("repliesInbox.textWhispsHeading")}
            </h2>
            {repliedTextWhisps.map((textWhisp) => {
              const isSenderOfThisOne = textWhisp.senderId === profile?.id;
              const who = isSenderOfThisOne ? recipientLabel(textWhisp) : textWhisp.senderAlias?.trim() || null;
              const when = lastTextReplyAt.get(textWhisp.id) ?? textWhisp.createdAt;
              return (
              <Link key={textWhisp.id} href={`/text-whisps/${textWhisp.id}`}>
                <Card
                  className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer group"
                  data-testid={`text-reply-card-${textWhisp.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="w-16 h-12 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <ScrollText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate" data-testid={`text-reply-from-${textWhisp.id}`}>
                          {who ? (
                            <>
                              <span className="text-gilded">{who}</span> {t("repliesInbox.repliedSuffix")}
                            </>
                          ) : (
                            t("repliesInbox.someoneRepliedAnonymously")
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <UserCircle2 className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{truncate(textWhisp.messageText, 50)}</span>
                          <span>·</span>
                          <span className="flex-shrink-0">{new Date(when).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
              );
            })}
          </div>
          )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
