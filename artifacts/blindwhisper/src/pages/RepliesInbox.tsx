import { useEffect, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Link } from "wouter";
import { MessageSquareHeart, ChevronRight, ScrollText } from "lucide-react";
import { formatTimeAgo } from "@/lib/relativeTime";
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


// Newest arrival first within each bucket, and the whole unread bucket
// ahead of the read one — so a reply that just landed is never buried below
// a week-old, already-read thread just because that thread happens to be
// first in whatever order the list endpoint returned.
function sortByUnreadThenRecency<T extends { id: string; createdAt: string }>(
  items: T[],
  lastReplyAt: Map<string, string>,
  unreadIds: Set<string>,
): T[] {
  return [...items].sort((a, b) => {
    const unreadDelta = (unreadIds.has(b.id) ? 1 : 0) - (unreadIds.has(a.id) ? 1 : 0);
    if (unreadDelta !== 0) return unreadDelta;
    const aWhen = lastReplyAt.get(a.id) ?? a.createdAt;
    const bWhen = lastReplyAt.get(b.id) ?? b.createdAt;
    return new Date(bWhen).getTime() - new Date(aWhen).getTime();
  });
}

// The small unread dot on a tab trigger — yellow for video Whisp replies,
// red for Text Whisp replies, so the two are distinguishable at a glance
// without reading either label.
function UnreadDot({ color, testId }: { color: "yellow" | "red"; testId: string }) {
  return (
    <span
      className={`ml-1.5 inline-block w-2 h-2 shrink-0 rounded-full ring-2 ring-background/60 ${color === "yellow" ? "bg-[hsl(45_93%_58%)]" : "bg-destructive"}`}
      data-testid={testId}
    />
  );
}

