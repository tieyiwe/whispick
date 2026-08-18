import { useParams, useLocation } from "wouter";
import {
  useGetWhisp,
  useCreateWhispReply,
  useRequestReveal,
  useDeleteWhisp,
  useGetGhostBoostMatches,
  getGetGhostBoostMatchesQueryKey,
  getGetWhispQueryKey,
  getListWhispsQueryKey,
  getGetWhispStatsQueryKey,
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
import { ReplyThread, ThreadComposer, type ThreadReply } from "@/components/shared/ReplyThread";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  ArrowLeft,
  PlayCircle,
  Send,
  Eye,
  Check,
  Clock,
  MessageSquare,
  Loader2,
  Trash2,
  UserCircle2,
  HeartHandshake,
  Sparkles,
  Users,
  Lock,
  ChevronDown,
} from "lucide-react";
import { deliveryLabel } from "@/lib/deliveryMethod";

type TimelineStepData = {
  label: string;
  /** Spelled out on hover/long-press when the label had to be shortened to
   *  survive six steps across a phone screen. */
  fullLabel?: string;
  time?: string | Date | null;
  done: boolean;
  active?: boolean;
};

// The full timestamp (toLocaleString) was fine stacked vertically with a whole
// row to itself; across a horizontal track it's the widest thing on screen by
// far. Same-day steps — the common case while a whisp is live — only need the
// clock time.
function compactTime(value: string | Date): string {
  const date = new Date(value);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// One horizontal track rather than six stacked rows. Vertically this card ran
// most of a phone screen on its own, pushing the conversation — the part
// worth coming back for — below the fold.
function TimelineTrack({ steps }: { steps: TimelineStepData[] }) {
  return (
    // Scrolls rather than crushes: six steps fit a typical phone, but a
    // narrow screen or large text size shouldn't squeeze the labels into
    // unreadable slivers.
    <div className="flex overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <div key={step.label} className="relative flex min-w-[54px] flex-1 flex-col items-center">
          {/* Connector back to the previous step, tinted only when this step
              is reached — so the filled portion of the track reads as
              progress at a glance, before any label is read. */}
          {i > 0 && (
            <span
              aria-hidden
              className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${
                step.done ? "bg-primary" : "bg-border"
              }`}
            />
          )}
          <div
            title={step.fullLabel ?? step.label}
            className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all ${
              step.done
                ? "bg-primary text-primary-foreground"
                : step.active
                ? "border-2 border-primary bg-card"
                : "border border-border bg-muted"
            }`}
          >
            {step.done ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
          </div>
          <p
            className={`mt-1.5 px-0.5 text-center text-[10px] leading-tight ${
              step.done ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {step.label}
          </p>
          <p className="text-center text-[10px] leading-tight text-muted-foreground/70">
            {step.time ? compactTime(step.time) : step.done ? "" : "—"}
          </p>
        </div>
      ))}
    </div>
  );
}

export function WhispDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadReply | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(true);

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
          <p className="text-muted-foreground">Whisp not found.</p>
          <Button variant="ghost" onClick={() => setLocation("/whisps")} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to whisps
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { whisp, trackingEvents, replies, recipientRepliesRemaining } = data;

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
          toast({ title: "Follow-up sent" });
        },
        onError: () => toast({ title: "Failed to send", variant: "destructive" }),
      }
    );
  }

  function handleReveal() {
    requestReveal.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
          toast({ title: "Reveal request sent" });
        },
        onError: () => toast({ title: "Failed to request reveal", variant: "destructive" }),
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
          toast({ title: "Whisp deleted" });
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
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
    { label: "Sent", time: whisp.createdAt, done: true },
    { label: "Delivered", time: whisp.deliveredAt, done: !!whisp.deliveredAt },
    {
      label: "Opened",
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
      label: watchedInFull ? "Watched all" : "Watched",
      fullLabel: watchedInFull ? "Watched all the way through" : "Started watching",
      time: whisp.watchedAt,
      done: !!whisp.watchedAt,
      active: !!whisp.openedAt && !whisp.watchedAt,
    },
    {
      label: "Replied",
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
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
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
                <AlertDialogTitle>Delete this whisp?</AlertDialogTitle>
                <AlertDialogDescription>
                  {replies.length > 0
                    ? `This whisp has ${replies.length === 1 ? "a reply" : `${replies.length} replies`} from the recipient. Deleting it removes it — and that ${replies.length === 1 ? "reply" : "reply thread"} — from your whisps. This can't be undone from your side.`
                    : "This removes the whisp from your whisps. This can't be undone from your side."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete-whisp"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Video preview */}
        <Card className="bg-card border-border/50 overflow-hidden">
          {whisp.videoThumbnail ? (
            <div className="relative h-48 overflow-hidden">
              <img src={whisp.videoThumbnail} alt="Video" className="w-full h-full object-cover" />
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
                <h2 className="font-serif font-semibold text-lg text-foreground">{whisp.videoTitle || "Video"}</h2>
                <p className="text-sm text-muted-foreground">
                  {isGhostBoost
                    ? matchStats && matchStats.matchedCount > 0
                      ? `Matched to ${matchStats.matchedCount} subscriber${matchStats.matchedCount === 1 ? "" : "s"}`
                      : whisp.status === "failed"
                      ? "No matching subscribers were found in time"
                      : "Looking for a match among subscribers..."
                    : `Sent to ${whisp.recipientEmail || whisp.recipientPhone || (whisp.deliveryMethod === "circle_drop" ? "Blind Circle feed" : "recipient")}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Via {deliveryLabel(whisp.deliveryMethod, whisp.whisperChannel)} · {new Date(whisp.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={whisp.status} />
            </div>
            {whisp.status === "scheduled" && whisp.scheduledAt && (
              <p className="text-xs text-violet-400 mb-2">
                Scheduled to send {new Date(whisp.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
            {isGhostBoost && matchStats && matchStats.matchedCount > 0 && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1 pb-2 flex-wrap" data-testid="ghost-boost-match-stats">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {matchStats.matchedCount} matched</span>
                <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {matchStats.openedCount} opened</span>
                <span className="flex items-center gap-1"><PlayCircle className="w-3.5 h-3.5" /> {matchStats.watchedCount} watched</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {matchStats.repliedCount} replied</span>
                {matchStats.appreciatedCount > 0 && (
                  <span className="flex items-center gap-1 text-primary"><HeartHandshake className="w-3.5 h-3.5" /> {matchStats.appreciatedCount} appreciated</span>
                )}
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
                <p className="text-sm text-foreground">They said this was something they needed to hear</p>
              </div>
            ) : whisp.appreciationResponse ? (
              <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
                <HeartHandshake className="w-4 h-4" />
                They said this wasn't quite what they needed
              </p>
            ) : null}
            {whisp.aiTakeawayStatus === "ready" && whisp.aiTakeaway && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1">
                <p className="text-xs font-semibold tracking-wide text-primary uppercase flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Takeaway they got
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
            <CardTitle className="text-base font-serif">Delivery Timeline</CardTitle>
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
                Anonymous conversation
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
                    They've used all their anonymous replies.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    They can't reply again unless you add more replies, or they create a free account. You can still
                    send follow-ups.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled
                    data-testid="button-buy-more-replies"
                  >
                    Add more replies (coming soon)
                  </Button>
                </div>
              )}
              {typeof recipientRepliesRemaining === "number" && recipientRepliesRemaining === 1 && (
                <p className="mb-3 text-xs text-muted-foreground" data-testid="text-recipient-replies-remaining">
                  They have 1 anonymous reply left.
                </p>
              )}
              <ReplyThread
                replies={replies}
                viewerIsRecipient={false}
                otherLabel="Recipient"
                replyingTo={replyingTo}
                onReplyTo={setReplyingTo}
                emptyState={
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No replies yet. You can send another anonymous message below.
                  </p>
                }
                composer={
                  <ThreadComposer
                    value={replyText}
                    onChange={setReplyText}
                    onSend={handleSendFollowUp}
                    sending={createReply.isPending}
                    placeholder="Send another anonymous message..."
                    testIdPrefix="follow-up"
                  />
                }
              />
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
            Reveal Yourself
          </Button>
        )}
        {!isGhostBoost && whisp.revealRequested && (
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4 text-center">
              <Eye className="w-6 h-6 text-primary mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">Reveal request sent</p>
              <p className="text-xs text-muted-foreground mt-1">
                {whisp.revealAccepted === true
                  ? "They accepted! You can now reveal your identity."
                  : whisp.revealAccepted === false
                  ? "They declined the reveal."
                  : "Waiting for the recipient to respond..."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
