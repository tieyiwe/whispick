import { useParams, useLocation } from "wouter";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  useToggleCircleLike,
  usePostCircleComment,
  useReactToCircleComment,
  useRenameCircleHandle,
  useStartCircleDm,
  useArchiveWhisp,
  getGetPublicWhispQueryKey,
  type CircleComment,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MoodTag, MOOD_CONFIG } from "@/components/shared/MoodTag";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, Video, X, Link2, HeartHandshake, Clock, BellRing, Sparkles, PlayCircle, PenLine, Lock, ChevronDown, ChevronLeft, Heart, MessageCircle, ImagePlus } from "lucide-react";
import { LogoLockup } from "@/components/ui/logo";
import { VideoPlayer } from "@/components/shared/VideoPlayer";
import { QUICK_REPLIES } from "@/lib/quickReplies";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { ReplyThread, type ThreadReply } from "@/components/shared/ReplyThread";
import { CircleCommentRow } from "@/components/shared/CircleCommentRow";
import { ArchivedWhispGate } from "@/components/shared/ArchivedWhispGate";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { REMINDER_PRESETS, MAX_REMINDERS } from "@/lib/reminderPresets";
import { savePendingForward } from "@/lib/forwardVideo";
import { getVisitorId } from "@/lib/anonymousVisitor";
import { getSavedCircleDmToken, saveCircleDmToken } from "@/lib/circleDm";
import { postCircleCommentWithImage, validateCommentImage, CommentImageValidationError } from "@/lib/postCircleComment";