export function RepliesInbox() {
  const { t } = useTranslation("whisp");
  const { data: profile } = useGetUserProfile();
  const { data: whisps, isLoading } = useListWhisps({ status: "replied" });
  const { data: textWhisps, isLoading: isLoadingTextWhisps } = useListTextWhisps();
  const [activeTab, setActiveTab] = useState<"video" | "text">("video");
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

  function relativeTime(value: string): string {
    const date = new Date(value);
    if (Date.now() - date.getTime() < 60_000) return t("shared.justNow");
    return formatTimeAgo(date);
  }

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
        <div className="space-y-5 md:space-y-6" aria-busy="true">
          <div className="space-y-2">
            <Skeleton className="h-9 w-36 rounded-lg" />
            <Skeleton className="h-4 w-72 max-w-full rounded" />
          </div>
          <Skeleton className="h-12 w-full sm:w-80 rounded-full" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 sm:gap-4 rounded-2xl border border-border/40 bg-card/40 p-3.5 sm:p-4">
                <Skeleton className="w-20 aspect-video rounded-[10px] shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5 rounded" />
                  <Skeleton className="h-3 w-4/5 rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  const repliedWhisps = whisps?.filter((w) => w.status === "replied") ?? [];
  // Every Text Whisp with a reply thread, sent or received — mirrors
  // repliedWhisps' scope (video whisps already cover both directions here).
  const repliedTextWhisps = textWhisps?.filter((w) => w.status === "replied") ?? [];

  // Latest reply notification per whisp/Text Whisp, AND which ids currently
  // have an UNREAD one — read before this effect's own mark-all-read call
  // resolves and invalidates, so the tab dots and sort order still reflect
  // "what's actually new" on first paint rather than always showing clear.
  // Both notification kinds share kind="reply" (see routes/textWhisps.ts and
  // lib/replyNotificationScheduler.ts) and are told apart by URL shape.
  const lastReplyAt = new Map<string, string>();
  const lastTextReplyAt = new Map<string, string>();
  const unreadWhispIds = new Set<string>();
  const unreadTextWhispIds = new Set<string>();
  for (const n of notifications?.items ?? []) {
    if (n.kind !== "reply") continue;
    const whispId = whispIdFromNotificationUrl(n.url);
    if (whispId) {
      if (!lastReplyAt.has(whispId)) lastReplyAt.set(whispId, n.createdAt);
      if (!n.read) unreadWhispIds.add(whispId);
    }
    const textWhispId = textWhispIdFromNotificationUrl(n.url);
    if (textWhispId) {
      if (!lastTextReplyAt.has(textWhispId)) lastTextReplyAt.set(textWhispId, n.createdAt);
      if (!n.read) unreadTextWhispIds.add(textWhispId);
    }
  }

  const sortedRepliedWhisps = sortByUnreadThenRecency(repliedWhisps, lastReplyAt, unreadWhispIds);
  const sortedRepliedTextWhisps = sortByUnreadThenRecency(repliedTextWhisps, lastTextReplyAt, unreadTextWhispIds);
  const hasAnyReplies = repliedWhisps.length > 0 || repliedTextWhisps.length > 0;

  return (
    <AppLayout>
      <div className="space-y-5 md:space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-foreground">{t("repliesInbox.title")}</h1>
          <p className="text-muted-foreground mt-1.5">{t("repliesInbox.subtitle")}</p>
        </div>

        {!hasAnyReplies ? (
          <Card className="rounded-2xl bg-card/40 border-dashed border-border/70 px-6 py-12 sm:py-16 text-center shadow-none">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/20">
              <MessageSquareHeart className="h-6 w-6 text-primary" />
            </span>
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">{t("repliesInbox.emptyState.title")}</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              {t("repliesInbox.emptyState.description")}
            </p>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "video" | "text")}>
            {/* Short labels in a full-width pill bar on phones — the long
                "… Whisp Replies" labels ran off the right edge. The page title
                already says these are replies. min-w-0 + a label allowed to wrap
                cover the longer translations (Swahili "Whisps za Maandishi"),
                which still pushed the second tab past a 360px screen. */}
            <TabsList className="flex h-auto w-full sm:inline-flex sm:w-auto gap-1 rounded-full border border-border/50 bg-card/60 p-1">
              <TabsTrigger
                value="video"
                data-testid="tab-video-whisp-replies"
                className="flex-1 sm:flex-none min-w-0 min-h-10 gap-1.5 rounded-full px-4 max-[399px]:px-3 text-sm max-[399px]:text-[13px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                <MessageSquareHeart className="w-4 h-4 shrink-0" />
                <span className="whitespace-normal leading-tight text-center">{t("repliesInbox.tabVideo")}</span>
                {unreadWhispIds.size > 0 && <UnreadDot color="yellow" testId="dot-unread-video-whisp-replies" />}
              </TabsTrigger>
              <TabsTrigger
                value="text"
                data-testid="tab-text-whisp-replies"
                className="flex-1 sm:flex-none min-w-0 min-h-10 gap-1.5 rounded-full px-4 max-[399px]:px-3 text-sm max-[399px]:text-[13px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                <ScrollText className="w-4 h-4 shrink-0" />
                <span className="whitespace-normal leading-tight text-center">{t("repliesInbox.tabText")}</span>
                {unreadTextWhispIds.size > 0 && <UnreadDot color="red" testId="dot-unread-text-whisp-replies" />}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="video" className="space-y-3 mt-4">
              {sortedRepliedWhisps.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">{t("repliesInbox.videoWhispsEmpty")}</p>
              ) : (
                sortedRepliedWhisps.map((whisp) => {
                  const who = recipientLabel(whisp);
                  const when = lastReplyAt.get(whisp.id) ?? whisp.createdAt;
                  const isUnread = unreadWhispIds.has(whisp.id);
                  return (
                    <Link key={whisp.id} href={`/whisps/${whisp.id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Card
                        className={`group rounded-2xl shadow-none transition-colors duration-200 cursor-pointer ${isUnread ? "bg-[hsl(45_93%_58%)]/[0.06] border-[hsl(45_93%_58%)]/30 hover:bg-[hsl(45_93%_58%)]/10" : "bg-card/60 border-border/50 hover:bg-card hover:border-border"}`}
                        data-testid={`reply-card-${whisp.id}`}
                      >
                        <CardContent className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-4">
                          <div className="relative w-20 aspect-video shrink-0 overflow-hidden rounded-[10px] bg-muted">
                            {whisp.videoThumbnail ? (
                              <img src={whisp.videoThumbnail} alt={t("repliesInbox.videoFallback")} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <MessageSquareHeart className="w-5 h-5 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Who replied leads, because that is what the page
                                is scanned for — which of my whisps got an
                                answer, and from whom. The video title is the
                                supporting detail, not the headline. Wraps
                                rather than truncating: an address cut to
                                "…com repl" told you neither who nor what. */}
                            <p className="text-[15px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]" data-testid={`reply-from-${whisp.id}`}>
                              {isUnread && <span className="mr-1.5 inline-block h-2 w-2 -translate-y-px rounded-full bg-[hsl(45_93%_58%)] align-middle" />}
                              {who ? (
                                <>
                                  <span className="text-gilded">{who}</span> <span className="text-muted-foreground font-normal">{t("repliesInbox.repliedSuffix")}</span>
                                </>
                              ) : (
                                t("repliesInbox.someoneRepliedAnonymously")
                              )}
                            </p>
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">{whisp.videoTitle || t("repliesInbox.videoFallback")}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground/90 tabular-nums">
                              <time dateTime={when} title={new Date(when).toLocaleString()}>{relativeTime(when)}</time>
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100" />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="text" className="space-y-3 mt-4">
              {sortedRepliedTextWhisps.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">{t("repliesInbox.textWhispsEmpty")}</p>
              ) : (
                sortedRepliedTextWhisps.map((textWhisp) => {
                  const isSenderOfThisOne = textWhisp.senderId === profile?.id;
                  const who = isSenderOfThisOne ? recipientLabel(textWhisp) : textWhisp.senderAlias?.trim() || null;
                  const when = lastTextReplyAt.get(textWhisp.id) ?? textWhisp.createdAt;
                  const isUnread = unreadTextWhispIds.has(textWhisp.id);
                  return (
                    <Link key={textWhisp.id} href={`/text-whisps/${textWhisp.id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Card
                        className={`group rounded-2xl shadow-none transition-colors duration-200 cursor-pointer ${isUnread ? "bg-destructive/[0.06] border-destructive/30 hover:bg-destructive/10" : "bg-card/60 border-border/50 hover:bg-card hover:border-border"}`}
                        data-testid={`text-reply-card-${textWhisp.id}`}
                      >
                        <CardContent className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-4">
                          <div className="w-20 aspect-video shrink-0 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <ScrollText className="w-5 h-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]" data-testid={`text-reply-from-${textWhisp.id}`}>
                              {isUnread && <span className="mr-1.5 inline-block h-2 w-2 -translate-y-px rounded-full bg-destructive align-middle" />}
                              {who ? (
                                <>
                                  <span className="text-gilded">{who}</span> <span className="text-muted-foreground font-normal">{t("repliesInbox.repliedSuffix")}</span>
                                </>
                              ) : (
                                t("repliesInbox.someoneRepliedAnonymously")
                              )}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{textWhisp.messageText}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground/90 tabular-nums">
                              <time dateTime={when} title={new Date(when).toLocaleString()}>{relativeTime(when)}</time>
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100" />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
