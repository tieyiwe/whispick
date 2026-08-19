import { useEffect, useMemo, useRef, useState } from "react";
import { PlayCircle, Loader2, Send, Reply as ReplyIcon, X, ArrowDown, Check, CheckCheck } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

// The anonymous back-and-forth, rendered as a real conversation rather than
// a flat list of boxes. Shared by both sides of that conversation — the
// sender's WhispDetail and the recipient's PublicWhispPage — because the
// thread should look and behave identically no matter who's reading it; only
// which side is "mine" differs, hence `viewerIsRecipient`.
//
// Every reply row carries `fromRecipient` (an absolute fact about who wrote
// it), NOT "is this mine" (which depends on who's looking). Resolving that to
// a viewer-relative "own vs. theirs" in one place is the whole reason this is
// a shared component: doing it inline in two pages is exactly how the two
// views drift out of sync.
export type ThreadReply = {
  id: string;
  replyText: string;
  fromRecipient: boolean;
  videoUrl?: string | null;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  parentReplyId?: string | null;
  createdAt: string;
  /** When the OTHER party viewed this message. Null means sent but unread —
   *  see the schema comment on whisp_replies.readAt for the full model. */
  readAt?: string | null;
};

// WhatsApp-style read receipt: one grey check once it's sent, two green
// checks once the other party has actually seen it. Only ever rendered on a
// message the current viewer sent themselves — seeing a receipt on a message
// you *received* isn't a thing WhatsApp does either, and here it would just
// be restating "yes, you can see this, since you're looking at it."
function ReadReceipt({ read }: { read: boolean }) {
  return read ? (
    <CheckCheck className="w-3.5 h-3.5 text-[hsl(142_71%_45%)]" aria-label="Seen" />
  ) : (
    <Check className="w-3.5 h-3.5 text-muted-foreground/70" aria-label="Sent" />
  );
}

// One line of the message being answered, shown inside the reply that
// answers it. A quote rather than indentation: the thread stays one
// chronological column (no nesting depth to reason about, nothing pushed
// off-screen on a phone) while "which message is this about" is answered
// right where you read the answer.
function QuotedParent({
  parent,
  authorLabel,
  isOwn,
}: {
  parent: ThreadReply;
  authorLabel: string;
  isOwn: boolean;
}) {
  const preview = parent.replyText?.trim() || (parent.videoUrl ? "a video" : "a message");
  return (
    <div
      className={`mb-1.5 rounded-lg border-l-2 pl-2 pr-2 py-1 text-[11px] ${
        isOwn ? "border-white/40 bg-black/15 text-primary-foreground/75" : "border-primary/40 bg-primary/5 text-muted-foreground"
      }`}
    >
      <span className="font-medium">{authorLabel}</span>
      <span className="mx-1">·</span>
      {/* Clamped so quoting a long message doesn't bury the actual reply. */}
      <span className="line-clamp-2">{preview}</span>
    </div>
  );
}

