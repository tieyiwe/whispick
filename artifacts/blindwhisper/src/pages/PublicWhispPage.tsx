import { useParams, useLocation } from "wouter";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  getGetReceivedWhispUnreadCountQueryKey,
  getListWhispsQueryKey,
  type CircleComment,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDurationUntil } from "@/lib/relativeTime";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MoodTag, MOOD_CONFIG } from "@/components/shared/MoodTag";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, Video, X, Link2, HeartHandshake, Clock, BellRing, Sparkles, PlayCircle, PenLine, Lock, ChevronDown, ChevronLeft, ChevronRight, Heart, MessageCircle, ImagePlus } from "lucide-react";
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
import { usePublicConfig } from "@/lib/usePublicConfig";
import { postCircleCommentWithImage, validateCommentImage, CommentImageValidationError } from "@/lib/postCircleComment";

function BlindWhisperLogoMark({ href }: { href: string }) {
  return (
    // A recipient's first and often only sight of the brand, so the lockup
    // gets its full form here — mark at a real size, with the strapline.
    // Clickable like everywhere else the logo appears (AppLayout,
    // LegalLayout) — home for an anonymous visitor, their own dashboard for
    // a signed-in Whisperer (the caller picks which via `href`).
    // min-w-0: lets the lockup give way (its strapline truncates first)
    // instead of pushing the header's sign-up link off a 360px screen.
    <a href={href} className="block min-w-0 hover:opacity-80 transition-opacity">
      <LogoLockup tagline />
    </a>
  );
}

// A fixed bar's full rendered height (padding + border + safe-area inset
// included) — what the content around it actually has to clear.
function borderBoxHeight(entry: ResizeObserverEntry): number {
  const box = entry.borderBoxSize?.[0];
  return box ? box.blockSize : entry.target.getBoundingClientRect().height;
}

