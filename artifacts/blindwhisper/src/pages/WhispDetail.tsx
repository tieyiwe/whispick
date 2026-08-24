import { useParams, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetWhisp,
  useCreateWhispReply,
  useRequestReveal,
  useDeleteWhisp,
  useArchiveWhisp,
  useGetGhostBoostMatches,
  usePostCircleComment,
  useSetGuessReaction,
  getGetGhostBoostMatchesQueryKey,
  getGetWhispQueryKey,
  getListWhispsQueryKey,
  getGetWhispStatsQueryKey,
  type CircleComment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import { ReplyThread, ThreadComposer, type ThreadReply, type GuessReactionValue } from "@/components/shared/ReplyThread";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  ArrowLeft,
  PlayCircle,
  Send,
  Eye,
  MessageSquare,
  Loader2,
  Trash2,
  HeartHandshake,
  Sparkles,
  Users,
  Lock,
  ChevronDown,
  Heart,
  X,
} from "lucide-react";
import { deliveryLabel } from "@/lib/deliveryMethod";
import { getVisitorId } from "@/lib/anonymousVisitor";
import { CircleCommentRow } from "@/components/shared/CircleCommentRow";
import { ArchivedWhispGate } from "@/components/shared/ArchivedWhispGate";
import { TimelineTrack, type TimelineStepData } from "@/components/shared/DeliveryTimelineTrack";

