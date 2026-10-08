import { PenLine, Reply as ReplyIcon, ThumbsUp, ThumbsDown } from "lucide-react";
import { useTranslation } from "react-i18next";
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
export function CircleCommentRow({
  comment,
  onReply,
  onReact,
  reactionPending,
}: {
  comment: CircleComment;
  onReply?: () => void;
  /** Omitted by a caller that only reads comments (likes/dislikes stay unwired there). */
  onReact?: (reaction: "like" | "dislike") => void;
  reactionPending?: boolean;
}) {
  const { t } = useTranslation("sharedA");

  return (
    <div data-testid={`comment-${comment.id}`} className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {comment.isPoster && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">
            <PenLine className="w-2.5 h-2.5" /> {t("circleCommentRow.poster")}
          </span>
        )}
        {/* A stable per-thread handle (e.g. "SwiftFalcon482"), auto-assigned
            server-side on this visitor's first comment here — see
            anonymousHandles.ts. Never a real identity, just enough for one
            thread to tell its participants apart. */}
        <span className="font-medium text-foreground" data-testid={`text-comment-handle-${comment.id}`}>
          {comment.handle}
        </span>
        {comment.isOwnComment && <span className="text-primary">{t("circleCommentRow.you")}</span>}
        <span>·</span>
        <span>{formatCommentTimestamp(comment.createdAt)}</span>
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{comment.commentText}</p>
      {/* Already null server-side while pending/failed moderation review —
          nothing to gate client-side. Capped in size and never full-bleed:
          this is a reply to a video, not the post itself. */}
      {comment.imageUrl && (
        <img
          src={comment.imageUrl}
          alt={t("circleCommentRow.attachedImageAlt")}
          loading="lazy"
          className="mt-1 max-h-56 max-w-[75%] rounded-lg border border-border/40 object-cover"
          data-testid={`img-comment-${comment.id}`}
        />
      )}
      <div className="flex items-center gap-3 pt-0.5">
        {onReact && (
          <>
            <button
              type="button"
              onClick={() => onReact("like")}
              disabled={reactionPending}
              aria-pressed={comment.viewerReaction === "like"}
              data-testid={`button-like-comment-${comment.id}`}
              className={`inline-flex items-center gap-1 text-[11px] transition-colors disabled:opacity-50 ${
                comment.viewerReaction === "like" ? "text-primary" : "text-muted-foreground hover:text-primary"
              }`}
            >
              <ThumbsUp className={`w-3 h-3 ${comment.viewerReaction === "like" ? "fill-primary" : ""}`} />
              {comment.likeCount > 0 ? comment.likeCount : ""}
            </button>
            <button
              type="button"
              onClick={() => onReact("dislike")}
              disabled={reactionPending}
              aria-pressed={comment.viewerReaction === "dislike"}
              data-testid={`button-dislike-comment-${comment.id}`}
              className={`inline-flex items-center gap-1 text-[11px] transition-colors disabled:opacity-50 ${
                comment.viewerReaction === "dislike" ? "text-destructive" : "text-muted-foreground hover:text-destructive"
              }`}
            >
              <ThumbsDown className={`w-3 h-3 ${comment.viewerReaction === "dislike" ? "fill-destructive" : ""}`} />
              {comment.dislikeCount > 0 ? comment.dislikeCount : ""}
            </button>
          </>
        )}
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            data-testid={`button-reply-comment-${comment.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
          >
            <ReplyIcon className="w-3 h-3" /> {t("circleCommentRow.reply")}
          </button>
        )}
      </div>
    </div>
  );
}