// The one-tap replies, as a snap-scrolling row that bleeds to the screen
// edge. The fade is driven by the real scroll position — only the side with
// more to see fades — so the last chip isn't permanently ghosted once you've
// scrolled to it, and the first isn't before you've scrolled at all.
function QuickReplyScroller({
  ariaLabel,
  disabled,
  onPick,
}: {
  ariaLabel: string;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  function measure() {
    const el = scrollerRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }

  useLayoutEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fade = 28;
  const mask = `linear-gradient(to right, ${edges.start ? "#000" : "transparent"} 0, #000 ${fade}px, #000 calc(100% - ${fade}px), ${edges.end ? "#000" : "transparent"} 100%)`;

  return (
    <div
      ref={scrollerRef}
      onScroll={measure}
      role="group"
      aria-label={ariaLabel}
      className="-mx-5 flex gap-2 overflow-x-auto snap-x snap-mandatory scroll-px-5 px-5 py-0.5"
      style={{ scrollbarWidth: "none", maskImage: mask, WebkitMaskImage: mask }}
      data-testid="quick-replies-compact"
    >
      {QUICK_REPLIES.map((qr) => (
        <button
          key={qr.key}
          type="button"
          onClick={() => onPick(qr.text)}
          disabled={disabled}
          data-testid={`quick-reply-${qr.key}`}
          className="snap-start shrink-0 whitespace-nowrap px-4 min-h-11 rounded-full border border-border/60 bg-card text-sm text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95 transition-[background-color,border-color,transform] duration-150 disabled:opacity-50"
        >
          {qr.text}
        </button>
      ))}
    </div>
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
      transition={{ duration: 0.25, ease: "easeOut" }}
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
            transition={{ delay: i * 0.15, duration: 0.25, ease: "easeOut" }}
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
  const { billingEnabled } = usePublicConfig();
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadReply | null>(null);
  // "Guess who sent it" — an optional flag on the reply being composed, not
  // a separate flow: same textarea, same send button, just tagged. Reset on
  // every successful send (see submitReply) so it never silently carries
  // over onto an unrelated follow-up message.
  const [isGuessMode, setIsGuessMode] = useState(false);

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
    // The BORDER box, not contentRect: contentRect excludes the header's own
    // safe-area/padding, which left the headline tucked right up under it.
    const observer = new ResizeObserver(([entry]) => setHeaderHeight(borderBoxHeight(entry)));
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
  // screen. It grows into the full editor only on INTENT — focusing the
  // input, tapping the video icon, or choosing "Reply" on a message — and
  // folds back down after a send, on Escape, via its collapse control, or
  // when focus leaves it with nothing drafted. Having replies no longer
  // forces it open: a full editor pinned over a conversation is exactly
  // what made the conversation itself hard to read.
  const [composerExpanded, setComposerExpanded] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

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
  // other delivery method. Memoized (same as DebateTopicDetail) because it
  // feeds the query key below: without localStorage getVisitorId() would
  // mint a fresh UUID per render, and an ever-changing query key means an
  // unbounded refetch loop.
  const visitorId = useMemo(() => getVisitorId(), []);
  const visitorIdParams = { visitorId };

  const { data: whisp, isLoading, isError, error, refetch } = useGetPublicWhisp(token!, visitorIdParams, {
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
    const observer = new ResizeObserver(([entry]) => setComposerHeight(borderBoxHeight(entry)));
    observer.observe(el);
    return () => observer.disconnect();
    // Re-runs whenever the composer's actual content changes — the video-reply
    // form and the "N replies remaining" line change the bar's real height,
    // and the ref itself only exists in some render branches (not the
    // expired/limit-reached ones, which are shorter).
  }, [showVideoReply, replyVideoMeta, whisp?.recipientRepliesRemaining, whisp?.expired, whisp?.deliveryMethod]);

  useEffect(() => {
    if (justWatched) setReactionExpanded(true);
  }, [justWatched]);

  // Carries focus from the compact input over to the full textarea the
  // instant it expands, so tapping in feels like one continuous field
  // rather than losing the keyboard/cursor mid-tap.
  useEffect(() => {
    if (composerExpanded) replyTextareaRef.current?.focus();
  }, [composerExpanded]);

  // The "opened" reconcile lives on the hook, not on the mutate() call
  // below: TanStack Query drops a mutate()'s own callbacks once the calling
  // component has unmounted, and the recipient tapping Back to "My Whisps"
  // before the track round-trip lands unmounts exactly this page. That left
  // the Received tab's cached list (60s staleTime) still showing the whisp
  // as new — badge included — even though the server had already marked it
  // read. Hook-level callbacks run regardless. Refreshes the whisps list so
  // the same whisp stops showing as new inside the Received tab, and the nav
  // badge's count to reconcile the optimistic guess in the effect below.
  // Only meaningful for a signed-in recipient (these are their queries); a
  // no-op for an anonymous visitor.
  const trackEvent = useTrackWhispEvent({
    mutation: {
      onSuccess: (_data, variables) => {
        if (variables.data.eventType !== "opened") return;
        queryClient.invalidateQueries({ queryKey: getGetReceivedWhispUnreadCountQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
      },
    },
  });
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

  // Track "opened" once, the first time the whisp loads. An effect with a
  // ref guard (same pattern as RepliesInbox's mark-all-read) rather than a
  // render-body mutate: firing a mutation during render double-POSTs the
  // event whenever React discards and replays a render.
  // mutate is referentially stable, unlike the mutation result object —
  // depending on it keeps this effect from re-running every single render.
  const trackEventMutate = trackEvent.mutate;
  const trackedOpenRef = useRef(false);

  useEffect(() => {
    if (!whisp || trackedOpenRef.current) return;
    trackedOpenRef.current = true;

    // Opening the whisp is exactly what clears it from the recipient's
    // "unopened" set server-side (openedAt is set by this very event when it
    // wasn't set before). hasOpenedBefore === false means this is that first
    // open, so drop the "My Whisps" nav badge by one RIGHT NOW —
    // synchronously, before the track round-trip and before navigating back
    // to AppLayout — instead of waiting on the track round-trip or
    // AppLayout's 60s poll. Only when that count actually includes this
    // whisp: the viewer is its matched recipient (senderHandle is only ever
    // set for them), it isn't archived, and it hasn't expired (an expired one
    // isn't counted as unread at all — see routes/whisps.ts's
    // receivedUnread). Otherwise a sender previewing their own link, or
    // anyone opening someone else's, knocked one off a count it was never
    // part of. The same whisp's row in the cached Received list is patched
    // too, so its "New" marker and the tab badge drop right away as well.
    // A no-op for an anonymous visitor, who holds no such cached data.
    if (whisp.hasOpenedBefore === false && whisp.senderHandle && !whisp.viewerArchived && !whisp.expired) {
      queryClient.setQueryData(getGetReceivedWhispUnreadCountQueryKey(), (old: any) =>
        old ? { ...old, unreadCount: Math.max(0, (old.unreadCount ?? 0) - 1) } : old,
      );
      queryClient.setQueriesData({ queryKey: getListWhispsQueryKey() }, (old: unknown) =>
        Array.isArray(old) ? old.map((w) => (w?.id === whisp.id ? { ...w, unread: false } : w)) : old,
      );
    }

    // Reconciled by useTrackWhispEvent's hook-level onSuccess above.
    trackEventMutate({ token: token!, data: { eventType: "opened" } });
  }, [whisp, trackEventMutate, token, queryClient]);

  function handleWatchEvent(eventType: "clicked" | "watched_10s" | "watched_50pct" | "watched_complete") {
    trackEvent.mutate({ token: token!, data: { eventType } });
    if (eventType === "watched_complete") setJustWatched(true);
  }

  function submitReply(text: string, video?: { url: string; meta: typeof replyVideoMeta }, isGuess?: boolean) {
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
          ...(isGuess ? { isGuess: true } : {}),
        },
      },
      {
        onSuccess: () => {
          setReplyText("");
          setReplyingTo(null);
          setShowVideoReply(false);
          setReplyVideoUrl("");
          setReplyVideoMeta(null);
          setIsGuessMode(false);
          setComposerExpanded(false);
          queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) });
          toast({ title: isGuess ? t("publicWhisp.toast.guessSentAnonymously") : t("publicWhisp.toast.replySentAnonymously") });
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
      // "They can unlock video replies for you" means the sender buying
      // reply credit — not possible while the app is free (billing off), so
      // don't promise it; the free account is the real path then.
      ...(billingEnabled ? { description: t("publicWhisp.toast.senderNotified") } : {}),
    });
    setLocation("/sign-up");
  }

  function handleReply() {
    const video = replyVideoUrl.trim();
    // A guess requires text (enforced server-side too, see PublicReplyInput)
    // — a video-only "guess" wouldn't have anything for the sender to react
    // to as a guess.
    if (isGuessMode) {
      if (!replyText.trim()) return;
      submitReply(replyText.trim(), video ? { url: video, meta: replyVideoMeta } : undefined, true);
      return;
    }
    if (!replyText.trim() && !video) return;
    submitReply(replyText.trim(), video ? { url: video, meta: replyVideoMeta } : undefined);
  }

  // Choosing "Reply" on a specific message is a clear intent to write, so it
  // opens the full editor too (and focuses it, via the effect above).
  function handleReplyTo(reply: ThreadReply | null) {
    setReplyingTo(reply);
    if (reply) setComposerExpanded(true);
  }

  // Folds the editor back to the slim bar once focus has genuinely left it
  // (not just moved between its own controls) and there's nothing in it
  // worth keeping on screen — a half-written draft, an attached video or an
  // armed guess all keep it open.
  function handleComposerBlur(e: React.FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && composerRef.current?.contains(next)) return;
    if (replyText.trim() || showVideoReply || isGuessMode || replyingTo) return;
    setComposerExpanded(false);
  }

  function handleToggleLike() {
    toggleLike.mutate(
      { token: token!, data: { visitorId } },
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
          visitorId,
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
        data: { commentText: text, visitorId, parentCommentId: commentReplyingTo?.id ?? null },
      },
      callbacks
    );
  }

  function handleCommentReaction(commentId: string, reaction: "like" | "dislike") {
    reactToComment.mutate(
      { token: token!, commentId, data: { visitorId, reaction } },
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
      { token: token!, data: { visitorId, handle: next } },
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

  // A Blind Circle post's 1:1 reply thread would be one thread shared by
  // EVERY viewer — public, not the private conversation it looks like — so
  // replies, guesses and reveal responses are hidden for it (the server
  // rejects them too). Talking to the poster goes through "Message the
  // poster privately" (a separate circle_dm thread) instead.
  const isCirclePost = whisp?.deliveryMethod === "circle_drop";

  const expired = whisp?.expired ?? false;
  const expiresAtMs = whisp?.expiresAt ? new Date(whisp.expiresAt).getTime() : null;
  const remainingMs = expiresAtMs ? expiresAtMs - now : null;
  const remindersUsedUp = (whisp?.reminderCount ?? 0) >= MAX_REMINDERS;
  const canRemind = !!expiresAtMs && !expired && !reminderScheduled && !remindersUsedUp;
  const availablePresets = expiresAtMs
    ? REMINDER_PRESETS.filter((p) => now + p.minutes * 60_000 < expiresAtMs)
    : [];
  const hasCountdown = remainingMs !== null && remainingMs > 0;
  const expiresInLabel = hasCountdown ? formatDurationUntil(expiresAtMs!) : "";
  // Whether the fixed composer slot is offering a live reply (vs. the
  // expired / out-of-replies notices that render into the same slot).
  const canReply = !!whisp && !isCirclePost && !expired && whisp.recipientRepliesRemaining !== 0;

  return (
    <PullToRefresh onRefresh={() => refetch()}>
    <div
      className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden"
      // Reserves room for the fixed composer on the WHOLE page — footer
      // included — the same way <main>'s top padding reserves room for the
      // fixed header. (It used to sit on <main> alone, so the footer below
      // it ended up permanently hidden under the bar.) 0 while no bar is
      // rendered (loading / not found), so nothing is reserved for it.
      style={{ paddingBottom: composerHeight || undefined }}
    >
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
        className="fixed top-0 inset-x-0 z-20 px-5 max-[399px]:px-4 pb-3 sm:pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-[calc(env(safe-area-inset-top)+1rem)] flex items-center justify-between gap-3 border-b border-border/40 bg-background/90 backdrop-blur-xl"
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
            className="inline-flex shrink-0 items-center gap-1 min-h-11 -mr-2 px-2 rounded-full text-[13px] sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("publicWhisp.backToDashboard")}
          </button>
        ) : (
          <a
            href="/sign-up"
            className="inline-flex shrink-0 items-center min-h-11 -mr-2 px-2 rounded-full text-[13px] sm:text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
          >
            {t("publicWhisp.becomeAWhisperer")}
          </a>
        )}
      </header>

      {/* Content */}
      <main
        className="flex-1 max-w-lg mx-auto w-full px-5 pb-10 sm:pb-12 space-y-6 relative z-10"
        // Clears the fixed header plus one deliberate step of breathing room
        // (the bottom is handled on the page wrapper — see its comment).
        style={{ paddingTop: `calc(${headerHeight}px + 1.75rem)` }}
      >
        {isLoading ? (
          // Shaped like what's about to land: the two-line headline, then
          // the video card (16:9 frame + title + note), so nothing jumps.
          <div className="space-y-6" aria-hidden>
            <div className="space-y-2 flex flex-col items-center">
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-6 w-3/5" />
            </div>
            <div className="rounded-2xl overflow-hidden border border-border/50 bg-card">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="p-5 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-8 w-28 rounded-full" />
                <Skeleton className="h-20 w-full rounded-2xl" />
              </div>
            </div>
          </div>
        ) : isError && (error as { status?: number } | null)?.status !== 404 ? (
          // A real 404 means the whisp is genuinely gone (bad/expired token,
          // admin takedown) — that's the "not found" case below. ANY OTHER
          // failure (a 500, a network blip, a server behind on schema) must
          // NOT be shown as "this whisp could not be found": to a legitimate
          // recipient that reads as permanent data loss for a message that's
          // actually fine. Offer a retry instead — the poll/refetch will
          // recover it once the transient cause clears.
          <div className="text-center py-20 space-y-4">
            <p className="text-muted-foreground">{t("publicWhisp.loadError")}</p>
            <Button variant="outline" onClick={() => refetch()} className="rounded-full">
              {t("publicWhisp.tryAgain")}
            </Button>
          </div>
        ) : !whisp ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">{t("publicWhisp.notFound")}</p>
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
            <div className="text-center space-y-2">
              <h1 className="text-[22px] sm:text-2xl font-serif text-foreground leading-snug text-balance">
                {whisp.groupSize
                  ? t("publicWhisp.lead.group", { count: whisp.groupSize })
                  : t("publicWhisp.lead.individual")}
              </h1>

              {/* One quiet meta line rather than a stack of pills: the
                  stable per-sender pseudonym (see lib/whispSenderHandle.ts —
                  only ever set for the signed-in matched recipient, so a
                  recipient with several anonymous whisps can tell senders
                  apart) and, for a signed-in viewer, the expiry. A signed-out
                  viewer gets the expiry inside the "keep it forever" card
                  below the video instead — one expiry signal, never two. */}
              {(whisp.senderHandle || (isSignedIn && !expired && hasCountdown)) && (
                <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                  {whisp.senderHandle && (
                    <span data-testid="text-sender-handle">{t("whispsList.from", { sender: whisp.senderHandle })}</span>
                  )}
                  {whisp.senderHandle && isSignedIn && !expired && hasCountdown && (
                    <span aria-hidden className="text-muted-foreground/50">·</span>
                  )}
                  {isSignedIn && !expired && hasCountdown && (
                    <span className="inline-flex items-center gap-1 tabular-nums" data-testid="text-expiry-countdown">
                      <Clock className="w-3.5 h-3.5" />
                      {t("publicWhisp.expiresIn", { time: expiresInLabel })}
                    </span>
                  )}
                </p>
              )}
            </div>

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
            {/* Video card — the thing they came for, so it's the first thing
                under the headline, before any countdown or account prompt. */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="rounded-2xl overflow-hidden bg-card border border-border/50 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.6)]"
            >
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

              <div className="p-5 space-y-4">
                {(whisp.videoTitle || whisp.moodTag) && (
                  <div className="space-y-3">
                    {whisp.videoTitle && (
                      <p className="text-[17px] font-medium text-foreground leading-snug">{whisp.videoTitle}</p>
                    )}
                    {whisp.moodTag && <MoodTag mood={whisp.moodTag} />}
                  </div>
                )}

                {/* The note is the most personal thing on this page, so it's
                    set as a quote card rather than a line of text against a
                    rule: its own surface, a serif open-quote, and the sender's
                    alias as a gilded signature underneath. The alias is the
                    only identity a recipient ever gets, which is exactly why
                    it should look deliberate rather than like a footnote —
                    and sentence case, so a long alias reads as a signature
                    instead of wrapping as a shouty two-line pill. */}
                {whisp.anonymousNote && (
                  <figure className="relative rounded-2xl bg-primary/[0.07] border border-primary/20 px-5 pt-6 pb-4">
                    <span
                      aria-hidden
                      className="absolute top-0 left-4 font-serif text-5xl leading-none text-primary/35 select-none"
                    >
                      &ldquo;
                    </span>
                    <blockquote className="text-foreground italic text-[15px] leading-relaxed relative">{whisp.anonymousNote}</blockquote>
                    {whisp.senderAlias && (
                      <figcaption className="mt-3 flex items-center justify-end gap-2 text-[13px] font-medium text-gilded">
                        <span aria-hidden className="h-px w-8 shrink-0 bg-gilded/40" />
                        <PenLine className="w-3.5 h-3.5 shrink-0" />
                        <span className="min-w-0 break-words" data-testid="text-sender-alias">{whisp.senderAlias}</span>
                      </figcaption>
                    )}
                  </figure>
                )}
              </div>
            </motion.div>

            {whisp.aiTakeawayStatus === "ready" && whisp.aiTakeaway && <TakeawayCard text={whisp.aiTakeaway} />}

            {/* Appreciation prompt — collapsible so it doesn't crowd the
                video/takeaway before there's anything to react to yet, and
                stays collapsed until they actually finish watching in THIS
                visit (see the justWatched effect above) — never just because
                the server says it was watched before, which used to spring
                this open on reload after a single tap. */}
            {/* Not on a Circle post: the server rejects appreciation there (a
                public post has no single recipient to thank the poster). */}
            {!isCirclePost && (
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
            )}

            {/* Conversion #2 — "keep it forever" (loss aversion), and the
                page's ONE expiry signal for a signed-out viewer. An anonymous
                recipient never needs an account to watch or reply, but this
                whisp is on a timer: right after the video and note — once
                they've felt its value — is the strongest, least pushy moment
                to offer saving it (it used to sit ABOVE the video, between
                them and the thing they came for). Signed-out only (a
                signed-in Whisperer already keeps their received whisps and
                sees the expiry in the meta line under the headline instead),
                only while a real countdown remains, and never on the expired
                branch — this whole block lives inside the `!expired` fork.
                One-tap Google signup is the path (see App.tsx SignUpPage). */}
            {!isSignedIn && hasCountdown && (
              <section
                className="rounded-2xl border border-gilded/25 bg-gradient-to-br from-gilded/[0.07] via-card to-card p-5"
                data-testid="cta-keep-forever"
              >
                <div className="flex items-start gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gilded/15 text-gilded">
                    <Clock className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-[15px] font-medium text-foreground tabular-nums" data-testid="text-expiry-countdown">
                      {t("publicWhisp.keepForever.heading", { time: expiresInLabel })}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t("publicWhisp.keepForever.description")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4">
                  <Button
                    className="rounded-full h-11 px-5 w-full sm:w-auto"
                    onClick={() => setLocation("/sign-up")}
                    data-testid="button-keep-forever"
                  >
                    <Sparkles className="w-4 h-4 mr-2" /> {t("publicWhisp.keepForever.button")}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center sm:text-left">{t("publicWhisp.keepForever.disclaimer")}</p>
                </div>
              </section>
            )}

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
                <p className="text-[11px] text-muted-foreground" data-testid="text-message-poster-hint">
                  {t("publicWhisp.circle.messagePosterHint")}
                </p>

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

            {/* Reply section — not for a Circle post (see isCirclePost). */}
            {!isCirclePost && (
            <section className="space-y-4">
              {(whisp.replies.length > 0 || canReply) && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {whisp.replies.length > 0 ? t("publicWhisp.reply.headerConversation") : t("publicWhisp.reply.headerWantToReply")}
                  </span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
              )}

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
                  onReplyTo={canReply ? handleReplyTo : undefined}
                />
              )}

              {/* One-tap quick replies live in the page, not in the fixed
                  bar: that keeps the bar a single slim line on first view,
                  and they only apply before a conversation exists anyway.
                  A horizontal scroller that bleeds to the screen edges, with
                  snap points and an edge fade on whichever side has more —
                  so the cut-off chip reads as "scroll for more", not as a
                  layout bug. */}
              {canReply && whisp.replies.length === 0 && (
                <QuickReplyScroller
                  ariaLabel={t("publicWhisp.reply.quickRepliesAriaLabel")}
                  disabled={publicReply.isPending}
                  onPick={(text) => submitReply(text)}
                />
              )}

              {/* Pinned to the bottom of the viewport rather than left in
                  normal flow, same treatment and same reasoning as the fixed
                  header: reachable from wherever on the page you've scrolled
                  to, the way a chat app's input bar always is. Every branch
                  below (the live composer, the expired notice, the
                  out-of-replies card) renders into this same fixed slot for
                  consistency — whichever is active, it's the page's one
                  "reply status" area, and should live in the same place.
                  A full-bleed bar on a phone; on wider screens it narrows to
                  the content column and floats as a docked card, rather than
                  stretching a 470px column's composer across 1440px. */}
              <div
                ref={composerRef}
                className="fixed bottom-0 inset-x-0 z-20 border-t border-border/40 bg-background/90 backdrop-blur-xl sm:border-t-0 sm:bg-transparent sm:backdrop-blur-none sm:pointer-events-none sm:px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]"
              >
              <div
                className="max-w-lg mx-auto px-5 pt-3 sm:pointer-events-auto sm:px-4 sm:py-3 sm:rounded-2xl sm:border sm:border-border/50 sm:bg-card/90 sm:backdrop-blur-xl sm:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]"
              >
              {(() => {
                const disabled = whisp.expired;
                if (disabled) {
                  return (
                    <p className="text-sm text-muted-foreground text-center py-2">
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
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-1 text-center sm:text-left" data-testid="reply-limit-reached">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">{t("publicWhisp.reply.limitReached.title")}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {t("publicWhisp.reply.limitReached.description")}
                        </p>
                      </div>
                      <Button className="rounded-full h-11 px-5 shrink-0" onClick={() => setLocation("/sign-up")} data-testid="button-signup-for-replies">
                        {t("publicWhisp.reply.limitReached.signUpButton")}
                      </Button>
                    </div>
                  );
                }
                // Compact mode: one slim line — an input and a single
                // video-reply icon, nothing else — see composerExpanded's own
                // comment above for why.
                if (!composerExpanded) {
                  return (
                    <div className="flex items-center gap-2">
                      <Input
                        className="flex-1 h-11 bg-card border-border/60 rounded-full px-4 text-[15px] placeholder:text-muted-foreground"
                        placeholder={t("publicWhisp.reply.compactPlaceholder")}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onFocus={() => setComposerExpanded(true)}
                        data-testid="input-reply-compact"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="rounded-full h-11 w-11 shrink-0 border-border/60 bg-card text-muted-foreground hover:text-primary"
                        onClick={() => setComposerExpanded(true)}
                        data-testid="button-expand-composer"
                        aria-label={t("publicWhisp.reply.moreReplyOptionsAriaLabel")}
                      >
                        <Video className="h-[18px] w-[18px]" />
                      </Button>
                    </div>
                  );
                }
                return (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="space-y-3"
                  onBlur={handleComposerBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setComposerExpanded(false);
                    }
                  }}
                >
                  {/* A reminder of what they're actually replying to. By the
                      time someone scrolls this far down — past the takeaway
                      card and the appreciation prompt — the video card up top
                      is long gone, and there's nothing on screen saying which
                      video this reply is even about. Shares its row with the
                      control that folds the editor back down. */}
                  <div className="flex items-center gap-2">
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2.5"
                      data-testid="reply-context-card"
                    >
                      {whisp.videoThumbnail || whisp.videoPlatform === "upload" ? (
                        <Thumbnail
                          src={whisp.videoPlatform === "upload" ? `/api/public/w/${token}/media/thumbnail` : whisp.videoThumbnail!}
                          alt=""
                          className="h-8 w-12 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                          <PlayCircle className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <p className="min-w-0 flex-1 line-clamp-1 text-xs text-muted-foreground">
                        {t("publicWhisp.reply.replyingToPrefix")} <span className="text-foreground">{whisp.videoTitle || t("publicWhisp.reply.thisVideoFallback")}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setComposerExpanded(false)}
                      aria-label={t("publicWhisp.reply.collapseComposerAriaLabel")}
                      data-testid="button-collapse-composer"
                      className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      <ChevronDown className="h-5 w-5" />
                    </button>
                  </div>

                  <Textarea
                    ref={replyTextareaRef}
                    className="bg-card border-border/60 rounded-xl resize-none min-h-[88px] text-[15px] placeholder:text-muted-foreground"
                    placeholder={isGuessMode ? t("publicWhisp.reply.guessPlaceholder") : t("publicWhisp.reply.fullPlaceholder")}
                    maxLength={300}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    // Enter sends, Shift+Enter makes a newline — same
                    // convention as ThreadComposer, so it's what a recipient's
                    // fingers already expect after typing anywhere else in
                    // the app. Guarded exactly like the Send button itself:
                    // no bare Enter with nothing to send, and no double-send
                    // while a request is already in flight. A guess needs
                    // text specifically (see handleReply), so a video-only
                    // draft doesn't count as "ready" while the toggle is on.
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return;
                      e.preventDefault();
                      const ready = isGuessMode ? !!replyText.trim() : !!(replyText.trim() || replyVideoUrl.trim());
                      if (ready && !publicReply.isPending) handleReply();
                    }}
                    data-testid="textarea-public-reply"
                  />

                  {/* "Guess who sent it" — a lightweight toggle, not a
                      separate flow: it just tags the same message being
                      typed above. The hint makes the trust model explicit
                      right where the recipient decides to flag a guess, not
                      just after the fact on the sender's side. */}
                  {isGuessMode && (
                    <p className="text-xs text-muted-foreground">{t("publicWhisp.reply.guessHint")}</p>
                  )}

                  {!showVideoReply ? null : (
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
                          aria-label={t("publicWhisp.reply.removeVideoAriaLabel")}
                          className="-m-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {replyVideoMeta ? (
                        <div className="flex gap-2 p-2 bg-card rounded-lg items-center">
                          {replyVideoMeta.thumbnail && (
                            <img src={replyVideoMeta.thumbnail} className="w-14 h-10 object-cover rounded" alt={t("publicWhisp.reply.videoThumbnailAlt")} />
                          )}
                          <p className="text-xs text-foreground line-clamp-2 flex-1">{replyVideoMeta.title || replyVideoUrl}</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                className="pl-9 h-10 text-sm bg-card border-border/60 rounded-lg"
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
                              className="rounded-lg h-10"
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

                  {/* Toolbar: the two ways to dress a reply up (a guess, a
                      video back) as quiet secondary pills on the left, the
                      one primary action — Send — on the right. Answering
                      with a video is still the thing this app does that a
                      message thread doesn't, so it says what it gets you
                      (and, when locked, that it needs an account) in its
                      tooltip/label rather than as a full-width card that
                      used to double the composer's height. */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsGuessMode((v) => !v)}
                      aria-pressed={isGuessMode}
                      data-testid="button-toggle-guess-mode"
                      className={[
                        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors active:scale-95 whitespace-nowrap",
                        isGuessMode
                          ? "border-gilded/50 bg-gilded/15 text-gilded"
                          : "border-border/60 bg-card text-muted-foreground hover:border-gilded/40 hover:text-foreground",
                      ].join(" ")}
                    >
                      {t("publicWhisp.reply.guessToggle")}
                    </button>
                    {!showVideoReply && (
                      <button
                        type="button"
                        onClick={handleVideoReplyClick}
                        data-testid="button-show-video-reply"
                        aria-label={t("publicWhisp.reply.whispVideoBack")}
                        title={videoRepliesLocked ? t("publicWhisp.reply.videoLockedDescription") : t("publicWhisp.reply.videoUnlockedDescription")}
                        className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/[0.08] px-3 text-xs font-medium text-primary transition-colors hover:border-primary/70 hover:bg-primary/15 active:scale-95"
                      >
                        {videoRepliesLocked ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Video className="h-3.5 w-3.5 shrink-0" />}
                        <span className="truncate">{t("publicWhisp.reply.videoChip")}</span>
                      </button>
                    )}
                    <div className="ml-auto flex items-center gap-3 shrink-0">
                      <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums">{replyText.length}/300</span>
                      <Button
                        onClick={handleReply}
                        disabled={(isGuessMode ? !replyText.trim() : !replyText.trim() && !replyVideoUrl.trim()) || publicReply.isPending}
                        className="rounded-full h-10 px-4 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground"
                        data-testid="button-send-reply"
                      >
                        {publicReply.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                        ) : (
                          <Send className="w-4 h-4 mr-1.5" />
                        )}
                        {t("publicWhisp.reply.sendButton")}
                      </Button>
                    </div>
                  </div>
                  {videoRepliesLocked && !showVideoReply && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 sm:hidden">
                      <Lock className="h-3 w-3 shrink-0" /> {t("publicWhisp.reply.videoLockedDescription")}
                    </p>
                  )}
                </motion.div>
                );
              })()}
              </div>
              </div>
            </section>
            )}

            {/* Reveal section */}
            {whisp.revealRequested && !isCirclePost && (
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
              <p className="text-center text-[13px] text-muted-foreground flex items-center justify-center gap-1.5">
                <BellRing className="w-4 h-4 text-primary shrink-0" />
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
                        className="px-4 min-h-11 rounded-full border border-border/60 bg-background text-sm text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95 transition-all disabled:opacity-50"
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
                  className="mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <BellRing className="w-4 h-4" /> {t("publicWhisp.reminder.button")}
                </button>
              )
            ) : null}
              </>
            )}

            {/* Closing invitations, grouped as one quiet stack at the end of
                the page (cards never touch: gap-3 / gap-4). */}
            <div className="space-y-3 sm:space-y-4 pt-2">
            {/* Signup CTA — recipients never need an account to watch or reply,
                this is just an invite to send their own. Made a real focal
                point rather than a quiet link: by the time someone's read
                this far — watched the video, maybe replied — they've just
                felt exactly what the product does, which is the best
                moment to invite them to try sending one themselves. A
                signed-in viewer already IS a Whisperer, so it's hidden for
                them (same as the header's "Become a Whisperer" link). */}
            {!isSignedIn && (
            <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card to-card px-6 py-7 text-center space-y-4">
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-[60px] pointer-events-none"
                style={{ backgroundColor: moodColor, opacity: 0.25 }}
              />
              <div className="relative space-y-2">
                <p className="font-serif text-xl font-semibold text-foreground text-balance">
                  {t("publicWhisp.signupCta.heading")}
                </p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  {t("publicWhisp.signupCta.description")}
                </p>
              </div>
              <div className="relative space-y-2.5">
                <Button
                  size="lg"
                  className="rounded-full h-12 px-8 text-base font-medium shadow-[0_0_24px_rgba(124,92,252,0.35)] hover:shadow-[0_0_36px_rgba(124,92,252,0.55)] transition-shadow duration-200"
                  onClick={() => setLocation("/sign-up")}
                  data-testid="button-become-whisperer"
                >
                  <Sparkles className="w-4 h-4 mr-2" /> {t("publicWhisp.signupCta.button")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("publicWhisp.signupCta.disclaimer")}</p>
              </div>
            </div>
            )}

            {/* Conversion #3 — reciprocity. The recipient just received an
                anonymous whisp; the most natural next thought is "who'd whisper
                to ME?" A Whisper Box is a personal pull-link that needs an
                account, so this routes signed-OUT viewers through one-tap
                signup (they land on their box right after). Signed-in
                Whisperers already have Settings → Whisper Box, so it's hidden
                for them to avoid a redundant card. */}
            {!isSignedIn && (
              <button
                type="button"
                onClick={() => setLocation("/sign-up")}
                data-testid="cta-reciprocity"
                className="group w-full flex items-start gap-4 rounded-2xl border border-border/50 bg-card hover:border-primary/40 transition-colors p-4 sm:p-5 text-left"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                  <HeartHandshake className="w-5 h-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">{t("publicWhisp.reciprocityCta.heading")}</span>
                  <span className="block text-sm text-muted-foreground mt-0.5 leading-relaxed">
                    {t("publicWhisp.reciprocityCta.description")}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">
                    <Link2 className="w-4 h-4" /> {t("publicWhisp.reciprocityCta.button")}
                  </span>
                </span>
              </button>
            )}

            {/* Ghost Boost matching CTA — a recipient who just felt what an
                anonymous whisp can do is a natural fit for the subscriber list. */}
            <a
              href="/subscribe"
              className="group flex items-start gap-4 rounded-2xl border border-border/50 bg-card hover:border-primary/40 transition-colors p-4 sm:p-5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground group-hover:text-primary transition-colors">
                <BellRing className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-foreground">{t("publicWhisp.subscribeCta.heading")}</span>
                <span className="block text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  {t("publicWhisp.subscribeCta.description")}
                </span>
              </span>
              <ChevronRight className="self-center w-5 h-5 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors rtl:-scale-x-100" />
            </a>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer
        className="px-5 pt-5 text-center border-t border-border/40 relative z-10"
        // The safe-area inset is already cleared by the fixed composer when
        // there is one (the page wrapper reserves its full height).
        style={{ paddingBottom: composerHeight ? "1.25rem" : "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <p className="text-xs text-muted-foreground max-w-lg mx-auto leading-relaxed">
          {t("publicWhisp.footer.poweredByPrefix")}{" "}
          <a href="/" className="text-primary hover:underline">Blind Whisper</a>
          {" "}{t("publicWhisp.footer.poweredBySuffix")}
        </p>
      </footer>
    </div>
    </PullToRefresh>
  );
}