// Belt-and-braces scheme check before rendering a stored URL as a clickable
// href. The write paths validate this server-side (lib/safeUrl.ts), but that
// validation is recent — any row written before it was stored unchecked, and
// React renders a `javascript:` href rather than blocking it. Cheap enough to
// not depend on every historical row having gone through the current rules.
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Same-day messages only need a time; older ones need a date for the thread
// to stay readable as a conversation spans days.
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const isToday = new Date().toDateString() === date.toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function MessageBubble({
  reply,
  isOwn,
  authorLabel,
  index,
  parent,
  parentAuthorLabel,
  onReply,
}: {
  reply: ThreadReply;
  isOwn: boolean;
  authorLabel: string;
  index: number;
  parent?: ThreadReply;
  parentAuthorLabel?: string;
  onReply?: (reply: ThreadReply) => void;
}) {
  return (
    <div
      data-testid={`reply-${reply.id}`}
      className={`group flex flex-col message-in ${isOwn ? "items-end" : "items-start"}`}
      // Clamped: the stagger is a 50ms-per-message delay with `both` fill, so
      // an unclamped index leaves message #40 invisible for two seconds.
      style={{ ["--message-index" as string]: String(Math.min(index, 10)) }}
    >
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground px-2 mb-1">
        {authorLabel} · {formatTimestamp(reply.createdAt)}
        {isOwn && <ReadReceipt read={!!reply.readAt} />}
      </span>
      <div
        className={[
          "max-w-[85%] px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          // Asymmetric corner radii give each bubble a "tail" pointing at its
          // own side — the cue that makes a thread readable at a glance,
          // before you've read a single word or label.
          isOwn
            ? "rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-[hsl(252_97%_58%)] text-primary-foreground shadow-[0_2px_16px_rgba(124,92,252,0.25)]"
            : "rounded-2xl rounded-bl-md bg-card border border-secondary/30 text-foreground",
        ].join(" ")}
      >
        {parent && <QuotedParent parent={parent} authorLabel={parentAuthorLabel ?? ""} isOwn={isOwn} />}
        {reply.replyText && <p className="whitespace-pre-wrap break-words">{reply.replyText}</p>}
        {reply.videoUrl && isHttpUrl(reply.videoUrl) && (
          <a
            href={reply.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`reply-video-${reply.id}`}
            className={[
              "flex gap-2 items-center rounded-lg p-2 transition-colors",
              reply.replyText ? "mt-2" : "",
              // Inside a filled violet bubble a card-colored panel would
              // disappear, so tint from the bubble's own surface instead.
              isOwn ? "bg-black/20 hover:bg-black/30" : "bg-muted/40 hover:bg-muted/60",
            ].join(" ")}
          >
            {reply.videoThumbnail ? (
              <img src={reply.videoThumbnail} className="w-16 h-12 object-cover rounded shrink-0" alt="" />
            ) : (
              <div className="w-16 h-12 bg-black/20 rounded flex items-center justify-center shrink-0">
                <PlayCircle className="w-5 h-5 opacity-70" />
              </div>
            )}
            <span className="text-xs truncate">{reply.videoTitle || "Whisped a video back"}</span>
          </a>
        )}
      </div>
      {onReply && (
        // Always rendered rather than hover-only: half the readers are on a
        // phone, where there is no hover and an affordance that only appears
        // on one is an affordance that doesn't exist. Kept faint until
        // hover/focus so it doesn't compete with the message itself.
        <button
          type="button"
          onClick={() => onReply(reply)}
          data-testid={`reply-to-${reply.id}`}
          className="mt-1 px-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground transition-opacity"
        >
          <ReplyIcon className="w-3 h-3" />
          Reply
        </button>
      )}
    </div>
  );
}

