import { useParams, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useUser } from "@clerk/react";
import {
  useGetPublicWhisp,
  useTrackWhispEvent,
  usePublicReply,
  useRespondReveal,
  useScrapeVideoMeta,
  useSubmitAppreciation,
  useRequestWhispReminder,
  useRequestVideoReply,
  getGetPublicWhispQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MoodTag, MOOD_CONFIG } from "@/components/shared/MoodTag";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, Video, X, Link2, HeartHandshake, Clock, BellRing, Sparkles, UserCircle2, PlayCircle, PenLine, Lock } from "lucide-react";
import { LogoLockup } from "@/components/ui/logo";
import { VideoPlayer } from "@/components/shared/VideoPlayer";
import { QUICK_REPLIES } from "@/lib/quickReplies";
import { ReplyThread, type ThreadReply } from "@/components/shared/ReplyThread";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { REMINDER_PRESETS, MAX_REMINDERS } from "@/lib/reminderPresets";
import { savePendingForward } from "@/lib/forwardVideo";

function BlindWhisperLogoMark() {
  return (
    // A recipient's first and often only sight of the brand, so the lockup
    // gets its full form here — mark at a real size, with the strapline.
    <LogoLockup tagline />
  );
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function TakeawayCard({ text }: { text: string }) {
  const sentences = splitSentences(text);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 space-y-2.5"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
        <Sparkles className="w-3.5 h-3.5" /> Takeaway
      </div>
      <div className="space-y-2">
        {sentences.map((sentence, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.45, duration: 0.5, ease: "easeOut" }}
            className="text-foreground font-serif text-[15px] leading-relaxed"
          >
            {sentence}
          </motion.p>
        ))}
      </div>
    </motion.div>
  );
}

