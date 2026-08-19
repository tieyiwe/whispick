import { PenLine, Reply as ReplyIcon } from "lucide-react";
import type { CircleComment } from "@workspace/api-client-react";

// Same same-day-vs-older timestamp treatment as ReplyThread's own
// formatTimestamp, kept as a private copy rather than shared: a comment row
// and a reply-thread message bubble are visually unrelated, and duplicating
// one small date function is cheaper than coupling two otherwise-unrelated
// components.
function formatCommentTimestamp(iso: string): string {
  const date = new Date(iso);
  const isToday = new Date().toDateString() === date.toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric" });
}

/**
 * One row in a Blind Circle post's public comment section — shared between
 * the recipient-facing view (PublicWhispPage) and the poster's own view
 * (WhispDetail), since both render the identical `comments` array the
 * public GET/authenticated GET responses both carry.
 */
export function CircleCommentRow({ comment, onReply }: { comment: CircleComment; onReply?: () => void }) {
  return (
    <div data-testid={`comment-${comment.id}`} className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {comment.isPoster ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">
            <PenLine className="w-2.5 h-2.5" /> Poster
          </span>
        ) : (
          <span>Anonymous</span>
        )}
        <span>·</span>
        <span>{formatCommentTimestamp(comment.createdAt)}</span>
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{comment.commentText}</p>
      {onReply && (
        <button
          type="button"
          onClick={onReply}
          data-testid={`button-reply-comment-${comment.id}`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
        >
          <ReplyIcon className="w-3 h-3" /> Reply
        </button>
      )}
    </div>
  );
}