function BlindWhisperLogoMark({ href }: { href: string }) {
  return (
    // A recipient's first and often only sight of the brand, so the lockup
    // gets its full form here — mark at a real size, with the strapline.
    // Clickable like everywhere else the logo appears (AppLayout,
    // LegalLayout) — home for an anonymous visitor, their own dashboard for
    // a signed-in Whisperer (the caller picks which via `href`).
    <a href={href} className="inline-block hover:opacity-80 transition-opacity">
      <LogoLockup tagline />
    </a>
  );
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function TakeawayCard({ text }: { text: string }) {
  const { t } = useTranslation("whisp");
  const sentences = splitSentences(text);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 space-y-2.5"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
        <Sparkles className="w-3.5 h-3.5" /> {t("publicWhisp.takeaway")}
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
  const { t } = useTranslation("whisp");
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadReply | null>(null);

  // The fixed header's real rendered height, so the content below it knows
  // how much space to reserve. Measured rather than a guessed constant
  // because it varies with env(safe-area-inset-top) — different on every
  // device with a notch/dynamic island — and again if the logo lockup ever
  // wraps to two lines on a narrow screen.
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The reply composer is fixed to the bottom of the viewport — see the
  // effect below (placed after `whisp` and the composer's own state are
  // declared) for the full reasoning and the height it measures.
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  // The reply composer starts COMPACT — a single-line input plus a
  // horizontally-scrolling row of quick-reply chips, not the full editor
  // (context card, wrapped chips, textarea, video-reply offer, character
  // count). It's pinned to the bottom of the viewport (see composerRef
  // below), so the full version — several rows tall — used to sit directly
  // under a freshly-opened video, on screen before anyone had even watched
  // it, crowding the video into a sliver at the top on a normal phone
  // screen. Tapping into the input (or, once a conversation already
  // exists, just having replies) expands it to the full editor.
  const [composerExpanded, setComposerExpanded] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [hasTrackedOpen, setHasTrackedOpen] = useState(false);
  const [revealResponse, setRevealResponse] = useState<"accepted" | "declined" | null>(null);
  const [localAppreciation, setLocalAppreciation] = useState<"yes" | "no" | null>(null);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [reminderScheduled, setReminderScheduled] = useState<{ nextReminderAt: string; isFinal: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [justWatched, setJustWatched] = useState(false);

  // The "Was this something you needed to hear?" prompt's HEADER row is
  // always rendered right under the video/takeaway — that alone is what
  // puts it "somewhere they can see" without hunting for it, regardless of
  // expand state. The CONTENT (the Yes/Not really buttons) only auto-opens
  // once they've actually finished watching THIS visit (justWatched,
  // below). It never auto-opens just because the page loaded or because a
  // whisp was opened before — asking someone to react before they've
  // watched anything is the exact "obstructing the video" complaint this is
  // guarding against. It's always one tap away via the chevron regardless.
  const [reactionExpanded, setReactionExpanded] = useState(false);

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

  // Sent as a query param purely so a circle_drop response's viewerHasLiked
  // reflects this device — meaningless (and ignored server-side) for every
  // other delivery method.
  const visitorIdParams = { visitorId: getVisitorId() };

  const { data: whisp, isLoading, refetch } = useGetPublicWhisp(token!, visitorIdParams, {
    query: {
      enabled: !!token,
      queryKey: getGetPublicWhispQueryKey(token!, visitorIdParams),
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

  // The composer's real rendered height, so content above it (and the page's
  // own bottom padding) knows how much space to reserve — same measured
  // technique as the header, since a guessed constant would drift the moment
  // the video-reply form or the "N replies remaining" line appears.
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) {
      // Nothing pinned right now (whisp still loading, or not found) — stop
      // reserving space for a bar that isn't there.
      setComposerHeight(0);
      return;
    }
    const observer = new ResizeObserver(([entry]) => setComposerHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
    // Re-runs whenever the composer's actual content changes — the video-reply
    // form and the "N replies remaining" line change the bar's real height,
    // and the ref itself only exists in some render branches (not the
    // expired/limit-reached ones, which are shorter).
  }, [showVideoReply, replyVideoMeta, whisp?.recipientRepliesRemaining, whisp?.expired]);

  useEffect(() => {
    if (justWatched) setReactionExpanded(true);
  }, [justWatched]);

  // Carries focus from the compact input over to the full textarea the
  // instant it expands, so tapping in feels like one continuous field
  // rather than losing the keyboard/cursor mid-tap.
  useEffect(() => {
    if (composerExpanded) replyTextareaRef.current?.focus();
  }, [composerExpanded]);

  const trackEvent = useTrackWhispEvent();
  const publicReply = usePublicReply();
  const respondReveal = useRespondReveal();
  const scrapeReplyVideo = useScrapeVideoMeta();
  const submitAppreciation = useSubmitAppreciation();
  const requestReminder = useRequestWhispReminder();
  const requestVideoReply = useRequestVideoReply();
  const toggleLike = useToggleCircleLike();
  const postComment = usePostCircleComment();
  const postCommentWithImage = useMutation({
    mutationFn: (vars: { token: string; commentText: string; visitorId: string; parentCommentId?: string | null; image: File }) =>
      postCircleCommentWithImage(vars.token, vars),
  });
  const reactToComment = useReactToCircleComment();
  const renameHandle = useRenameCircleHandle();
  const startCircleDm = useStartCircleDm();
  const archiveWhisp = useArchiveWhisp();

  function handleUnarchive() {
    if (!whisp) return;
    archiveWhisp.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) });
          toast({ title: t("shared.movedBackToList") });
        },
        onError: () => toast({ title: t("shared.couldntUpdateThat"), variant: "destructive" }),
      },
    );
  }
  const [commentText, setCommentText] = useState("");
  const [commentReplyingTo, setCommentReplyingTo] = useState<CircleComment | null>(null);

  // The Blind Circle comment composer gets the same compact-by-default,
  // expand-on-focus treatment as the reply composer below (see
  // composerExpanded's own comment) — a slim pill rather than a full
  // textarea, image picker, and rename control competing for attention
  // before someone's decided to say anything.
  const [commentComposerExpanded, setCommentComposerExpanded] = useState(false);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const commentFileRef = useRef<HTMLInputElement>(null);
  const [commentImage, setCommentImage] = useState<File | null>(null);
  const [commentImagePreview, setCommentImagePreview] = useState<string | null>(null);
  const [commentImageError, setCommentImageError] = useState<string | null>(null);
  const [renamingHandle, setRenamingHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState("");

  useEffect(() => {
    if (commentComposerExpanded) commentTextareaRef.current?.focus();
  }, [commentComposerExpanded]);

  // Revoke the object URL backing the attached-image preview once it's no
  // longer shown — otherwise every selected image leaks its blob for the
  // life of the page.
  useEffect(() => {
    return () => {
      if (commentImagePreview) URL.revokeObjectURL(commentImagePreview);
    };
  }, [commentImagePreview]);

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
        onError: () => toast({ title: t("publicWhisp.toast.couldntScheduleReminder"), variant: "destructive" }),
      }
    );
  }

  function handleAppreciation(appreciated: boolean) {
    submitAppreciation.mutate(
      { token: token!, data: { appreciated } },
      {
        onSuccess: () => setLocalAppreciation(appreciated ? "yes" : "no"),
        onError: () => toast({ title: t("publicWhisp.toast.somethingWentWrong"), variant: "destructive" }),
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
        onError: () => toast({ title: t("publicWhisp.toast.somethingWentWrong"), variant: "destructive" }),
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
          toast({ title: t("publicWhisp.toast.replySentAnonymously") });
        },
        onError: () => toast({ title: t("publicWhisp.toast.failedToSendReply"), variant: "destructive" }),
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
      title: t("publicWhisp.toast.createAccountToWhispVideo"),
      description: t("publicWhisp.toast.senderNotified"),
    });
    setLocation("/sign-up");
  }

  function handleReply() {
    const video = replyVideoUrl.trim();
    if (!replyText.trim() && !video) return;
    submitReply(replyText.trim(), video ? { url: video, meta: replyVideoMeta } : undefined);
  }

  function handleToggleLike() {
    toggleLike.mutate(
      { token: token!, data: { visitorId: getVisitorId() } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) }) }
    );
  }

  function handleStartCommentReply(comment: CircleComment) {
    setCommentReplyingTo(comment);
    setCommentComposerExpanded(true);
  }

  function handleCommentImageSelect(file: File | undefined) {
    if (!file) return;
    setCommentImageError(null);
    try {
      validateCommentImage(file);
    } catch (err) {
      setCommentImageError(err instanceof CommentImageValidationError ? err.message : t("publicWhisp.circle.couldntAttachImage"));
      if (commentFileRef.current) commentFileRef.current.value = "";
      return;
    }
    setCommentImage(file);
    setCommentImagePreview(URL.createObjectURL(file));
  }

  function handleRemoveCommentImage() {
    setCommentImage(null);
    setCommentImagePreview(null);
    setCommentImageError(null);
    if (commentFileRef.current) commentFileRef.current.value = "";
  }

  function handlePostComment() {
    const text = commentText.trim();
    if (!text) return;
    const callbacks = {
      onSuccess: () => {
        setCommentText("");
        setCommentReplyingTo(null);
        handleRemoveCommentImage();
        queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) });
      },
      onError: (err: any) => {
        if (err?.data?.code === "comment_limit_reached") {
          toast({
            title: t("publicWhisp.toast.freeCommentsUsed"),
            description: t("publicWhisp.toast.signUpToComment"),
            variant: "destructive",
          });
          return;
        }
        toast({ title: err?.data?.error ?? t("publicWhisp.toast.couldntPostComment"), variant: "destructive" });
      },
    };
    if (commentImage) {
      postCommentWithImage.mutate(
        {
          token: token!,
          commentText: text,
          visitorId: getVisitorId(),
          parentCommentId: commentReplyingTo?.id ?? null,
          image: commentImage,
        },
        callbacks
      );
      return;
    }
    postComment.mutate(
      {
        token: token!,
        data: { commentText: text, visitorId: getVisitorId(), parentCommentId: commentReplyingTo?.id ?? null },
      },
      callbacks
    );
  }

  function handleCommentReaction(commentId: string, reaction: "like" | "dislike") {
    reactToComment.mutate(
      { token: token!, commentId, data: { visitorId: getVisitorId(), reaction } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) }) }
    );
  }

  function handleOpenRenameHandle(currentHandle: string | null) {
    setHandleDraft(currentHandle ?? "");
    setRenamingHandle(true);
  }

  function handleRenameHandle() {
    const next = handleDraft.trim();
    if (!next) return;
    renameHandle.mutate(
      { token: token!, data: { visitorId: getVisitorId(), handle: next } },
      {
        onSuccess: () => {
          setRenamingHandle(false);
          queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) });
          toast({ title: t("publicWhisp.toast.nameUpdated") });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? t("publicWhisp.toast.couldntUpdateName"), variant: "destructive" }),
      }
    );
  }

  // Resumes the SAME private thread on a repeat visit (see
  // lib/circleDm.ts) instead of minting a new one on every click — the
  // token, once saved, is this device's only way back to that conversation.
  function handleMessagePoster() {
    if (!whisp) return;
    const saved = getSavedCircleDmToken(whisp.id);
    if (saved) {
      setLocation(`/w/${saved}`);
      return;
    }
    startCircleDm.mutate(
      { token: token! },
      {
        onSuccess: (result) => {
          saveCircleDmToken(whisp.id, result.publicToken);
          setLocation(`/w/${result.publicToken}`);
        },
        onError: () => toast({ title: t("publicWhisp.toast.couldntStartConversation"), variant: "destructive" }),
      }
    );
  }

  const moodColor = (whisp?.moodTag && MOOD_CONFIG[whisp.moodTag]?.color) || "#7C5CFC";
  const appreciationResponse = localAppreciation ?? whisp?.appreciationResponse ?? null;
  const commentPosting = postComment.isPending || postCommentWithImage.isPending;
  // Known only once this visitor has an existing comment in this thread —
  // the server assigns a handle lazily (see anonymousHandles.ts), so there's
  // nothing to display until then. The rename control still works before
  // that: renameHandle assigns one on the fly if none exists yet.
  const ownHandle = whisp?.comments.find((c) => c.isOwnComment)?.handle ?? null;

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

      {/* Header — fixed, not sticky. index.css sets overflow-x: hidden on both
          html and body, which (per AppLayout's own fix earlier) turns them
          into scroll containers and defeats `sticky` almost entirely.
          `position: fixed` isn't subject to that: it resolves against the
          viewport regardless, confirmed empirically the same way the AppLayout
          fix was. Pulling it out of flow means the content below needs
          compensating top space equal to its real rendered height — which
          varies with safe-area-inset-top per device — so it's measured rather
          than guessed. */}
      <header
        ref={headerRef}
        className="fixed top-0 inset-x-0 z-20 px-5 pb-5 flex items-center justify-between border-b border-border/30 bg-background/95 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <BlindWhisperLogoMark href={isSignedIn ? "/dashboard" : "/"} />
        {isSignedIn ? (
          // A signed-in Whisperer landing here (their own Received tab, a
          // notification, a link someone sent them) has an app to go back
          // to — unlike an anonymous recipient, for whom this page IS the
          // whole experience and a dashboard link would just be a dead end.
          <button
            type="button"
            onClick={() => setLocation("/dashboard")}
            data-testid="button-back-to-dashboard"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors py-2"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> {t("publicWhisp.backToDashboard")}
          </button>
        ) : (
          <a
            href="/sign-up"
            className="text-xs text-muted-foreground hover:text-primary transition-colors py-2"
          >
            {t("publicWhisp.becomeAWhisperer")}
          </a>
        )}
      </header>

      {/* Content */}
      <main
        className="flex-1 max-w-lg mx-auto w-full px-5 py-10 space-y-7 relative z-10"
        style={{
          paddingTop: `calc(${headerHeight}px + 2.5rem)`,
          // Reserves space for the fixed composer the same way the top
          // padding reserves space for the fixed header — without it, the
          // reveal section, reminder picker, both CTAs and the footer would
          // render partly hidden underneath the bar. 0 while it isn't
          // rendered at all (loading/not-found), so nothing is reserved for
          // a bar that isn't there.
          paddingBottom: composerHeight ? `calc(${composerHeight}px + 2rem)` : undefined,
        }}
      >
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
        ) : whisp.viewerArchived ? (
          // Only ever true for a signed-in viewer who is this whisp's own
          // matched recipient AND has archived their copy of it (see
          // routes/public.ts's GET /w/:token) — a reply/follow-up here still
          // notifies them normally, but this is what they land on instead of
          // the thread until they choose to bring it back.
          <ArchivedWhispGate
            videoTitle={whisp.videoTitle}
            onUnarchive={handleUnarchive}
            isUnarchiving={archiveWhisp.isPending}
            onBack={() => setLocation(isSignedIn ? "/dashboard" : "/")}
          />
        ) : (
          <>
            {/* Lead text — keep in sync with api-server's lib/copy.ts HOOK_LINE/groupHookLine */}
            <p className="text-center text-xl font-serif text-foreground leading-snug">
              {whisp.groupSize
                ? t("publicWhisp.lead.group", { count: whisp.groupSize })
                : t("publicWhisp.lead.individual")}
            </p>

            {expired ? (
              <div className="rounded-2xl bg-card border border-border/50 p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
                  <Clock className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="font-medium text-foreground">{t("publicWhisp.expired.title")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("publicWhisp.expired.description")}
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
                {t("publicWhisp.expiresIn", { time: formatDistanceToNowStrict(expiresAtMs!) })}
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

            {/* Appreciation prompt — collapsible so it doesn't crowd the
                video/takeaway before there's anything to react to yet, and
                stays collapsed until they actually finish watching in THIS
                visit (see the justWatched effect above) — never just because
                the server says it was watched before, which used to spring
                this open on reload after a single tap. */}
            <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setReactionExpanded((v) => !v)}
                data-testid="button-toggle-appreciation"
                aria-expanded={reactionExpanded}
                className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left"
              >
                <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  {appreciationResponse && <HeartHandshake className="w-4 h-4 text-primary shrink-0" />}
                  {appreciationResponse
                    ? appreciationResponse === "yes"
                      ? t("publicWhisp.appreciation.yesResponse")
                      : t("publicWhisp.appreciation.noResponse")
                    : t("publicWhisp.appreciation.prompt")}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${reactionExpanded ? "rotate-180" : ""}`}
                />
              </button>
              {reactionExpanded && (
                <div className="px-4 pb-4 text-center space-y-2">
                  {appreciationResponse ? (
                    appreciationResponse === "yes" && whisp.videoPlatform !== "upload" && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">{t("publicWhisp.appreciation.knowSomeone")}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={handlePassItForward}
                          data-testid="button-pass-it-forward"
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" /> {t("publicWhisp.appreciation.passItForward")}
                        </Button>
                      </div>
                    )
                  ) : (
                    <div className="flex gap-2 justify-center">
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleAppreciation(true)}
                        disabled={submitAppreciation.isPending}
                        data-testid="button-appreciation-yes"
                      >
                        {t("publicWhisp.appreciation.yesButton")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => handleAppreciation(false)}
                        disabled={submitAppreciation.isPending}
                        data-testid="button-appreciation-no"
                      >
                        {t("publicWhisp.appreciation.noButton")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Blind Circle engagement — likes, a public comment thread, and
                an entry point into a private 1:1 conversation with the
                poster. Only meaningful for a Circle post (a Whisper Link
                already has exactly one anonymous party, for whom "liked" or
                "N comments" is meaningless) — every other delivery method
                keeps using the ordinary Reply section just below instead. */}
            {whisp.deliveryMethod === "circle_drop" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleLike}
                    disabled={toggleLike.isPending}
                    data-testid="button-like-circle-post"
                    aria-pressed={whisp.viewerHasLiked}
                    className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors active:scale-95 ${
                      whisp.viewerHasLiked
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/50 bg-card text-foreground hover:border-primary/40"
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${whisp.viewerHasLiked ? "fill-primary" : ""}`} />
                    {whisp.likeCount > 0 ? whisp.likeCount : t("publicWhisp.circle.like")}
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full flex-1"
                    onClick={handleMessagePoster}
                    disabled={startCircleDm.isPending}
                    data-testid="button-message-poster"
                  >
                    {startCircleDm.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {t("publicWhisp.circle.messagePosterPrivately")}
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-border/40" />
                    <span className="text-xs text-muted-foreground">
                      {whisp.comments.length > 0
                        ? t("publicWhisp.circle.commentCount", { count: whisp.comments.length })
                        : t("publicWhisp.circle.beFirstToComment")}
                    </span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>

                  {whisp.comments.length > 0 && (
                    <div className="space-y-3">
                      {whisp.comments
                        .filter((c) => !c.parentCommentId)
                        .map((comment) => (
                          <div key={comment.id} className="space-y-2">
                            <CircleCommentRow
                              comment={comment}
                              onReply={() => handleStartCommentReply(comment)}
                              onReact={(reaction) => handleCommentReaction(comment.id, reaction)}
                              reactionPending={reactToComment.isPending && reactToComment.variables?.commentId === comment.id}
                            />
                            {whisp.comments
                              .filter((r) => r.parentCommentId === comment.id)
                              .map((reply) => (
                                <div key={reply.id} className="ml-5 pl-3 border-l-2 border-border/30">
                                  <CircleCommentRow
                                    comment={reply}
                                    onReply={() => handleStartCommentReply(comment)}
                                    onReact={(reaction) => handleCommentReaction(reply.id, reaction)}
                                    reactionPending={reactToComment.isPending && reactToComment.variables?.commentId === reply.id}
                                  />
                                </div>
                              ))}
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Composer: compact by default, expanding to the full
                      editor (rename control, quote-reply banner, image
                      attach, character count) on focus — see
                      commentComposerExpanded's own comment above. */}
                  {!commentComposerExpanded ? (
                    <div className="flex items-center gap-2">
                      <Input
                        className="flex-1 h-10 bg-card border-border/50 rounded-full px-4 text-sm"
                        placeholder={t("publicWhisp.circle.commentPlaceholder")}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onFocus={() => setCommentComposerExpanded(true)}
                        data-testid="input-circle-comment-compact"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="rounded-full h-10 w-10 shrink-0"
                        onClick={() => setCommentComposerExpanded(true)}
                        aria-label={t("publicWhisp.circle.moreCommentOptionsAriaLabel")}
                        data-testid="button-expand-comment-composer"
                      >
                        <ImagePlus className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Anonymous handle: auto-assigned on this visitor's
                          first comment (see anonymousHandles.ts), renameable
                          for this thread only — not a global setting. */}
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {t("publicWhisp.circle.commentingAs", { handle: ownHandle ?? t("publicWhisp.circle.anonymousHandle") })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenRenameHandle(ownHandle)}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          data-testid="button-change-handle"
                        >
                          <PenLine className="w-3 h-3" /> {t("publicWhisp.circle.changeName")}
                        </button>
                      </div>

                      {renamingHandle && (
                        <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 p-3" data-testid="handle-rename-form">
                          <Input
                            className="h-9 bg-card border-border/50 rounded-lg text-sm"
                            placeholder={t("publicWhisp.circle.renamePlaceholder")}
                            maxLength={24}
                            value={handleDraft}
                            onChange={(e) => setHandleDraft(e.target.value)}
                            data-testid="input-handle-rename"
                          />
                          <p className="text-[11px] text-destructive">
                            {t("publicWhisp.circle.renameWarning")}
                          </p>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setRenamingHandle(false)}
                              data-testid="button-cancel-handle-rename"
                            >
                              {t("shared.cancel")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-full"
                              onClick={handleRenameHandle}
                              disabled={!handleDraft.trim() || renameHandle.isPending}
                              data-testid="button-save-handle-rename"
                            >
                              {renameHandle.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("shared.save")}
                            </Button>
                          </div>
                        </div>
                      )}

                      {commentReplyingTo && (
                        <div
                          className="flex items-center justify-between gap-2 rounded-lg border-l-2 border-primary/60 bg-primary/5 px-3 py-1.5"
                          data-testid="comment-replying-to"
                        >
                          <span className="text-[11px] text-muted-foreground">
                            {t("publicWhisp.circle.replyingTo", {
                              target: commentReplyingTo.isPoster ? t("publicWhisp.circle.thePoster") : t("publicWhisp.circle.aComment"),
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCommentReplyingTo(null)}
                            aria-label={t("publicWhisp.circle.cancelReplyAriaLabel")}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <Textarea
                        ref={commentTextareaRef}
                        className="bg-card border-border/50 rounded-xl resize-none min-h-[60px]"
                        placeholder={t("publicWhisp.circle.commentPlaceholder")}
                        maxLength={500}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        data-testid="textarea-circle-comment"
                      />

                      {/* Image attachment — screened asynchronously by the
                          backend's moderation pass once posted; a flagged
                          image just never gets an imageUrl back, no client
                          UI needed for that. */}
                      {commentImagePreview ? (
                        <div className="relative inline-block" data-testid="comment-image-preview">
                          <img
                            src={commentImagePreview}
                            alt={t("publicWhisp.circle.attachmentPreviewAlt")}
                            className="max-h-32 rounded-lg border border-border/50 object-cover"
                          />
                          <button
                            type="button"
                            onClick={handleRemoveCommentImage}
                            aria-label={t("publicWhisp.circle.removeImageAriaLabel")}
                            className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-border/60 text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div>
                          <input
                            ref={commentFileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="hidden"
                            onChange={(e) => handleCommentImageSelect(e.target.files?.[0])}
                            data-testid="input-comment-image"
                          />
                          <button
                            type="button"
                            onClick={() => commentFileRef.current?.click()}
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                            data-testid="button-attach-comment-image"
                          >
                            <ImagePlus className="w-3.5 h-3.5" /> {t("publicWhisp.circle.attachPhoto")}
                          </button>
                        </div>
                      )}
                      {commentImageError && (
                        <p className="text-xs text-destructive" data-testid="text-comment-image-error">
                          {commentImageError}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-3">
                        {/* The reminder the product asked for, plus the same
                            signup nudge the rest of this page uses — comments
                            are anonymous by default, but signing up lifts the
                            rate limit entirely (see the toast on a 403 above). */}
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {t("publicWhisp.circle.keepItKind")}{" "}
                          <a href="/sign-up" className="text-primary hover:underline">{t("publicWhisp.becomeAWhisperer")}</a> {t("publicWhisp.circle.unlimitedCommentsSuffix")}
                        </p>
                        <Button
                          size="sm"
                          className="rounded-full shrink-0"
                          onClick={handlePostComment}
                          disabled={!commentText.trim() || commentPosting}
                          data-testid="button-post-comment"
                        >
                          {commentPosting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reply section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-xs text-muted-foreground">
                  {whisp.replies.length > 0 ? t("publicWhisp.reply.headerConversation") : t("publicWhisp.reply.headerWantToReply")}
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>

              {whisp.replies.length > 0 && (
                <ReplyThread
                  replies={whisp.replies}
                  viewerIsRecipient
                  otherLabel={whisp.senderAlias || t("publicWhisp.reply.theSender")}
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

              {/* Pinned to the bottom of the viewport rather than left in
                  normal flow, same treatment and same reasoning as the fixed
                  header: reachable from wherever on the page you've scrolled
                  to, the way a chat app's input bar always is. Every branch
                  below (the live composer, the expired notice, the
                  out-of-replies card) renders into this same fixed slot for
                  consistency — whichever is active, it's the page's one
                  "reply status" area, and should live in the same place. */}
              <div
                ref={composerRef}
                className="fixed bottom-0 inset-x-0 z-20 border-t border-border/30 bg-background/95 px-5 pt-3 backdrop-blur"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
              >
              {(() => {
                const disabled = whisp.expired;
                if (disabled) {
                  return (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      {t("publicWhisp.reply.expiredNotice")}
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
                      <p className="text-sm text-foreground">{t("publicWhisp.reply.limitReached.title")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("publicWhisp.reply.limitReached.description")}
                      </p>
                      <Button size="sm" className="rounded-full" onClick={() => setLocation("/sign-up")} data-testid="button-signup-for-replies">
                        {t("publicWhisp.reply.limitReached.signUpButton")}
                      </Button>
                    </div>
                  );
                }
                // Compact mode: a slim input plus quick-reply chips in one
                // scrollable row, nothing else — see composerExpanded's own
                // comment above for why. Once a conversation already exists
                // (whisp.replies.length > 0), always go straight to the full
                // editor below instead — the quick-reply chips don't even
                // apply once there's a real reply thread.
                if (!composerExpanded && whisp.replies.length === 0) {
                  return (
                    <div className="space-y-2">
                      <div
                        className="flex gap-2 overflow-x-auto pb-0.5"
                        style={{ scrollbarWidth: "none" }}
                        data-testid="quick-replies-compact"
                      >
                        {QUICK_REPLIES.map((qr) => (
                          <button
                            key={qr.key}
                            type="button"
                            onClick={() => submitReply(qr.text)}
                            disabled={publicReply.isPending}
                            data-testid={`quick-reply-${qr.key}`}
                            className="shrink-0 whitespace-nowrap px-4 py-2 min-h-11 rounded-full border border-border/50 bg-card text-sm text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95 transition-all disabled:opacity-50"
                          >
                            {qr.text}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          className="flex-1 h-11 bg-card border-border/50 rounded-full px-4"
                          placeholder={t("publicWhisp.reply.compactPlaceholder")}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onFocus={() => setComposerExpanded(true)}
                          data-testid="input-reply-compact"
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          className="rounded-full h-11 w-11 shrink-0"
                          onClick={() => setComposerExpanded(true)}
                          data-testid="button-expand-composer"
                          aria-label={t("publicWhisp.reply.moreReplyOptionsAriaLabel")}
                        >
                          <Video className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                }
                return (
                <div className="space-y-3">
                  {/* A reminder of what they're actually replying to. By the
                      time someone scrolls this far down — past the takeaway
                      card and the appreciation prompt — the video card up top
                      is long gone, and there's nothing on screen saying which
                      video this reply is even about. */}
                  <div
                    className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-muted/20 px-3 py-2"
                    data-testid="reply-context-card"
                  >
                    {whisp.videoThumbnail || whisp.videoPlatform === "upload" ? (
                      <Thumbnail
                        src={whisp.videoPlatform === "upload" ? `/api/public/w/${token}/media/thumbnail` : whisp.videoThumbnail!}
                        alt=""
                        className="h-9 w-14 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <PlayCircle className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {t("publicWhisp.reply.replyingToPrefix")} <span className="text-foreground">{whisp.videoTitle || t("publicWhisp.reply.thisVideoFallback")}</span>
                    </p>
                  </div>

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
                    <span className="text-xs text-muted-foreground">{t("publicWhisp.reply.orWriteYourOwn")}</span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  <Textarea
                    ref={replyTextareaRef}
                    className="bg-card border-border/50 rounded-xl resize-none min-h-[80px]"
                    placeholder={t("publicWhisp.reply.fullPlaceholder")}
                    maxLength={300}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    // Enter sends, Shift+Enter makes a newline — same
                    // convention as ThreadComposer, so it's what a recipient's
                    // fingers already expect after typing anywhere else in
                    // the app. Guarded exactly like the Send button itself:
                    // no bare Enter with nothing to send, and no double-send
                    // while a request is already in flight.
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return;
                      e.preventDefault();
                      if ((replyText.trim() || replyVideoUrl.trim()) && !publicReply.isPending) handleReply();
                    }}
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
                        <span className="block text-sm font-medium text-foreground">{t("publicWhisp.reply.whispVideoBack")}</span>
                        <span className="block text-xs text-muted-foreground">
                          {videoRepliesLocked
                            ? t("publicWhisp.reply.videoLockedDescription")
                            : t("publicWhisp.reply.videoUnlockedDescription")}
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
                          {t("publicWhisp.reply.whispVideoBack")}
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
                            <img src={replyVideoMeta.thumbnail} className="w-14 h-10 object-cover rounded" alt={t("publicWhisp.reply.videoThumbnailAlt")} />
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
                                placeholder={t("publicWhisp.reply.videoUrlPlaceholder")}
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
                              {scrapeReplyVideo.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("publicWhisp.reply.addVideoButton")}
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
                        ? t("publicWhisp.reply.lastReplyWarning")
                        : t("publicWhisp.reply.repliesLeft", { count: remaining })}
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
                      {t("publicWhisp.reply.sendButton")}
                    </Button>
                  </div>
                </div>
                );
              })()}
              </div>
            </div>

            {/* Reveal section */}
            {whisp.revealRequested && (
              <div className="bg-card border border-primary/20 rounded-2xl p-4 text-center space-y-2">
                {revealResponse ? (
                  <p className="text-sm text-muted-foreground">
                    {revealResponse === "accepted"
                      ? t("publicWhisp.reveal.viewerAccepted")
                      : t("publicWhisp.reveal.viewerDeclined")}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      {t("publicWhisp.reveal.prompt")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("publicWhisp.reveal.question")}
                    </p>
                    <div className="flex gap-2 justify-center pt-1">
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleRevealResponse(true)}
                        disabled={respondReveal.isPending}
                        data-testid="button-accept-reveal"
                      >
                        {t("publicWhisp.reveal.accept")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => handleRevealResponse(false)}
                        disabled={respondReveal.isPending}
                        data-testid="button-decline-reveal"
                      >
                        {t("publicWhisp.reveal.decline")}
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
                  ? t("publicWhisp.reminder.finalNotice")
                  : t("publicWhisp.reminder.notice")}
              </p>
            ) : canRemind && availablePresets.length > 0 ? (
              showReminderPicker ? (
                <div className="bg-card border border-border/50 rounded-2xl p-4 text-center space-y-2">
                  <p className="text-sm font-medium text-foreground">{t("publicWhisp.reminder.pickerHeading")}</p>
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
                  <BellRing className="w-3.5 h-3.5" /> {t("publicWhisp.reminder.button")}
                </button>
              )
            ) : null}
              </>
            )}

            {/* Signup CTA — recipients never need an account to watch or reply,
                this is just an invite to send their own. Made a real focal
                point rather than a quiet link: by the time someone's read
                this far — watched the video, maybe replied — they've just
                felt exactly what the product does, which is the best
                moment to invite them to try sending one themselves. */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card to-card p-6 text-center space-y-3 glow-card">
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-[60px] pointer-events-none"
                style={{ backgroundColor: moodColor, opacity: 0.25 }}
              />
              <Sparkles className="w-6 h-6 text-primary mx-auto relative" />
              <div className="relative space-y-1.5">
                <p className="font-serif text-lg font-semibold text-foreground">
                  {t("publicWhisp.signupCta.heading")}
                </p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  {t("publicWhisp.signupCta.description")}
                </p>
              </div>
              <Button
                size="lg"
                className="relative rounded-full h-12 px-8 text-base font-medium shadow-[0_0_24px_rgba(124,92,252,0.35)] hover:shadow-[0_0_36px_rgba(124,92,252,0.55)] transition-all"
                onClick={() => setLocation("/sign-up")}
                data-testid="button-become-whisperer"
              >
                <Sparkles className="w-4 h-4 mr-2" /> {t("publicWhisp.signupCta.button")}
              </Button>
              <p className="relative text-xs text-muted-foreground">{t("publicWhisp.signupCta.disclaimer")}</p>
            </div>

            {/* Ghost Boost matching CTA — a recipient who just felt what an
                anonymous whisp can do is a natural fit for the subscriber list. */}
            <a
              href="/subscribe"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card hover:bg-card/70 transition-colors p-4"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{t("publicWhisp.subscribeCta.heading")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("publicWhisp.subscribeCta.description")}
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
          {t("publicWhisp.footer.poweredByPrefix")}{" "}
          <a href="/" className="text-primary hover:underline">Blind Whisper</a>
          {" "}{t("publicWhisp.footer.poweredBySuffix")}
        </p>
      </footer>
    </div>
    </PullToRefresh>
  );
}