export function ReplyThread({
  replies,
  viewerIsRecipient,
  ownLabel = "You",
  otherLabel,
  emptyState,
  composer,
  replyingTo,
  onReplyTo,
}: {
  replies: ThreadReply[];
  viewerIsRecipient: boolean;
  ownLabel?: string;
  otherLabel: string;
  emptyState?: React.ReactNode;
  /** Rendered inline at the end of the thread, so replying happens in the
   *  conversation rather than in a detached box somewhere else on the page. */
  composer?: React.ReactNode;
  /** The message the composer is currently answering, if any. Controlled by
   *  the page rather than held here, because the page is what has to send
   *  `parentReplyId` and clear the target once the send succeeds. Passing
   *  `onReplyTo` is what turns the per-message Reply affordance on at all. */
  replyingTo?: ThreadReply | null;
  onReplyTo?: (reply: ThreadReply | null) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousCountRef = useRef(replies.length);
  // Whether the reader is parked at the newest message. Drives two things: a
  // new arrival only yanks the view down if they were already at the bottom
  // (scrolling someone away from the message they're reading is the rudest
  // thing a live-updating thread can do), and the jump-to-latest button only
  // appears when they aren't.
  const [atBottom, setAtBottom] = useState(true);
  const [missedCount, setMissedCount] = useState(0);

  const byId = useMemo(() => new Map(replies.map((r) => [r.id, r])), [replies]);
  const labelFor = (reply: ThreadReply) =>
    (viewerIsRecipient ? reply.fromRecipient : !reply.fromRecipient) ? ownLabel : otherLabel;

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    const el = scrollRef.current;
    if (!el) return;
    // Setting scrollTop on the container directly, rather than
    // scrollIntoView: the latter walks up and scrolls every scrollable
    // ancestor, which would move the whole page — the exact thing this
    // container exists to prevent.
    el.scrollTo({ top: el.scrollHeight, behavior });
    setMissedCount(0);
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // A few px of slack: sub-pixel layout and momentum scrolling mean
    // scrollTop rarely lands exactly on the maximum.
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAtBottom(bottom);
    if (bottom) setMissedCount(0);
  }

  // Open on the newest message. Safe to do on first paint now that scrolling
  // is confined to this container — it moves the thread, not the page, so the
  // reader still lands at the top of the whisp itself.
  useEffect(() => {
    scrollToLatest("auto");
    // Deliberately mount-only: re-running would fight the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A message arriving while reading follows them down only if they're at the
  // bottom; otherwise it's counted and offered via the jump button.
  useEffect(() => {
    const arrived = replies.length - previousCountRef.current;
    previousCountRef.current = replies.length;
    if (arrived <= 0) return;
    if (atBottom) scrollToLatest("smooth");
    else setMissedCount((n) => n + arrived);
    // atBottom is read as a snapshot at arrival time, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replies.length]);

  return (
    <div className="space-y-3">
      {replies.length === 0 ? (
        emptyState
      ) : (
        <div className="relative">
          {/* The thread scrolls in its own box rather than growing the page.
              A long exchange otherwise pushes the composer — and everything
              below the whisp — arbitrarily far down, so reaching one message
              means scrolling the entire app. max-height, not a fixed height,
              so a two-message thread still renders at its natural size. */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="thread-scroll"
            className="thread-scroll max-h-[min(60vh,30rem)] overflow-y-auto overscroll-contain space-y-3 pr-1"
          >
            {replies.map((reply, i) => {
              const isOwn = viewerIsRecipient ? reply.fromRecipient : !reply.fromRecipient;
              // Undefined when the parent has been deleted or simply isn't in
              // this page of the thread — the quote is an enhancement, so a
              // missing one degrades to a plain message rather than an error.
              const parent = reply.parentReplyId ? byId.get(reply.parentReplyId) : undefined;
              return (
                <MessageBubble
                  key={reply.id}
                  reply={reply}
                  isOwn={isOwn}
                  authorLabel={isOwn ? ownLabel : otherLabel}
                  index={i}
                  parent={parent}
                  parentAuthorLabel={parent && labelFor(parent)}
                  onReply={onReplyTo}
                />
              );
            })}
            <div ref={endRef} />
          </div>
          {/* Only while scrolled away from the newest message, so it never
              covers the thread when it has nothing to offer. */}
          {!atBottom && (
            <button
              type="button"
              onClick={() => scrollToLatest("smooth")}
              data-testid="thread-jump-latest"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-card/95 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-card"
            >
              <ArrowDown className="w-3 h-3" />
              {missedCount > 0
                ? `${missedCount} new ${missedCount === 1 ? "message" : "messages"}`
                : "Jump to latest"}
            </button>
          )}
        </div>
      )}
      {replyingTo && onReplyTo && (
        <div
          className="flex items-start gap-2 rounded-xl border-l-2 border-primary/60 bg-primary/5 px-3 py-2"
          data-testid="thread-replying-to"
        >
          <div className="min-w-0 flex-1 text-[11px]">
            <span className="font-medium text-primary">Replying to {labelFor(replyingTo)}</span>
            <p className="line-clamp-1 text-muted-foreground">
              {replyingTo.replyText?.trim() || (replyingTo.videoUrl ? "a video" : "a message")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onReplyTo(null)}
            aria-label="Cancel reply"
            data-testid="thread-replying-to-cancel"
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {composer}
    </div>
  );
}

// The in-thread composer. Lives at the bottom of the message list (not in its
// own card) so the thread reads as one continuous conversation.
export function ThreadComposer({
  value,
  onChange,
  onSend,
  sending,
  placeholder = "Write a reply...",
  maxLength = 300,
  testIdPrefix = "thread",
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder?: string;
  maxLength?: number;
  testIdPrefix?: string;
}) {
  const canSend = !!value.trim() && !sending;

  return (
    <div className="pt-2">
      <div className="rounded-2xl border border-border/50 bg-input/40 focus-within:border-primary/50 transition-colors">
        <Textarea
          className="bg-transparent border-0 rounded-2xl resize-none min-h-[52px] max-h-40 focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder={placeholder}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Enter sends, Shift+Enter makes a newline — the convention every
          // chat UI uses, so it's what fingers already expect here.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          data-testid={`${testIdPrefix}-composer-input`}
        />
        <div className="flex justify-between items-center px-3 pb-2">
          <span className="text-[11px] text-muted-foreground">
            {value.length}/{maxLength}
          </span>
          <Button
            onClick={onSend}
            disabled={!canSend}
            size="sm"
            className="rounded-full h-8 px-4 active:scale-95 transition-transform"
            data-testid={`${testIdPrefix}-composer-send`}
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span className="ml-1.5">Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
