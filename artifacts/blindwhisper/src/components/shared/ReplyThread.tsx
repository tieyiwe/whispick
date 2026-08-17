import { useEffect, useRef } from "react";
import { PlayCircle, Loader2, Send } from "lucide-react";
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
  createdAt: string;
};

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
}: {
  reply: ThreadReply;
  isOwn: boolean;
  authorLabel: string;
  index: number;
}) {
  return (
    <div
      data-testid={`reply-${reply.id}`}
      className={`flex flex-col message-in ${isOwn ? "items-end" : "items-start"}`}
      style={{ ["--message-index" as string]: String(index) }}
    >
      <span className="text-[11px] text-muted-foreground px-2 mb-1">
        {authorLabel} · {formatTimestamp(reply.createdAt)}
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
        {reply.replyText && <p className="whitespace-pre-wrap break-words">{reply.replyText}</p>}
        {reply.videoUrl && (
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
}: {
  replies: ThreadReply[];
  viewerIsRecipient: boolean;
  ownLabel?: string;
  otherLabel: string;
  emptyState?: React.ReactNode;
  /** Rendered inline at the end of the thread, so replying happens in the
   *  conversation rather than in a detached box somewhere else on the page. */
  composer?: React.ReactNode;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const previousCountRef = useRef(replies.length);

  // Scroll only when a message actually arrives — not on first paint (which
  // would yank a page the reader hasn't looked at yet) and not on unrelated
  // re-renders. Live polling means new messages can land while reading, and
  // this is what makes them feel like they've "come in".
  useEffect(() => {
    if (replies.length > previousCountRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    previousCountRef.current = replies.length;
  }, [replies.length]);

  return (
    <div className="space-y-3">
      {replies.length === 0
        ? emptyState
        : replies.map((reply, i) => {
            const isOwn = viewerIsRecipient ? reply.fromRecipient : !reply.fromRecipient;
            return (
              <MessageBubble
                key={reply.id}
                reply={reply}
                isOwn={isOwn}
                authorLabel={isOwn ? ownLabel : otherLabel}
                index={i}
              />
            );
          })}
      <div ref={endRef} />
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