export function PublicWhispPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadReply | null>(null);
  const [hasTrackedOpen, setHasTrackedOpen] = useState(false);
  const [revealResponse, setRevealResponse] = useState<"accepted" | "declined" | null>(null);
  const [localAppreciation, setLocalAppreciation] = useState<"yes" | "no" | null>(null);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [reminderScheduled, setReminderScheduled] = useState<{ nextReminderAt: string; isFinal: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [justWatched, setJustWatched] = useState(false);

  // This is a private, single-recipient page — never indexable, even if a
  // link to it ends up publicly posted somewhere. robots.txt disallows /w/
  // for well-behaved crawlers, but a noindex tag also stops a page from
  // being indexed off a discovered backlink alone.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
  const [showVideoReply, setShowVideoReply] = useState(false);
  const [replyVideoUrl, setReplyVideoUrl] = useState("");
  const [replyVideoMeta, setReplyVideoMeta] = useState<{
    title?: string | null;
    thumbnail?: string | null;
    embedUrl?: string | null;
    platform?: string;
  } | null>(null);
  const [replyVideoError, setReplyVideoError] = useState<string | null>(null);

  const { data: whisp, isLoading, refetch } = useGetPublicWhisp(token!, {
    query: {
      enabled: !!token,
      queryKey: getGetPublicWhispQueryKey(token!),
      // Two independent reasons to poll:
      //  - the takeaway generates asynchronously after watched_complete
      //    fires, so poll fast until it lands, then stop;
      //  - a sender's follow-up should appear in the thread while the
      //    recipient still has the page open, so keep a slower poll running
      //    for the life of the page once a conversation exists.
      refetchInterval: (query) => {
        if (justWatched && !query.state.data?.aiTakeawayStatus) return 3000;
        return query.state.data?.replies?.length ? 15_000 : false;
      },
      refetchIntervalInBackground: false,
    },
  });

  const trackEvent = useTrackWhispEvent();
  const publicReply = usePublicReply();
  const respondReveal = useRespondReveal();
  const scrapeReplyVideo = useScrapeVideoMeta();
  const submitAppreciation = useSubmitAppreciation();
  const requestReminder = useRequestWhispReminder();
  const requestVideoReply = useRequestVideoReply();

  // Keep the countdown fresh without refetching the whisp itself.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  function handleRemindMe(minutes: number) {
    requestReminder.mutate(
      { token: token!, data: { minutes } },
      {
        onSuccess: (result) => {
          setReminderScheduled({ nextReminderAt: result.nextReminderAt, isFinal: result.isFinal });
          setShowReminderPicker(false);
        },
        onError: () => toast({ title: "Couldn't schedule that reminder", variant: "destructive" }),
      }
    );
  }

  function handleAppreciation(appreciated: boolean) {
    submitAppreciation.mutate(
      { token: token!, data: { appreciated } },
      {
        onSuccess: () => setLocalAppreciation(appreciated ? "yes" : "no"),
        onError: () => toast({ title: "Something went wrong", variant: "destructive" }),
      }
    );
  }

  function handlePassItForward() {
    if (!whisp || whisp.videoPlatform === "upload") return;
    savePendingForward({
      videoUrl: whisp.videoUrl,
      videoTitle: whisp.videoTitle,
      videoThumbnail: whisp.videoThumbnail,
      videoEmbedUrl: whisp.videoEmbedUrl,
      videoPlatform: whisp.videoPlatform,
      videoStartSeconds: whisp.videoStartSeconds,
      videoEndSeconds: whisp.videoEndSeconds,
    });
    setLocation(isSignedIn ? "/send" : "/sign-up");
  }

  function handleRevealResponse(accepted: boolean) {
    if (!whisp?.id) return;
    respondReveal.mutate(
      { id: whisp.id, data: { accepted } },
      {
        onSuccess: () => setRevealResponse(accepted ? "accepted" : "declined"),
        onError: () => toast({ title: "Something went wrong", variant: "destructive" }),
      }
    );
  }

  // Track "opened" on page load
  if (whisp && !hasTrackedOpen) {
    setHasTrackedOpen(true);
    trackEvent.mutate({ token: token!, data: { eventType: "opened" } });
  }

  function handleWatchEvent(eventType: "clicked" | "watched_10s" | "watched_50pct" | "watched_complete") {
    trackEvent.mutate({ token: token!, data: { eventType } });
    if (eventType === "watched_complete") setJustWatched(true);
  }

  function submitReply(text: string, video?: { url: string; meta: typeof replyVideoMeta }) {
    publicReply.mutate(
      {
        token: token!,
        data: {
          replyText: text || null,
          videoUrl: video?.url ?? null,
          videoTitle: video?.meta?.title ?? null,
          videoThumbnail: video?.meta?.thumbnail ?? null,
          videoEmbedUrl: video?.meta?.embedUrl ?? null,
          videoPlatform: video?.meta?.platform ?? null,
          ...(replyingTo ? { parentReplyId: replyingTo.id } : {}),
        },
      },
      {
        onSuccess: () => {
          setReplyText("");
          setReplyingTo(null);
          setShowVideoReply(false);
          setReplyVideoUrl("");
          setReplyVideoMeta(null);
          queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) });
          toast({ title: "Reply sent anonymously" });
        },
        onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
      }
    );
  }

  function handleFetchReplyVideo() {
    const url = replyVideoUrl.trim();
    if (!url) return;
    setReplyVideoError(null);
    scrapeReplyVideo.mutate(
      { data: { url } },
      {
        onSuccess: (meta) => setReplyVideoMeta(meta),
        onError: (err: any) => {
          const code = err?.data?.code;
          if (code === "video_private" || code === "video_not_found") {
            // A private/deleted video isn't something we can quietly work
            // around here — the sender wouldn't be able to open it either,
            // so surface it instead of attaching a dead link to the reply.
            setReplyVideoError(err.data.error);
            return;
          }
          // Any other scrape failure is inconclusive (network hiccup, a
          // platform we just couldn't parse) — same tolerant fallback the
          // sender's own composer uses, so a reply video can still be
          // attached with unknown metadata rather than blocked outright.
          setReplyVideoMeta({ platform: "other" });
        },
      }
    );
  }

  // Whisping a video back needs an account, or credit the sender bought for
  // this whisp. Text replies are unaffected — the gate is on the one action
  // that costs storage and moderation, and it's the natural moment to ask an
  // anonymous recipient to join rather than an interruption.
  const videoRepliesLocked = whisp ? whisp.videoRepliesAllowed === false : false;

  function handleVideoReplyClick() {
    if (!videoRepliesLocked) {
      setShowVideoReply(true);
      return;
    }
    // Tell the sender their recipient wanted to send something back, so they
    // can unlock it. Fire-and-forget: the sign-up prompt is what matters here
    // and shouldn't wait on it, and the server ignores repeats anyway.
    requestVideoReply.mutate({ token: token! });
    toast({
      title: "Create a free account to whisp a video back",
      description: "We've let the sender know too — they can unlock video replies for you.",
    });
    setLocation("/sign-up");
  }

  function handleReply() {
    const video = replyVideoUrl.trim();
    if (!replyText.trim() && !video) return;
    submitReply(replyText.trim(), video ? { url: video, meta: replyVideoMeta } : undefined);
  }

  const moodColor = (whisp?.moodTag && MOOD_CONFIG[whisp.moodTag]?.color) || "#7C5CFC";
  const appreciationResponse = localAppreciation ?? whisp?.appreciationResponse ?? null;

  const expired = whisp?.expired ?? false;
  const expiresAtMs = whisp?.expiresAt ? new Date(whisp.expiresAt).getTime() : null;
  const remainingMs = expiresAtMs ? expiresAtMs - now : null;
  const remindersUsedUp = (whisp?.reminderCount ?? 0) >= MAX_REMINDERS;
  const canRemind = !!expiresAtMs && !expired && !reminderScheduled && !remindersUsedUp;
  const availablePresets = expiresAtMs
    ? REMINDER_PRESETS.filter((p) => now + p.minutes * 60_000 < expiresAtMs)
    : [];

  return (
    <PullToRefresh onRefresh={() => refetch()}>
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      {/* Ambient background, tinted by the whisp's mood */}
      <div
        className="absolute top-[-15%] left-[-15%] w-[70%] h-[45%] rounded-full blur-[110px] pointer-events-none transition-colors duration-700"
        style={{ backgroundColor: moodColor, opacity: 0.16 }}
      />
      <div
        className="absolute bottom-[-10%] right-[-15%] w-[55%] h-[35%] rounded-full blur-[100px] pointer-events-none transition-colors duration-700"
        style={{ backgroundColor: moodColor, opacity: 0.1 }}
      />

      {/* Header */}
      <header
        className="px-5 pb-5 flex items-center justify-between border-b border-border/30 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <BlindWhisperLogoMark />
        <a
          href="/sign-up"
          className="text-xs text-muted-foreground hover:text-primary transition-colors py-2"
        >
          Become a Whisperer
        </a>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-5 py-10 space-y-7 relative z-10">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-48 mx-auto" />
            <Skeleton className="h-52 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : !whisp ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">This whisp could not be found.</p>
          </div>
        ) : (
          <>
            {/* Lead text — keep in sync with api-server's lib/copy.ts HOOK_LINE/groupHookLine */}
            <p className="text-center text-xl font-serif text-foreground leading-snug">
              {whisp.groupSize
                ? `Someone in your circle sent this anonymously — you're one of ${whisp.groupSize} people who got it 👀`
                : "Someone who cares about you thought you needed to see this 👀"}
            </p>

            {expired ? (
              <div className="rounded-2xl bg-card border border-border/50 p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
                  <Clock className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="font-medium text-foreground">This whisp has expired</p>
                <p className="text-sm text-muted-foreground">
                  Whoever sent it can always send you a new one.
                </p>
              </div>
            ) : (
              <>
            {remainingMs !== null && remainingMs > 0 && (
              <div
                className="flex items-center justify-center gap-1.5 text-xs font-medium rounded-full py-2 px-4 mx-auto w-fit"
                style={{ backgroundColor: `${moodColor}1f`, color: moodColor }}
                data-testid="text-expiry-countdown"
              >
                <Clock className="w-3.5 h-3.5" />
                Expires in {formatDistanceToNowStrict(expiresAtMs!)}
              </div>
            )}

            {/* Video card */}
            <div className="rounded-2xl overflow-hidden bg-card border border-border/50 glow-card">
              <VideoPlayer
                platform={whisp.videoPlatform}
                embedUrl={whisp.videoEmbedUrl}
                videoUrl={whisp.videoUrl}
                thumbnail={whisp.videoPlatform === "upload" ? `/api/public/w/${token}/media/thumbnail` : whisp.videoThumbnail}
                uploadSrc={whisp.videoPlatform === "upload" ? `/api/public/w/${token}/media` : null}
                title={whisp.videoTitle}
                startSeconds={whisp.videoStartSeconds}
                endSeconds={whisp.videoEndSeconds}
                onWatchEvent={handleWatchEvent}
              />

              <div className="p-5 space-y-3">
                {whisp.videoTitle && (
                  <p className="font-medium text-foreground">{whisp.videoTitle}</p>
                )}

                {whisp.moodTag && <MoodTag mood={whisp.moodTag} />}

                {/* The note is the most personal thing on this page, so it's
                    set as a quote card rather than a line of text against a
                    rule: its own surface, a serif open-quote, and the sender's
                    alias as a small gilded seal underneath. The alias is the
                    only identity a recipient ever gets, which is exactly why
                    it should look deliberate rather than like a footnote. */}
                {whisp.anonymousNote && (
                  <div className="relative rounded-2xl bg-primary/[0.07] border border-primary/20 px-5 py-4 mt-1">
                    <span
                      aria-hidden
                      className="absolute -top-2 left-4 font-serif text-5xl leading-none text-primary/30 select-none"
                    >
                      &ldquo;
                    </span>
                    <p className="text-foreground italic text-sm leading-relaxed relative">{whisp.anonymousNote}</p>
                    {whisp.senderAlias && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="h-px flex-1 bg-gradient-to-r from-gilded/40 to-transparent" />
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border border-gilded/30 bg-gilded/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-gilded"
                          data-testid="text-sender-alias"
                        >
                          <PenLine className="w-3 h-3" />
                          {whisp.senderAlias}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {whisp.aiTakeawayStatus === "ready" && whisp.aiTakeaway && <TakeawayCard text={whisp.aiTakeaway} />}

            {/* Appreciation prompt */}
            <div className="bg-card border border-border/50 rounded-2xl p-4 text-center space-y-2">
              {appreciationResponse ? (
                <>
                  <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                    <HeartHandshake className="w-4 h-4 text-primary" />
                    {appreciationResponse === "yes" ? "Glad this reached you." : "Thanks for letting them know."}
                  </p>
                  {appreciationResponse === "yes" && whisp.videoPlatform !== "upload" && (
                    <div className="pt-1 space-y-1.5">
                      <p className="text-xs text-muted-foreground">Know someone who needs this too?</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={handlePassItForward}
                        data-testid="button-pass-it-forward"
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" /> Pass it forward
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">Was this something you needed to hear?</p>
                  <div className="flex gap-2 justify-center pt-1">
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={() => handleAppreciation(true)}
                      disabled={submitAppreciation.isPending}
                      data-testid="button-appreciation-yes"
                    >
                      Yes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => handleAppreciation(false)}
                      disabled={submitAppreciation.isPending}
                      data-testid="button-appreciation-no"
                    >
                      Not really
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Reply section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-xs text-muted-foreground">
                  {whisp.replies.length > 0 ? "Anonymous conversation" : "Want to reply anonymously?"}
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>

              {whisp.replies.length > 0 && (
                <ReplyThread
                  replies={whisp.replies}
                  viewerIsRecipient
                  otherLabel={whisp.senderAlias || "The sender"}
                  replyingTo={replyingTo}
                  // No per-message Reply affordance when the composer below
                  // isn't going to be there — offering to answer a message
                  // and then showing an expired/out-of-replies notice instead
                  // is worse than not offering.
                  onReplyTo={
                    whisp.expired || whisp.recipientRepliesRemaining === 0 ? undefined : setReplyingTo
                  }
                />
              )}

              {(() => {
                const disabled = whisp.expired;
                if (disabled) {
                  return (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      This whisp has expired, so you can't reply anymore.
                    </p>
                  );
                }
                // Out of anonymous replies: signing up is the way to keep
                // going, so lead with that rather than a dead end. (The
                // sender can also add more — but that's their decision to
                // make, not something to promise the recipient here.)
                const remaining = whisp.recipientRepliesRemaining;
                if (remaining === 0) {
                  return (
                    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-center space-y-2" data-testid="reply-limit-reached">
                      <p className="text-sm text-foreground">You've used all your anonymous replies here.</p>
                      <p className="text-xs text-muted-foreground">
                        Create a free account to keep this conversation going — you'll still be anonymous to them.
                      </p>
                      <Button size="sm" className="rounded-full" onClick={() => setLocation("/sign-up")} data-testid="button-signup-for-replies">
                        Sign up to keep replying
                      </Button>
                    </div>
                  );
                }
                return (
                <div className="space-y-3">
                  {whisp.replies.length === 0 && (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {QUICK_REPLIES.map((qr) => (
                      <button
                        key={qr.key}
                        type="button"
                        onClick={() => submitReply(qr.text)}
                        disabled={publicReply.isPending}
                        data-testid={`quick-reply-${qr.key}`}
                        className="px-4 py-2.5 min-h-11 rounded-full border border-border/50 bg-card text-sm text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95 transition-all disabled:opacity-50"
                      >
                        {qr.text}
                      </button>
                    ))}
                  </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-border/40" />
                    <span className="text-xs text-muted-foreground">or write your own</span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  <Textarea
                    className="bg-card border-border/50 rounded-xl resize-none min-h-[80px]"
                    placeholder="Type your reply... (anonymous)"
                    maxLength={300}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    data-testid="textarea-public-reply"
                  />

                  {!showVideoReply ? (
                    // Answering with a video — not just text — is the thing
                    // this app does that a message thread doesn't, and it was
                    // sitting here as grey 12px text that read as a footnote.
                    // Given the weight of the action it needs to look like an
                    // offer: full width, dashed like an empty slot waiting to
                    // be filled, and saying what it actually gets you.
                    <button
                      type="button"
                      onClick={handleVideoReplyClick}
                      data-testid="button-show-video-reply"
                      className="group w-full flex items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/[0.06] px-4 py-3 text-left transition-colors hover:border-primary/70 hover:bg-primary/10 active:scale-[0.99]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                        {videoRepliesLocked ? <Lock className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">Whisp a video back</span>
                        <span className="block text-xs text-muted-foreground">
                          {videoRepliesLocked
                            ? "Needs a free account — your text replies still work"
                            : "Send a video with your reply — still anonymous"}
                        </span>
                      </span>
                      <PlayCircle className="h-4 w-4 shrink-0 text-primary/60 transition-colors group-hover:text-primary" />
                    </button>
                  ) : (
                    <div className="space-y-2 p-3 rounded-xl border border-primary/30 bg-primary/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary">
                            <Video className="h-3.5 w-3.5" />
                          </span>
                          Whisp a video back
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowVideoReply(false);
                            setReplyVideoUrl("");
                            setReplyVideoMeta(null);
                          }}
                          data-testid="button-remove-video-reply"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {replyVideoMeta ? (
                        <div className="flex gap-2 p-2 bg-card rounded-lg items-center">
                          {replyVideoMeta.thumbnail && (
                            <img src={replyVideoMeta.thumbnail} className="w-14 h-10 object-cover rounded" alt="thumbnail" />
                          )}
                          <p className="text-xs text-foreground truncate flex-1">{replyVideoMeta.title || replyVideoUrl}</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                              <Input
                                className="pl-8 h-9 text-xs bg-card border-border/50 rounded-lg"
                                placeholder="Paste a video link..."
                                value={replyVideoUrl}
                                onChange={(e) => { setReplyVideoUrl(e.target.value); setReplyVideoError(null); }}
                                data-testid="input-reply-video-url"
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-lg h-9"
                              onClick={handleFetchReplyVideo}
                              disabled={!replyVideoUrl.trim() || scrapeReplyVideo.isPending}
                              data-testid="button-fetch-reply-video"
                            >
                              {scrapeReplyVideo.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add"}
                            </Button>
                          </div>
                          {replyVideoError && (
                            <p className="text-xs text-destructive" data-testid="text-reply-video-error">{replyVideoError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Warn only when they're nearly out — showing a counter
                      from the very first reply would make an anonymous note
                      feel metered when there's no reason to think about it
                      yet. */}
                  {typeof remaining === "number" && remaining > 0 && remaining <= 2 && (
                    <p className="text-xs text-muted-foreground text-center" data-testid="text-replies-remaining">
                      {remaining === 1
                        ? "This is your last anonymous reply — sign up free to keep going."
                        : `${remaining} anonymous replies left.`}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{replyText.length}/300</span>
                    <Button
                      onClick={handleReply}
                      disabled={(!replyText.trim() && !replyVideoUrl.trim()) || publicReply.isPending}
                      size="sm"
                      className="rounded-full"
                      data-testid="button-send-reply"
                    >
                      {publicReply.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Send className="w-3 h-3 mr-1" />
                      )}
                      Send Reply
                    </Button>
                  </div>
                </div>
                );
              })()}
            </div>

            {/* Reveal section */}
            {whisp.revealRequested && (
              <div className="bg-card border border-primary/20 rounded-2xl p-4 text-center space-y-2">
                {revealResponse ? (
                  <p className="text-sm text-muted-foreground">
                    {revealResponse === "accepted"
                      ? "You've let them know it's okay to reveal themselves."
                      : "You've chosen to keep this anonymous."}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      The person who sent this wants to reveal themselves.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Do you want to know who sent this to you?
                    </p>
                    <div className="flex gap-2 justify-center pt-1">
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleRevealResponse(true)}
                        disabled={respondReveal.isPending}
                        data-testid="button-accept-reveal"
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => handleRevealResponse(false)}
                        disabled={respondReveal.isPending}
                        data-testid="button-decline-reveal"
                      >
                        Decline
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Remind me later */}
            {reminderScheduled ? (
              <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-primary" />
                {reminderScheduled.isFinal
                  ? "We'll remind you one last time — after that this whisp won't be available anymore."
                  : "We'll remind you before this whisp expires."}
              </p>
            ) : canRemind && availablePresets.length > 0 ? (
              showReminderPicker ? (
                <div className="bg-card border border-border/50 rounded-2xl p-4 text-center space-y-2">
                  <p className="text-sm font-medium text-foreground">When should we remind you?</p>
                  <div className="flex flex-wrap gap-2 justify-center pt-1">
                    {availablePresets.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => handleRemindMe(preset.minutes)}
                        disabled={requestReminder.isPending}
                        data-testid={`button-remind-${preset.key}`}
                        className="px-4 py-2 rounded-full border border-border/50 bg-background text-sm text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95 transition-all disabled:opacity-50"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowReminderPicker(true)}
                  data-testid="button-show-remind-picker"
                  className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <BellRing className="w-3.5 h-3.5" /> Remind me about this later
                </button>
              )
            ) : null}
              </>
            )}

            {/* Signup CTA — recipients never need an account to watch or reply,
                this is just an invite to send their own. */}
            <a
              href="/sign-up"
              className="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors p-4"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Have a video someone needs to see?</p>
                <p className="text-xs text-muted-foreground mt-0.5">Become a Whisperer — send your own, anonymously.</p>
              </div>
              <Sparkles className="w-5 h-5 text-primary shrink-0" />
            </a>

            {/* Ghost Boost matching CTA — a recipient who just felt what an
                anonymous whisp can do is a natural fit for the subscriber list. */}
            <a
              href="/subscribe"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card hover:bg-card/70 transition-colors p-4"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Want more, matched to you?</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get anonymous whisps like this sent to your inbox when they match topics you pick.
                </p>
              </div>
              <BellRing className="w-5 h-5 text-muted-foreground shrink-0" />
            </a>
          </>
        )}
      </main>

      {/* Footer */}
      <footer
        className="p-5 text-center border-t border-border/30 relative z-10"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <p className="text-xs text-muted-foreground">
          Powered by{" "}
          <a href="/" className="text-primary hover:underline">Blind Whisper</a>
          {" "}— send what matters, without the awkward part.
        </p>
      </footer>
    </div>
    </PullToRefresh>
  );
}