export function WhispDetail() {
  const { t } = useTranslation("whisp");
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadReply | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [posterCommentText, setPosterCommentText] = useState("");
  const [posterCommentReplyingTo, setPosterCommentReplyingTo] = useState<CircleComment | null>(null);
  const postComment = usePostCircleComment();

  // Polled so a reply arriving while this page is open shows up on its own.
  // 15s is a deliberate middle ground: the sender's notification is already
  // delayed by minutes (see replyNotificationScheduler), so sub-second
  // latency buys nothing, while a slower poll would leave someone staring at
  // a thread that looks stalled. Pauses when the tab is hidden rather than
  // polling a page nobody's looking at.
  const { data, isLoading } = useGetWhisp(id!, {
    query: {
      enabled: !!id,
      queryKey: getGetWhispQueryKey(id!),
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
    },
  });

  const isGhostBoost = data?.whisp.deliveryMethod === "ghost_boost";
  const { data: matchStats } = useGetGhostBoostMatches(id!, {
    query: { enabled: !!id && isGhostBoost, queryKey: getGetGhostBoostMatchesQueryKey(id!) },
  });

  const createReply = useCreateWhispReply();
  const requestReveal = useRequestReveal();
  const deleteWhisp = useDeleteWhisp();
  const archiveWhisp = useArchiveWhisp();
  const setGuessReaction = useSetGuessReaction();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto text-center py-16">
          <p className="text-muted-foreground">{t("whispDetail.notFound")}</p>
          <Button variant="ghost" onClick={() => setLocation("/whisps")} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> {t("whispDetail.backToWhisps")}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { whisp, trackingEvents, replies, recipientRepliesRemaining, viewCount, likeCount, comments, circleConversations } = data;

  function handleUnarchive() {
    archiveWhisp.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
          queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
          toast({ title: t("shared.movedBackToList") });
        },
        onError: () => toast({ title: t("shared.couldntUpdateThat"), variant: "destructive" }),
      },
    );
  }

  // A reply/follow-up on an archived whisp still notifies normally
  // (archiving only hides it from THIS sender's own list, see
  // whisps.senderArchivedAt) — clicking that notification lands here, and
  // this is what greets them instead of the full thread: a deliberate
  // choice, not a dead end, so unarchiving is a real decision rather than
  // happening invisibly the moment a notification is clicked.
  if (whisp.archived) {
    return (
      <AppLayout>
        <ArchivedWhispGate
          videoTitle={whisp.videoTitle}
          onUnarchive={handleUnarchive}
          isUnarchiving={archiveWhisp.isPending}
          onBack={() => setLocation("/whisps")}
        />
      </AppLayout>
    );
  }

  function handleSendFollowUp() {
    if (!replyText.trim()) return;
    createReply.mutate(
      {
        id: whisp.id,
        data: {
          replyText: replyText.trim(),
          fromRecipient: false,
          ...(replyingTo ? { parentReplyId: replyingTo.id } : {}),
        },
      },
      {
        onSuccess: () => {
          setReplyText("");
          setReplyingTo(null);
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
          toast({ title: t("whispDetail.toast.followUpSent") });
        },
        onError: () => toast({ title: t("whispDetail.toast.failedToSend"), variant: "destructive" }),
      }
    );
  }

  // Posts through the SAME public endpoint an anonymous viewer uses — the
  // sender is authenticated here, so isPoster gets set server-side
  // automatically (see routes/public.ts's POST /w/:token/comments), badging
  // this as coming from the post's own poster without a separate code path.
  function handlePostComment() {
    const text = posterCommentText.trim();
    if (!text || !whisp) return;
    postComment.mutate(
      {
        token: whisp.publicToken,
        data: { commentText: text, visitorId: getVisitorId(), parentCommentId: posterCommentReplyingTo?.id ?? null },
      },
      {
        onSuccess: () => {
          setPosterCommentText("");
          setPosterCommentReplyingTo(null);
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
        },
        onError: () => toast({ title: t("whispDetail.toast.couldntPostComment"), variant: "destructive" }),
      }
    );
  }

  function handleReveal() {
    requestReveal.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
          toast({ title: t("whispDetail.revealRequestSent") });
        },
        onError: () => toast({ title: t("whispDetail.toast.failedToRequestReveal"), variant: "destructive" }),
      }
    );
  }

  // The sender's manual, one-tap reaction to a guess — never an automatic
  // check against the real sender's identity (see docs/features-whisps.md's
  // "Guess who sent it" section). Overwrite-safe: tapping a different option
  // just re-sends with the new reaction, same as the backend allows.
  function handleReactToGuess(reply: ThreadReply, reaction: GuessReactionValue) {
    setGuessReaction.mutate(
      { id: whisp.id, replyId: reply.id, data: { reaction } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) }),
        onError: () => toast({ title: t("whispDetail.toast.couldntUpdateGuessReaction"), variant: "destructive" }),
      }
    );
  }

  function handleDelete() {
    deleteWhisp.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
          setLocation("/whisps");
          toast({ title: t("shared.whispDeleted") });
        },
        onError: () => toast({ title: t("whispDetail.toast.failedToDelete"), variant: "destructive" }),
      }
    );
  }

  const eventTypes = trackingEvents.map((e) => e.eventType);
  const recipientReplied = replies.some((r) => r.fromRecipient);
  // Only YouTube/Vimeo/native uploads can report completion; everything else
  // stops at "started". Derived from the raw event rather than a column, since
  // watched_complete already means exactly this and is already on the page.
  const watchedInFull = eventTypes.includes("watched_complete");

  const timelineSteps: TimelineStepData[] = [
    { label: t("whispDetail.timeline.sent"), time: whisp.createdAt, done: true },
    { label: t("whispDetail.timeline.delivered"), time: whisp.deliveredAt, done: !!whisp.deliveredAt },
    {
      label: t("whispDetail.timeline.opened"),
      time: whisp.openedAt,
      done: !!whisp.openedAt,
      active: !!whisp.deliveredAt && !whisp.openedAt,
    },
    {
      // One step, not two. Pressing play is now what marks a whisp watched, so
      // a separate "Clicked" step would render the same signal at the same
      // timestamp — the step upgrades instead.
      //
      // "Watched" means they started it, which is all most platforms can ever
      // tell us. Only YouTube, Vimeo and native uploads report completion, and
      // when one does the label says so rather than adding a stage that stays
      // permanently grey for everything else.
      label: watchedInFull ? t("whispDetail.timeline.watchedAll") : t("whispDetail.timeline.watched"),
      fullLabel: watchedInFull ? t("whispDetail.timeline.watchedAllFull") : t("whispDetail.timeline.watchedFull"),
      time: whisp.watchedAt,
      done: !!whisp.watchedAt,
      active: !!whisp.openedAt && !whisp.watchedAt,
    },
    {
      label: t("whispDetail.timeline.replied"),
      time: replies.find((r) => r.fromRecipient)?.createdAt,
      done: recipientReplied,
      active: !!whisp.openedAt && !recipientReplied,
    },
  ];
  // Furthest stage actually reached — shown in the header while collapsed.
  const currentStage = timelineSteps.filter((s) => s.done).at(-1)?.label ?? null;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/whisps")} className="text-muted-foreground -ml-2" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("shared.back")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={deleteWhisp.isPending}
                className="text-muted-foreground hover:text-destructive min-w-11 min-h-11"
                data-testid="button-delete-whisp"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("whispDetail.deleteDialog.title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {replies.length > 0
                    ? t("whispDetail.deleteDialog.descriptionWithReplies", { count: replies.length })
                    : t("whispDetail.deleteDialog.descriptionNoReplies")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("shared.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete-whisp"
                >
                  {t("shared.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Video preview */}
        <Card className="bg-card border-border/50 overflow-hidden">
          {whisp.videoThumbnail ? (
            <div className="relative h-48 overflow-hidden">
              <img src={whisp.videoThumbnail} alt={t("whispDetail.videoFallback")} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <a
                  href={whisp.videoPlatform === "upload" ? `/api/public/w/${whisp.publicToken}/media` : whisp.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
                    <PlayCircle className="w-8 h-8 text-white" />
                  </div>
                </a>
              </div>
            </div>
          ) : null}
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-serif font-semibold text-lg text-foreground">{whisp.videoTitle || t("whispDetail.videoFallback")}</h2>
                <p className="text-sm text-muted-foreground">
                  {isGhostBoost
                    ? matchStats && matchStats.matchedCount > 0
                      ? t("whispDetail.matchedToSubscribers", { count: matchStats.matchedCount })
                      : whisp.status === "failed"
                      ? t("whispDetail.noMatchingSubscribers")
                      : t("whispDetail.lookingForMatch")
                    : t("whispDetail.sentTo", {
                        destination:
                          whisp.recipientEmail ||
                          whisp.recipientPhone ||
                          (whisp.deliveryMethod === "circle_drop" ? t("shared.blindCircleFeed") : t("whispDetail.genericRecipient")),
                      })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("whispDetail.via", { method: deliveryLabel(whisp.deliveryMethod, whisp.whisperChannel) })} · {new Date(whisp.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={whisp.status} />
            </div>
            {whisp.status === "scheduled" && whisp.scheduledAt && (
              <p className="text-xs text-violet-400 mb-2">
                {t("whispDetail.scheduledToSend", {
                  date: new Date(whisp.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
                })}
              </p>
            )}
            {isGhostBoost && matchStats && matchStats.matchedCount > 0 && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1 pb-2 flex-wrap" data-testid="ghost-boost-match-stats">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t("whispDetail.stats.matched", { count: matchStats.matchedCount })}</span>
                <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {t("whispDetail.stats.opened", { count: matchStats.openedCount })}</span>
                <span className="flex items-center gap-1"><PlayCircle className="w-3.5 h-3.5" /> {t("whispDetail.stats.watched", { count: matchStats.watchedCount })}</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {t("whispDetail.stats.replied", { count: matchStats.repliedCount })}</span>
                {matchStats.appreciatedCount > 0 && (
                  <span className="flex items-center gap-1 text-primary"><HeartHandshake className="w-3.5 h-3.5" /> {t("whispDetail.stats.appreciated", { count: matchStats.appreciatedCount })}</span>
                )}
              </div>
            )}
            {whisp.deliveryMethod === "circle_drop" && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1 pb-2 flex-wrap" data-testid="circle-post-stats">
                <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {t("whispDetail.stats.views", { count: viewCount })}</span>
                <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {t("whispDetail.stats.likes", { count: likeCount })}</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {t("whispDetail.stats.comments", { count: comments.length })}</span>
              </div>
            )}
            {whisp.moodTag && <MoodTag mood={whisp.moodTag} className="mb-2" />}
            {whisp.anonymousNote && (
              <p className="text-sm text-muted-foreground italic border-l-2 border-primary/40 pl-3 mb-2">
                "{whisp.anonymousNote}"
              </p>
            )}
            {/* A 'yes' here is the best news this page can carry — the whole
                point of having sent anything — so it's given the gilded
                accent and its own surface instead of reading like one more
                status line. A 'no' stays deliberately quiet. */}
            {whisp.appreciationResponse === "yes" ? (
              <div
                className="mt-1 flex items-center gap-2.5 rounded-xl border border-gilded/30 bg-gilded/[0.07] px-3.5 py-2.5"
                data-testid="notice-appreciated"
              >
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gilded/15 shrink-0">
                  <HeartHandshake className="w-4 h-4 text-gilded" />
                </span>
                <p className="text-sm text-foreground">{t("whispDetail.appreciationYes")}</p>
              </div>
            ) : whisp.appreciationResponse ? (
              <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
                <HeartHandshake className="w-4 h-4" />
                {t("whispDetail.appreciationNo")}
              </p>
            ) : null}
            {whisp.aiTakeawayStatus === "ready" && whisp.aiTakeaway && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1">
                <p className="text-xs font-semibold tracking-wide text-primary uppercase flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> {t("whispDetail.takeawayHeading")}
                </p>
                <p className="text-sm text-foreground font-serif leading-relaxed">{whisp.aiTakeaway}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delivery timeline — a single-recipient concept, not meaningful for a
            Ghost Boost campaign that fans out to many anonymous subscribers */}
        {!isGhostBoost && (
        <Card className="bg-card border-border/50">
          {/* Collapsible, because once a whisp has been watched the timeline
              is settled history and mostly costs the reader scrolling to get
              past it. Open by default — it's the answer to "did they see
              it?", which is why most people open this page at all. */}
          <button
            type="button"
            onClick={() => setTimelineOpen((open) => !open)}
            aria-expanded={timelineOpen}
            aria-controls="delivery-timeline"
            data-testid="button-toggle-timeline"
            className="flex w-full items-center gap-2 px-6 py-4 text-left"
          >
            <CardTitle className="text-base font-serif">{t("whispDetail.deliveryTimeline")}</CardTitle>
            {/* Collapsing shouldn't cost the headline fact, so the furthest
                stage reached comes up into the header to replace it. */}
            {!timelineOpen && currentStage && (
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
                {currentStage}
              </span>
            )}
            <ChevronDown
              className={`ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${
                timelineOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {timelineOpen && (
            <CardContent id="delivery-timeline" className="pt-0">
              <TimelineTrack steps={timelineSteps} />
            </CardContent>
          )}
        </Card>
        )}

        {/* The anonymous conversation — thread and composer in one card, so
            replying happens inside the conversation instead of in a separate
            box further down the page. Doesn't apply to a Ghost Boost campaign,
            which is fanned out to many anonymous subscribers rather than one
            known recipient. */}
        {!isGhostBoost && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                {t("whispDetail.anonymousConversation")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Surfaces the cap BEFORE the thread goes quiet — without
                  this, a recipient hitting the wall is indistinguishable
                  from them losing interest. */}
              {recipientRepliesRemaining === 0 && (
                <div
                  className="mb-3 rounded-xl border border-secondary/30 bg-secondary/5 p-3 space-y-2"
                  data-testid="notice-recipient-out-of-replies"
                >
                  <p className="text-sm text-foreground flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-secondary shrink-0" />
                    {t("whispDetail.outOfReplies.title")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("whispDetail.outOfReplies.description")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled
                    data-testid="button-buy-more-replies"
                  >
                    {t("whispDetail.outOfReplies.comingSoonButton")}
                  </Button>
                </div>
              )}
              {typeof recipientRepliesRemaining === "number" && recipientRepliesRemaining === 1 && (
                <p className="mb-3 text-xs text-muted-foreground" data-testid="text-recipient-replies-remaining">
                  {t("whispDetail.oneReplyLeft")}
                </p>
              )}
              <ReplyThread
                replies={replies}
                viewerIsRecipient={false}
                otherLabel={t("whispDetail.recipientLabel")}
                replyingTo={replyingTo}
                onReplyTo={setReplyingTo}
                onReactToGuess={handleReactToGuess}
                reactingGuessReplyId={setGuessReaction.isPending ? setGuessReaction.variables?.replyId ?? null : null}
                emptyState={
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {t("whispDetail.noRepliesYet")}
                  </p>
                }
                composer={
                  <ThreadComposer
                    value={replyText}
                    onChange={setReplyText}
                    onSend={handleSendFollowUp}
                    sending={createReply.isPending}
                    placeholder={t("whispDetail.composerPlaceholder")}
                    testIdPrefix="follow-up"
                  />
                }
              />
            </CardContent>
          </Card>
        )}

        {/* Blind Circle comments — the poster can read every public comment
            here and reply into the same thread anonymous viewers see, badged
            "Poster" (see routes/public.ts's isPoster). Doesn't apply to any
            other delivery method — a Whisper Link has no public comment
            section, just the private "Anonymous conversation" above. */}
        {whisp.deliveryMethod === "circle_drop" && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                {t("whispDetail.commentsHeading", { count: comments.length })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">{t("whispDetail.noComments")}</p>
              ) : (
                <div className="space-y-3">
                  {comments
                    .filter((c) => !c.parentCommentId)
                    .map((comment) => (
                      <div key={comment.id} className="space-y-2">
                        <CircleCommentRow comment={comment} onReply={() => setPosterCommentReplyingTo(comment)} />
                        {comments
                          .filter((r) => r.parentCommentId === comment.id)
                          .map((reply) => (
                            <div key={reply.id} className="ml-5 pl-3 border-l-2 border-border/30">
                              <CircleCommentRow comment={reply} onReply={() => setPosterCommentReplyingTo(comment)} />
                            </div>
                          ))}
                      </div>
                    ))}
                </div>
              )}

              {posterCommentReplyingTo && (
                <div className="flex items-center justify-between gap-2 rounded-lg border-l-2 border-primary/60 bg-primary/5 px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">{t("whispDetail.replyingToComment")}</span>
                  <button
                    type="button"
                    onClick={() => setPosterCommentReplyingTo(null)}
                    aria-label={t("whispDetail.cancelReplyAriaLabel")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  className="bg-input/40 border-border/50 rounded-xl resize-none min-h-[44px]"
                  placeholder={t("whispDetail.replyAsPosterPlaceholder")}
                  maxLength={500}
                  value={posterCommentText}
                  onChange={(e) => setPosterCommentText(e.target.value)}
                  data-testid="textarea-poster-comment"
                />
                <Button
                  size="sm"
                  className="rounded-full self-end shrink-0"
                  onClick={handlePostComment}
                  disabled={!posterCommentText.trim() || postComment.isPending}
                  data-testid="button-post-poster-comment"
                >
                  {postComment.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Private conversations anonymous viewers started from this post —
            each is its own separate whisp (deliveryMethod='circle_dm', see
            routes/public.ts's POST /w/:token/circle-dm/start), so it gets
            its own full WhispDetail page with its own reply thread. */}
        {whisp.deliveryMethod === "circle_drop" && circleConversations.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                {t("whispDetail.privateConversationsHeading", { count: circleConversations.length })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {circleConversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/whisps/${conversation.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted/40 transition-colors"
                  data-testid={`link-circle-conversation-${conversation.id}`}
                >
                  <span>{t("whispDetail.anonymousVisitorWantsToTalk")}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(conversation.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Reveal flow */}
        {!isGhostBoost && !whisp.revealRequested && (
          <Button
            variant="outline"
            className="w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary"
            onClick={handleReveal}
            disabled={requestReveal.isPending}
            data-testid="button-reveal-yourself"
          >
            {requestReveal.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
            {t("whispDetail.revealYourself")}
          </Button>
        )}
        {!isGhostBoost && whisp.revealRequested && (
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4 text-center">
              <Eye className="w-6 h-6 text-primary mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">{t("whispDetail.revealRequestSent")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {whisp.revealAccepted === true
                  ? t("whispDetail.revealAccepted")
                  : whisp.revealAccepted === false
                  ? t("whispDetail.revealDeclined")
                  : t("whispDetail.revealWaiting")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
