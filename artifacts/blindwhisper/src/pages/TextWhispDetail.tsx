import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTextWhisp,
  useCreateTextWhispReply,
  usePingTextWhispTyping,
  useRequestTextWhispReveal,
  useRespondTextWhispReveal,
  useDeleteTextWhisp,
  useGetUserProfile,
  useGetMyNotifications,
  useMarkNotificationRead,
  getGetTextWhispQueryKey,
  getListTextWhispsQueryKey,
  getGetMyNotificationsQueryKey,
  getGetMyUnreadNotificationCountQueryKey,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { TextWhispScroll } from "@/components/shared/TextWhispScroll";
import { ReplyThread, ThreadComposer, type ThreadReply } from "@/components/shared/ReplyThread";
import { TimelineTrack, type TimelineStepData } from "@/components/shared/DeliveryTimelineTrack";
import { RevealCountdownDialog } from "@/components/shared/RevealCountdownDialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Eye, Loader2, MessageSquare, Trash2, Check, X, ChevronDown, CalendarClock, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";

// A reply that arrives while the page is open should feel instant, the way
// WhatsApp does, not like a page you have to leave and re-enter — and the
// same poll is what carries the other party's typing ping (see
// otherPartyTyping below). 4s, faster than WhispDetail's 15s: a video Whisp
// thread is occasional back-and-forth where sub-15s latency buys nothing,
// but a typing indicator that lags 15s behind reality just looks broken.
const LIVE_POLL_MS = 4_000;
// Debounces the "I'm typing…" ping (POST /:id/typing) to roughly once per
// this many ms of active typing, rather than one per keystroke — the ping's
// own TYPING_TTL_MS server-side (routes/textWhisps.ts) is 8s, so pinging
// more often than every ~3s wouldn't make the other party's indicator
// noticeably fresher, just noisier.
const TYPING_PING_THROTTLE_MS = 3_000;
const REPLY_MAX_LENGTH = 260;
// How long the "tap to discover" button sits in its own loading state before
// the name actually appears — the data (revealedSenderName) is already in
// hand from the GET that landed this page, so this isn't a network wait,
// it's a deliberately manufactured beat of suspense before the payoff.
const DISCOVER_SUSPENSE_MS = 1400;

export function TextWhispDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation("textWhisp");
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadReply | null>(null);
  const [opened, setOpened] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [revealCountdownOpen, setRevealCountdownOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [identityRevealed, setIdentityRevealed] = useState(false);
  const discoverButtonRef = useRef<HTMLButtonElement>(null);

  const { data: profile } = useGetUserProfile();
  // Polled while this page is open — see LIVE_POLL_MS above — so a reply (or
  // the other party's typing ping) that arrives while the sender/recipient
  // is already reading the thread shows up on its own, the way a live chat
  // does, instead of only appearing after a manual reload.
  const { data, isLoading } = useGetTextWhisp(id!, {
    query: { enabled: !!id, queryKey: getGetTextWhispQueryKey(id!), refetchInterval: LIVE_POLL_MS, refetchIntervalInBackground: false },
  });

  const createReply = useCreateTextWhispReply();
  const pingTyping = usePingTextWhispTyping();
  const requestReveal = useRequestTextWhispReveal();
  const respondReveal = useRespondTextWhispReveal();
  const deleteTextWhisp = useDeleteTextWhisp();

  // Same live cadence as the thread itself, so a reply notification for
  // THIS thread that lands while the viewer is already looking at it gets
  // cleared (see the effect below) about as fast as the reply itself
  // appears — not just whenever the notification bell's own 60s poll
  // happens to catch up.
  const { data: notifications } = useGetMyNotifications({
    query: { queryKey: getGetMyNotificationsQueryKey(), refetchInterval: LIVE_POLL_MS, refetchIntervalInBackground: false },
  });
  const markRead = useMarkNotificationRead();
  const markReadAsync = markRead.mutateAsync;
  // Which notification ids this page has already asked the server to mark
  // read — NOT a permanent one-shot latch like RepliesInbox's own version,
  // since staying on this page across several live-arriving replies should
  // keep clearing each NEW one as it shows up, not just whatever was
  // already unread at mount.
  const markedNotificationIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!id || !notifications?.items) return;
    const url = `/text-whisps/${id}`;
    const toMark = notifications.items.filter(
      (n) => n.kind === "reply" && !n.read && n.url === url && !markedNotificationIdsRef.current.has(n.id),
    );
    if (toMark.length === 0) return;
    toMark.forEach((n) => markedNotificationIdsRef.current.add(n.id));
    // A reply notification for the thread the viewer is DIRECTLY looking at
    // right now is, by definition, already seen — leaving it unread would
    // show a red/yellow dot on the Replies tab and a badge in the bell for
    // something the viewer has already read live, seconds after it arrived.
    void Promise.allSettled(toMark.map((n) => markReadAsync({ id: n.id }))).then(() => {
      queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyUnreadNotificationCountQueryKey() });
    });
  }, [id, notifications, markReadAsync, queryClient]);

  const lastTypingPingAtRef = useRef(0);
  function handleReplyTextChange(value: string) {
    setReplyText(value);
    if (!value.trim() || !id) return;
    const now = Date.now();
    if (now - lastTypingPingAtRef.current < TYPING_PING_THROTTLE_MS) return;
    lastTypingPingAtRef.current = now;
    pingTyping.mutate({ id });
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-16">
          <p className="text-muted-foreground">{t("textWhispDetail.notFound")}</p>
          <Button variant="ghost" onClick={() => setLocation("/text-whisps")} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> {t("textWhispDetail.backButton")}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { textWhisp, replies } = data;
  const isSender = profile?.id === textWhisp.senderId;
  const isRecipient = textWhisp.viewerIsRecipient;
  // The recipient gets the closed-scroll "moment"; the sender (viewing their
  // own sent message) sees it already open — there's nothing to unwrap for
  // the person who wrote it.
  const startsClosed = isRecipient && !opened;

  // fromRecipient is derivable purely from senderId, without any dedicated
  // field on the reply itself: a Text Whisp thread only ever has two
  // possible authors, and textWhisp.senderId (never anti-enumeration-masked
  // — only recipientUserId is) already identifies one of them, so "not the
  // original sender" always means "the recipient" here.
  const threadReplies: ThreadReply[] = replies.map((reply) => ({
    id: reply.id,
    replyText: reply.replyText,
    fromRecipient: reply.senderId !== textWhisp.senderId,
    parentReplyId: reply.parentReplyId,
    createdAt: reply.createdAt,
    readAt: reply.readAt,
  }));

  // Sender-facing funnel timeline — the Text Whisp equivalent of
  // WhispDetail.tsx's own timelineSteps, built from the exact same shared
  // TimelineTrack component so the two features read as one product. Only
  // three real stages exist here: unlike a video Whisp, an in-app Text
  // Whisp has no observable "delivered vs opened" distinction to show (SMS/
  // push delivery isn't tracked at that granularity) — so this deliberately
  // does NOT invent a "Delivered" step with no real backing signal, the
  // same "never claim a status the data doesn't support" discipline the
  // Personal Recap feature follows. Sent and Read are always real (createdAt/
  // readAt); Replied reuses the same "first reply FROM the recipient"
  // lookup WhispDetail.tsx's own timeline uses.
  const recipientReplied = threadReplies.some((r) => r.fromRecipient);
  const textWhispTimelineSteps: TimelineStepData[] = [
    { label: t("textWhispDetail.timeline.sent"), time: textWhisp.createdAt, done: true },
    {
      label: t("textWhispDetail.timeline.read"),
      time: textWhisp.readAt,
      done: !!textWhisp.readAt,
      active: !textWhisp.readAt,
    },
    {
      label: t("textWhispDetail.timeline.replied"),
      time: threadReplies.find((r) => r.fromRecipient)?.createdAt,
      done: recipientReplied,
      active: !!textWhisp.readAt && !recipientReplied,
    },
  ];
  // Furthest stage actually reached — shown in the header while collapsed.
  const textWhispCurrentStage = textWhispTimelineSteps.filter((s) => s.done).at(-1)?.label ?? null;

  function handleReply() {
    if (!replyText.trim()) return;
    createReply.mutate(
      { id: textWhisp.id, data: { replyText: replyText.trim(), ...(replyingTo ? { parentReplyId: replyingTo.id } : {}) } },
      {
        onSuccess: () => {
          setReplyText("");
          setReplyingTo(null);
          queryClient.invalidateQueries({ queryKey: getGetTextWhispQueryKey(id!) });
        },
        onError: () => toast({ title: t("textWhispDetail.toastReplyFailed"), variant: "destructive" }),
      },
    );
  }

  function handleReveal() {
    requestReveal.mutate(
      { id: textWhisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTextWhispQueryKey(id!) });
          toast({ title: t("textWhispDetail.toastRevealRequestSent") });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? t("textWhispDetail.toastRevealRequestFailed"), variant: "destructive" }),
      },
    );
  }

  function handleRespondReveal(accepted: boolean) {
    respondReveal.mutate(
      { id: textWhisp.id, data: { accepted } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTextWhispQueryKey(id!) });
          toast({ title: accepted ? t("textWhispDetail.toastRevealAccepted") : t("textWhispDetail.toastRevealDeclined") });
        },
        onError: () => toast({ title: t("textWhispDetail.toastRespondFailed"), variant: "destructive" }),
      },
    );
  }

  // The recipient has already consented (revealAccepted) and the server has
  // already sent revealedSenderName down with this page's own data — so this
  // isn't fetching anything, it's staging the reveal as its own deliberate
  // moment instead of just printing a name inline the instant consent is
  // given. The button stays in a loading state for DISCOVER_SUSPENSE_MS
  // before the name appears alongside the confetti burst.
  function handleDiscoverSender() {
    if (discovering || identityRevealed) return;
    setDiscovering(true);
    setTimeout(() => {
      setDiscovering(false);
      setIdentityRevealed(true);
      const rect = discoverButtonRef.current?.getBoundingClientRect();
      confetti({
        particleCount: 90,
        spread: 75,
        startVelocity: 38,
        origin: rect
          ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
          : { y: 0.6 },
        colors: ["#7C5CFC", "#FF6B6B", "#a78bfa", "#F5F0E8"],
        disableForReducedMotion: true,
      });
    }, DISCOVER_SUSPENSE_MS);
  }

  // Sends focus to the reply composer already rendered further up this same
  // page (see the "Replies" card), rather than threading a ref down through
  // ReplyThread/ThreadComposer for what's a single opportunistic nudge — its
  // Textarea's data-testid is already a stable, unique selector on this page.
  function handleFocusReplyComposer() {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="text-whisp-composer-input"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }

  function handleDelete() {
    deleteTextWhisp.mutate(
      { id: textWhisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTextWhispsQueryKey() });
          setLocation("/text-whisps");
          toast({ title: t("textWhispDetail.toastDeleted") });
        },
        onError: () => toast({ title: t("textWhispDetail.toastDeleteFailed"), variant: "destructive" }),
      },
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/text-whisps")} className="text-muted-foreground -ml-2" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("textWhispDetail.backButton")}
          </Button>
          <div className="flex items-center gap-1">
            {/* Duplicate of the full Reveal button further down the page —
                that one sits below the scroll, the delivery timeline, and
                the whole reply thread, so it's easy to never scroll to.
                Same handler, same gating, just reachable without scrolling. */}
            {isSender && !textWhisp.revealRequested && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRevealCountdownOpen(true)}
                disabled={requestReveal.isPending}
                className="text-primary hover:bg-primary/10 min-w-11 min-h-11"
                aria-label={t("textWhispDetail.revealYourselfButton")}
                data-testid="button-reveal-yourself-text-whisp-header"
              >
                <Eye className="w-4 h-4" />
              </Button>
            )}
            {isSender && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleteTextWhisp.isPending}
                    className="text-muted-foreground hover:text-destructive min-w-11 min-h-11"
                    data-testid="button-delete-text-whisp"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("textWhispDetail.deleteDialogTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("textWhispDetail.deleteDialogDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("textWhispDetail.cancelButton")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="button-confirm-delete-text-whisp"
                    >
                      {t("textWhispDetail.deleteButton")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Single shared instance for both the header shortcut above and the
            full button further down — deliberately NOT gated on
            `!textWhisp.revealRequested` the way the two trigger buttons are,
            so a reveal that just succeeded (which flips that flag via the
            query invalidation in handleReveal) doesn't unmount this mid-way
            through its own 2s aborted/revealed result display. */}
        {isSender && (
          <RevealCountdownDialog open={revealCountdownOpen} onOpenChange={setRevealCountdownOpen} onConfirm={handleReveal} />
        )}

        {/* A dark "scene" gutter around the parchment card so the warm accent
            reads as an intentional focal moment, not a light-mode patch. */}
        <div className="rounded-2xl bg-gradient-to-b from-background to-card/60 border border-border/30 py-8 px-4">
          <TextWhispScroll
            mode="open"
            messageText={textWhisp.messageText}
            senderAlias={textWhisp.senderAlias}
            createdAt={textWhisp.createdAt}
            onOpened={() => setOpened(true)}
            initiallyOpen={!startsClosed}
          />
        </div>

        {/* Delivery timeline — sender-facing only, mirroring WhispDetail.tsx's
            own timeline exactly (same reasoning: the recipient doesn't need
            to watch their own read receipt happen). A scheduled send hasn't
            gone out yet, so it gets its own pre-Sent state instead of a
            track whose first step would misleadingly already read "done". */}
        {isSender && textWhisp.status === "scheduled" && textWhisp.scheduledAt && (
          <Card className="bg-card border-border/50">
            <CardContent className="p-4 flex items-center gap-2 text-sm text-violet-400">
              <CalendarClock className="w-4 h-4 flex-shrink-0" />
              {t("textWhispDetail.scheduledToSend", {
                date: new Date(textWhisp.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </CardContent>
          </Card>
        )}
        {isSender && textWhisp.status !== "scheduled" && (
          <Card className="bg-card border-border/50">
            {/* Collapsible, same as WhispDetail.tsx's timeline card — once a
                Text Whisp has been read (or replied to) it's settled
                history, and open by default since "did they see it?" is the
                reason most senders open this page at all. */}
            <button
              type="button"
              onClick={() => setTimelineOpen((open) => !open)}
              aria-expanded={timelineOpen}
              aria-controls="text-whisp-delivery-timeline"
              data-testid="button-toggle-text-whisp-timeline"
              className="flex w-full items-center gap-2 px-6 py-4 text-left"
            >
              <CardTitle className="text-base font-serif">{t("textWhispDetail.deliveryTimeline")}</CardTitle>
              {!timelineOpen && textWhispCurrentStage && (
                <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {textWhispCurrentStage}
                </span>
              )}
              <ChevronDown
                className={`ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${
                  timelineOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {timelineOpen && (
              <CardContent id="text-whisp-delivery-timeline" className="pt-0">
                <TimelineTrack steps={textWhispTimelineSteps} />
              </CardContent>
            )}
          </Card>
        )}

        {(!isRecipient || opened) && (
          <>
            {/* The anonymous conversation — thread and composer in one card,
                same shared component (and same "reply-to-a-specific-message"
                threading) WhispDetail's video-Whisp conversation uses, so the
                two feel like the same product rather than two different
                reply experiences. */}
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-serif flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" /> {t("textWhispDetail.repliesHeading")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {textWhisp.otherPartyTyping && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-other-party-typing">
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-primary typing-dot" />
                      <span className="w-1 h-1 rounded-full bg-primary typing-dot" />
                      <span className="w-1 h-1 rounded-full bg-primary typing-dot" />
                    </span>
                    {t("textWhispDetail.typingIndicator")}
                  </p>
                )}
                <ReplyThread
                  replies={threadReplies}
                  viewerIsRecipient={isRecipient}
                  ownLabel={t("textWhispDetail.fromMe")}
                  otherLabel={t("textWhispDetail.fromThem")}
                  replyingTo={replyingTo}
                  onReplyTo={setReplyingTo}
                  emptyState={
                    <p className="text-xs text-muted-foreground text-center py-3">
                      {t("textWhispDetail.noRepliesYet")}
                    </p>
                  }
                  composer={
                    <ThreadComposer
                      value={replyText}
                      onChange={handleReplyTextChange}
                      onSend={handleReply}
                      sending={createReply.isPending}
                      placeholder={t("textWhispDetail.replyPlaceholder")}
                      maxLength={REPLY_MAX_LENGTH}
                      testIdPrefix="text-whisp"
                    />
                  }
                />
              </CardContent>
            </Card>

            {/* Reveal flow — the button is always offered to the sender; the
                API alone decides (and reports, via a toast on failure)
                whether the recipient has actually joined yet. This is
                deliberate: the frontend never pre-checks or displays
                eligibility ahead of time, since that would let a sender
                learn whether an arbitrary phone number belongs to a
                verified Blind Whisper account without ever attempting a
                reveal — see routes/textWhisps.ts's toResponse() and its
                ANTI-ENUMERATION comment. */}
            {isSender && !textWhisp.revealRequested && (
              <Button
                variant="outline"
                className="w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={() => setRevealCountdownOpen(true)}
                disabled={requestReveal.isPending}
                data-testid="button-reveal-yourself-text-whisp"
              >
                {requestReveal.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {t("textWhispDetail.revealYourselfButton")}
              </Button>
            )}
            {isSender && textWhisp.revealRequested && (
              <Card className="bg-primary/10 border-primary/20">
                <CardContent className="p-4 text-center">
                  <Eye className="w-6 h-6 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">{t("textWhispDetail.revealRequestSentTitle")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {textWhisp.revealAccepted === true
                      ? t("textWhispDetail.revealAcceptedMessage")
                      : textWhisp.revealAccepted === false
                      ? t("textWhispDetail.revealDeclinedMessage")
                      : t("textWhispDetail.revealWaitingMessage")}
                  </p>
                </CardContent>
              </Card>
            )}
            {isRecipient && textWhisp.revealRequested && textWhisp.revealAccepted == null && (
              <Card className="bg-primary/10 border-primary/20">
                <CardContent className="p-4 space-y-3 text-center">
                  <Eye className="w-6 h-6 text-primary mx-auto" />
                  <p className="text-sm font-medium text-foreground">
                    {t("textWhispDetail.revealAskMessage")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("textWhispDetail.revealPermissionNote")}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => handleRespondReveal(false)}
                      disabled={respondReveal.isPending}
                      data-testid="button-decline-reveal-text-whisp"
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> {t("textWhispDetail.declineButton")}
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={() => handleRespondReveal(true)}
                      disabled={respondReveal.isPending}
                      data-testid="button-accept-reveal-text-whisp"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> {t("textWhispDetail.acceptButton")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {/* The actual payoff — consent (revealAccepted) was already given
                above, but the name itself only appears once tapped, so
                accepting and discovering stay two distinct beats instead of
                one. identityRevealed is local UI state, not server state: a
                refresh re-arms the suspense, since the server already sends
                revealedSenderName down every time this page loads and there's
                no reason to force everyone through the animation exactly
                once ever. */}
            {isRecipient && textWhisp.revealAccepted === true && (
              <Card className="bg-primary/10 border-primary/20 overflow-hidden">
                <CardContent className="p-5 text-center space-y-3">
                  {!identityRevealed ? (
                    <>
                      <Eye className="w-6 h-6 text-primary mx-auto" />
                      <p className="text-sm font-medium text-foreground">{t("textWhispDetail.discoverPrompt")}</p>
                      <Button
                        ref={discoverButtonRef}
                        onClick={handleDiscoverSender}
                        disabled={discovering}
                        className="rounded-full"
                        data-testid="button-discover-sender"
                      >
                        {discovering ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        {discovering ? t("textWhispDetail.discovering") : t("textWhispDetail.discoverButton")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t("textWhispDetail.revealedLabel")}
                      </p>
                      <p className="text-2xl font-serif font-bold text-foreground" data-testid="text-revealed-sender-name">
                        {textWhisp.revealedSenderName ?? t("textWhispDetail.revealedNameFallback")}
                      </p>
                      <p className="text-sm text-muted-foreground">{t("textWhispDetail.keepGoingPrompt")}</p>
                      <Button
                        variant="outline"
                        className="rounded-full"
                        onClick={handleFocusReplyComposer}
                        data-testid="button-reply-after-reveal"
                      >
                        <MessageSquare className="w-4 h-4 mr-2" /> {t("textWhispDetail.replyNowButton")}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
