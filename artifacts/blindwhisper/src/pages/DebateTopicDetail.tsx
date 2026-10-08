import { useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useUser } from "@clerk/react";
import {
  useGetDebateTopic,
  usePostDebateTopicComment,
  useDeleteDebateTopic,
  useReactToDebateTopicComment,
  useRewhispDebateTopic,
  useRenameDebateTopicHandle,
  useUpdateDebateTopicHandleAvatar,
  useGetFollowedOnlineStatus,
  getGetDebateTopicQueryKey,
  getGetFollowedOnlineStatusQueryKey,
  getAuthToken,
  type DebateTopicComment,
  type DebateTopicDetail as DebateTopicDetailResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatTimeAgo } from "@/lib/relativeTime";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getVisitorId } from "@/lib/anonymousVisitor";
import { FollowButton } from "@/components/shared/FollowButton";
import { DebatePageShell } from "@/pages/DebateTopics";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { ReportContentDialog } from "@/components/shared/ReportContentDialog";
import { SendDebateTopicWhispDialog } from "@/components/shared/SendDebateTopicWhispDialog";
import { AvatarPickerGrid } from "@/components/shared/AvatarPickerGrid";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  Swords,
  MessageCircle,
  Send,
  Loader2,
  X,
  Trash2,
  HeartHandshake,
  ArrowLeft,
  Repeat2,
  ThumbsUp,
  ThumbsDown,
  ImagePlus,
  Pencil,
  Share2,
  Info,
  Palette,
  Sparkles,
  Bell,
  UserPlus,
  Reply,
} from "lucide-react";

const MAX_COMMENT_TEXT_LENGTH = 500;
const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024;
// Mirrors artifacts/api-server/src/lib/commentImages.ts — keep in sync if the
// allowed types ever change. The server re-enforces this; this is purely so
// a bad file gets rejected before spending a round trip on it.
const ALLOWED_COMMENT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Not modeled in openapi.yaml (multipart bodies don't codegen — see the spec's
// note on POST /public/debate-topics/{id}/comments), so this is a
// hand-written multipart request mirroring lib/uploadMedia.ts's approach:
// same endpoint as the generated postDebateTopicComment mutation, same
// fields, plus an `image` file field.
async function postDebateTopicCommentWithImage(
  topicId: string,
  fields: { commentText: string; visitorId: string; parentCommentId?: string | null },
  image: File,
): Promise<DebateTopicComment> {
  const formData = new FormData();
  formData.append("commentText", fields.commentText);
  formData.append("visitorId", fields.visitorId);
  if (fields.parentCommentId) formData.append("parentCommentId", fields.parentCommentId);
  formData.append("image", image, image.name);

  // This hand-built request doesn't go through customFetch, so it doesn't
  // pick up the Authorization header automatically — attach the same bearer
  // token every generated call sends, same reasoning as uploadMedia.ts.
  const token = await getAuthToken();
  const res = await fetch(`/api/public/debate-topics/${topicId}/comments`, {
    method: "POST",
    body: formData,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error: Error & { code?: string } = new Error(data?.error ?? `Couldn't post that comment (${res.status})`);
    error.code = data?.code;
    throw error;
  }
  return data as DebateTopicComment;
}

function HandleRenameControl({
  topicId,
  visitorId,
  currentHandle,
  onRenamed,
}: {
  topicId: string;
  visitorId: string;
  currentHandle: string;
  onRenamed: (handle: string) => void;
}) {
  const { toast } = useToast();
  const { t } = useTranslation("debateTopics");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentHandle);
  const rename = useRenameDebateTopicHandle();

  function submit() {
    const handle = value.trim();
    if (!handle) return;
    rename.mutate(
      { id: topicId, data: { visitorId, handle } },
      {
        onSuccess: (res) => {
          onRenamed(res.handle);
          toast({ title: t("debateTopicDetail.toast.handleUpdated") });
          setOpen(false);
        },
        onError: (err: any) => {
          // A reserved name (e.g. one that reads as the topic's author or
          // staff) gets its own message rather than the server's generic one.
          const title =
            err?.data?.code === "reserved"
              ? t("debateTopicDetail.toast.handleReserved")
              : (err?.data?.error ?? t("debateTopicDetail.toast.handleUpdateErrorDefault"));
          toast({ title, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(currentHandle);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-8 h-8 -my-2 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          aria-label={t("debateTopicDetail.handleRename.ariaLabel")}
          data-testid="button-edit-handle"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <p className="text-xs font-medium text-foreground">{t("debateTopicDetail.handleRename.title")}</p>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 24))}
          placeholder={t("debateTopicDetail.handleRename.placeholder")}
          data-testid="input-handle"
        />
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {t("debateTopicDetail.handleRename.helperText")}
        </p>
        <Button
          size="sm"
          className="w-full rounded-full"
          onClick={submit}
          disabled={rename.isPending || !value.trim()}
          data-testid="button-save-handle"
        >
          {rename.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
          {t("debateTopicDetail.handleRename.saveButton")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// Adjacent to HandleRenameControl, same trigger-a-popover pattern — but the
// avatar has no "confirm" step: tapping a preset (or "no avatar") saves
// immediately, same as tapping a preset color/icon anywhere else in the app.
function AvatarPickerControl({
  topicId,
  visitorId,
  currentAvatarId,
  handle,
  onChanged,
}: {
  topicId: string;
  visitorId: string;
  currentAvatarId: string | null;
  handle: string;
  onChanged: (avatarId: string | null) => void;
}) {
  const { toast } = useToast();
  const { t } = useTranslation("debateTopics");
  const [open, setOpen] = useState(false);
  const updateAvatar = useUpdateDebateTopicHandleAvatar();

  function submit(avatarId: string | null) {
    updateAvatar.mutate(
      { id: topicId, data: { visitorId, avatarId } },
      {
        onSuccess: (res) => {
          onChanged(res.avatarId);
          toast({ title: t("debateTopicDetail.toast.avatarUpdated") });
          setOpen(false);
        },
        onError: () => toast({ title: t("debateTopicDetail.toast.avatarUpdateError"), variant: "destructive" }),
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-8 h-8 -my-2 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          aria-label={t("debateTopicDetail.avatarPicker.ariaLabel")}
          data-testid="button-edit-avatar"
        >
          <Palette className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <p className="text-xs font-medium text-foreground">{t("debateTopicDetail.avatarPicker.title")}</p>
        <AvatarPickerGrid value={currentAvatarId} handle={handle} onSelect={submit} />
      </PopoverContent>
    </Popover>
  );
}

// Twitter-reply-style comment card. parentCommentId is a flat quote reference
// (see DebateTopicComment's schema comment), not a real tree — so this just
// renders "Replying to @handle" as context, no recursive nesting.
function CommentCard({
  comment,
  parentHandle,
  online = false,
  onReply,
  onReact,
  reactPending,
  onFollowToggle,
}: {
  comment: DebateTopicComment;
  parentHandle?: string;
  /** Whether comment.handle is online per GET /follows/online-status — only
   * ever true for handles the viewer follows (see onlineMap below). */
  online?: boolean;
  onReply: () => void;
  onReact: (reaction: "like" | "dislike") => void;
  reactPending: boolean;
  onFollowToggle: (patch: { following: boolean; followerCount?: number }) => void;
}) {
  const { t } = useTranslation("debateTopics");
  const actionClass =
    "inline-flex items-center gap-1.5 h-11 sm:h-9 px-2.5 rounded-full text-[13px] tabular-nums transition-colors duration-150 disabled:opacity-60";
  return (
    <div
      className={`rounded-2xl border p-4 ${
        comment.isPoster ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card"
      }`}
      data-testid={`comment-${comment.id}`}
    >
      {/* X/Twitter-style: avatar + a two-line byline (handle, then time /
          reply context), with the body spanning the full card width below
          so long comments stay comfortable to read on a phone. */}
      <div className="flex items-start gap-3">
        <AvatarCircle
          avatarId={comment.avatarId}
          handle={comment.handle}
          size="md"
          online={online}
          onlineLabel={t("debateTopicDetail.onlineAriaLabel")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-h-5">
            <span className="text-sm font-semibold text-foreground" data-testid={`text-handle-${comment.id}`}>
              {comment.handle}
            </span>
            {comment.isPoster && (
              <span className="text-xs font-medium text-primary px-2 py-px rounded-full bg-primary/10 whitespace-nowrap">
                {t("debateTopicDetail.topicAuthorBadge")}
              </span>
            )}
            {comment.isOwnComment && (
              <span className="text-xs font-medium text-muted-foreground px-2 py-px rounded-full bg-muted/50 whitespace-nowrap">
                {t("debateTopicDetail.youBadge")}
              </span>
            )}
            {/* commentAuthorFollowed is null when there's nothing followable here —
                purely anonymous commenter, caller not signed in, or it's the
                caller's own comment. No affordance shows in any of those cases. */}
            {comment.commentAuthorFollowed !== null && (
              <span className="ml-auto">
                <FollowButton
                  handle={comment.handle}
                  following={comment.commentAuthorFollowed}
                  compact
                  onToggled={onFollowToggle}
                />
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            <time dateTime={comment.createdAt}>
              {formatTimeAgo(new Date(comment.createdAt))}
            </time>
            {parentHandle && (
              <>
                {" · "}
                {t("debateTopicDetail.replyingToPrefix")} <span className="text-primary">@{parentHandle}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[15px] text-foreground leading-relaxed whitespace-pre-wrap break-words">{comment.commentText}</p>

      {comment.imageUrl && (
        <img
          src={comment.imageUrl}
          alt={t("debateTopicDetail.altAttachedImage")}
          className="mt-3 max-h-64 rounded-xl border border-border/50 object-cover"
          data-testid={`img-comment-${comment.id}`}
        />
      )}

      <div className="flex items-center gap-1 mt-1.5 -mb-2 -ml-2.5 -mr-2.5 sm:-mr-1.5">
        <button
          type="button"
          onClick={() => onReact("like")}
          disabled={reactPending}
          aria-pressed={comment.viewerReaction === "like"}
          className={`${actionClass} ${
            comment.viewerReaction === "like" ? "text-primary" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          data-testid={`button-like-${comment.id}`}
        >
          <ThumbsUp className={`w-4 h-4 ${comment.viewerReaction === "like" ? "fill-primary/25" : ""}`} />
          {comment.likeCount}
        </button>
        <button
          type="button"
          onClick={() => onReact("dislike")}
          disabled={reactPending}
          aria-pressed={comment.viewerReaction === "dislike"}
          className={`${actionClass} ${
            comment.viewerReaction === "dislike"
              ? "text-destructive"
              : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          }`}
          data-testid={`button-dislike-${comment.id}`}
        >
          <ThumbsDown className={`w-4 h-4 ${comment.viewerReaction === "dislike" ? "fill-destructive/25" : ""}`} />
          {comment.dislikeCount}
        </button>
        <button
          type="button"
          onClick={onReply}
          className={`${actionClass} text-muted-foreground hover:text-primary hover:bg-primary/10`}
          data-testid={`button-reply-${comment.id}`}
        >
          <Reply className="w-4 h-4" />
          {t("debateTopicDetail.replyButton")}
        </button>
        {/* No flag on your own comment — the report queue isn't a
            self-service delete button (the author has no retraction
            path for comments by design; see debate_topic_comments.ts). */}
        {!comment.isOwnComment && (
          <span className="ml-auto">
            <ReportContentDialog contentType="debate_topic_comment" contentId={comment.id} compact />
          </span>
        )}
      </div>
    </div>
  );
}

export function DebateTopicDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation("debateTopics");
  const queryClient = useQueryClient();
  const { isSignedIn } = useUser();
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; handle: string } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isPostingWithImage, setIsPostingWithImage] = useState(false);
  const [whispDialogOpen, setWhispDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPostSignupNudge, setShowPostSignupNudge] = useState(false);
  // Shown once per visit, not once per comment — a signed-out visitor who
  // posts three replies in a row shouldn't see this pop back up after every
  // single one, only the first.
  const signupNudgeShownRef = useRef(false);

  const visitorId = useMemo(() => getVisitorId(), []);
  const { data: topic, isLoading } = useGetDebateTopic(id, { visitorId });
  const postComment = usePostDebateTopicComment();
  const deleteTopic = useDeleteDebateTopic();
  const reactToComment = useReactToDebateTopicComment();
  const rewhisp = useRewhispDebateTopic();

  // This page is reachable anonymously (visitorId-based), so the presence
  // query only runs once signed in — the endpoint is scoped to a viewer's
  // own follows and has nothing to say for an anonymous visitor. Only
  // handles the viewer follows come back at all (see
  // FollowedOnlineStatusResponse's schema comment), so no extra filtering
  // is needed before using onlineMap below.
  const { data: onlineStatus } = useGetFollowedOnlineStatus({
    query: {
      queryKey: getGetFollowedOnlineStatusQueryKey(),
      enabled: !!isSignedIn,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const onlineMap = onlineStatus?.online ?? {};

  const commentsById = useMemo(() => {
    const map = new Map<string, DebateTopicComment>();
    for (const c of topic?.comments ?? []) map.set(c.id, c);
    return map;
  }, [topic]);

  // parentCommentId is a flat quote-reference, not a real tree — walk each
  // comment's parent chain up to whichever ancestor has no resolvable parent,
  // and group everything under that single root. One level of visual
  // indentation for the whole group, "Replying to @x" for the actual
  // immediate parent — not a recursive tree the data model can't support.
  const threads = useMemo(() => {
    if (!topic) return [] as { root: DebateTopicComment; replies: DebateTopicComment[] }[];
    function findRootId(comment: DebateTopicComment): string {
      let current = comment;
      const seen = new Set<string>([comment.id]);
      while (current.parentCommentId) {
        const parent = commentsById.get(current.parentCommentId);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        current = parent;
      }
      return current.id;
    }
    const repliesByRoot = new Map<string, DebateTopicComment[]>();
    const roots: DebateTopicComment[] = [];
    for (const c of topic.comments) {
      const rootId = findRootId(c);
      if (rootId === c.id) {
        roots.push(c);
      } else {
        if (!repliesByRoot.has(rootId)) repliesByRoot.set(rootId, []);
        repliesByRoot.get(rootId)!.push(c);
      }
    }
    return roots.map((root) => ({ root, replies: repliesByRoot.get(root.id) ?? [] }));
  }, [topic, commentsById]);

  const myComment = topic?.comments.find((c) => c.isOwnComment);
  const myHandle = myComment?.handle;
  const myAvatarId = myComment?.avatarId ?? null;

  const remaining = MAX_COMMENT_TEXT_LENGTH - commentText.length;
  const canSubmit =
    commentText.trim().length > 0 && remaining >= 0 && !postComment.isPending && !isPostingWithImage;

  function applyNewComment(comment: DebateTopicComment) {
    if (!id) return;
    queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
      old ? { ...old, commentCount: old.commentCount + 1, comments: [...old.comments, comment] } : old,
    );
    setCommentText("");
    setReplyTo(null);
    clearImage();
    // The comment already posted — anonymous posting stays exactly as
    // frictionless as it's always been, no account gate before Send. This is
    // the payoff moment to ask instead: they just did the thing, so "want to
    // know when someone reacts to it" actually means something concrete
    // right now, rather than a generic sign-up pitch shown before they've
    // done anything. Once per visit (see signupNudgeShownRef), not once per
    // comment.
    if (!isSignedIn && !signupNudgeShownRef.current) {
      signupNudgeShownRef.current = true;
      setShowPostSignupNudge(true);
    }
  }

  function handlePostComment() {
    const text = commentText.trim();
    if (!text || !id) return;

    if (imageFile) {
      setIsPostingWithImage(true);
      postDebateTopicCommentWithImage(id, { commentText: text, visitorId, parentCommentId: replyTo?.id ?? null }, imageFile)
        .then(applyNewComment)
        .catch((err: any) => {
          if (err?.code === "comment_limit_reached") {
            toast({ title: err.message, variant: "destructive" });
            return;
          }
          toast({ title: err?.message ?? t("debateTopicDetail.toast.postCommentErrorDefault"), variant: "destructive" });
        })
        .finally(() => setIsPostingWithImage(false));
      return;
    }

    postComment.mutate(
      { id, data: { commentText: text, visitorId, parentCommentId: replyTo?.id ?? null } },
      {
        onSuccess: applyNewComment,
        onError: (err: any) => {
          if (err?.data?.code === "comment_limit_reached") {
            toast({ title: err.data.error, variant: "destructive" });
            return;
          }
          toast({ title: t("debateTopicDetail.toast.postCommentErrorDefault"), variant: "destructive" });
        },
      },
    );
  }

  function handleImageSelect(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_COMMENT_IMAGE_MIME_TYPES.includes(file.type)) {
      toast({ title: t("debateTopicDetail.toast.invalidImageType"), variant: "destructive" });
      return;
    }
    if (file.size > MAX_COMMENT_IMAGE_BYTES) {
      toast({ title: t("debateTopicDetail.toast.imageTooLarge"), variant: "destructive" });
      return;
    }
    setImageFile(file);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function clearImage() {
    setImageFile(null);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  // There's only one useReactToDebateTopicComment() mutation instance for
  // the whole thread, so its own .isPending is shared across every comment
  // — passing that directly as each CommentCard's reactPending would
  // disable like/dislike on EVERY comment while any one reaction is in
  // flight. Tracking which comment actually owns the in-flight request
  // lets each CommentCard only disable itself.
  const [pendingReactionCommentId, setPendingReactionCommentId] = useState<string | null>(null);

  function handleReact(commentId: string, reaction: "like" | "dislike") {
    if (!id) return;
    setPendingReactionCommentId(commentId);
    reactToComment.mutate(
      { id, commentId, data: { visitorId, reaction } },
      {
        onSuccess: (result) => {
          queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
            old
              ? {
                  ...old,
                  comments: old.comments.map((c) => (c.id === commentId ? { ...c, ...result } : c)),
                }
              : old,
          );
        },
        onError: () => toast({ title: t("debateTopicDetail.toast.reactionError"), variant: "destructive" }),
        onSettled: () => setPendingReactionCommentId((current) => (current === commentId ? null : current)),
      },
    );
  }

  function handleRewhisp() {
    if (!id) return;
    rewhisp.mutate(
      { id, data: { visitorId } },
      {
        onSuccess: (result) => {
          queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
            old ? { ...old, rewhispCount: result.rewhispCount, viewerRewhisped: result.viewerRewhisped } : old,
          );
        },
        onError: () => toast({ title: t("debateTopicDetail.toast.rewhispError"), variant: "destructive" }),
      },
    );
  }

  function handleAuthorFollowToggled(patch: { following: boolean; followerCount?: number }) {
    if (!id) return;
    queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
      old
        ? {
            ...old,
            authorFollowed: patch.following,
            authorFollowerCount: patch.followerCount ?? old.authorFollowerCount,
          }
        : old,
    );
  }

  function handleCommentFollowToggled(commentId: string, patch: { following: boolean; followerCount?: number }) {
    if (!id) return;
    queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
      old
        ? {
            ...old,
            comments: old.comments.map((c) => (c.id === commentId ? { ...c, commentAuthorFollowed: patch.following } : c)),
          }
        : old,
    );
  }

  function handleRetract() {
    if (!id) return;
    deleteTopic.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("debateTopicDetail.toast.topicRetracted") });
          setLocation("/debate-topics");
        },
        onError: () => toast({ title: t("debateTopicDetail.toast.retractError"), variant: "destructive" }),
      },
    );
  }

  return (
    <DebatePageShell logoHref="/debate-topics">
      <div className="space-y-4 sm:space-y-5">
        <Button
          variant="ghost"
          onClick={() => setLocation("/debate-topics")}
          className="-ml-3 h-11 px-3 rounded-full text-muted-foreground hover:text-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" /> {t("debateTopicDetail.backButton")}
        </Button>

        {isLoading ? (
          <div className="space-y-4" aria-hidden>
            <div className="rounded-2xl border border-border/50 bg-card p-5 sm:p-8 space-y-5">
              <Skeleton className="h-6 w-28 rounded-full" />
              <div className="flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
              </div>
              <Skeleton className="h-8 w-11/12" />
              <Skeleton className="h-8 w-2/3" />
            </div>
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        ) : !topic ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/50 text-center py-16 px-6">
            <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">{t("debateTopicDetail.notFound")}</p>
          </div>
        ) : (
          <>
            {/* Topic headline card — the primary/violet identity styling stays,
                with an added gilded ring so every topic card (feed + here)
                reads as framed the same way. */}
            <article className="relative rounded-2xl border border-primary/30 ring-1 ring-gilded/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-8 overflow-hidden">
              <div
                className="absolute top-3 right-5 sm:top-4 sm:right-7 text-[6rem] sm:text-[7rem] font-serif select-none pointer-events-none opacity-[0.07] leading-[0.8]"
                aria-hidden
              >
                &ldquo;
              </div>
              <div className="relative space-y-5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                  <Swords className="w-3.5 h-3.5" /> {t("debateTopicDetail.topicBadge")}
                </div>
                {/* X/Twitter-style: avatar + handle/meta above the post
                    text, which then spans the full card width. */}
                <div className="flex items-center gap-3" data-testid="text-topic-author">
                  <AvatarCircle
                    avatarId={topic.authorAvatarId}
                    handle={topic.authorHandle}
                    size="md"
                    online={!!onlineMap[topic.authorHandle]}
                    onlineLabel={t("debateTopicDetail.onlineAriaLabel")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground break-words">{topic.authorHandle}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      <time dateTime={topic.createdAt}>
                        {formatTimeAgo(new Date(topic.createdAt))}
                      </time>
                      {topic.authorFollowerCount > 0 &&
                        ` · ${t("debateTopicDetail.followerCount", { count: topic.authorFollowerCount })}`}
                    </p>
                  </div>
                  {topic.authorFollowed !== null && (
                    <div className="shrink-0">
                      <FollowButton
                        handle={topic.authorHandle}
                        following={topic.authorFollowed}
                        followerCount={topic.authorFollowerCount}
                        onToggled={handleAuthorFollowToggled}
                      />
                    </div>
                  )}
                </div>
                <h1 className="font-serif text-[1.75rem] sm:text-4xl font-bold text-foreground leading-[1.15] tracking-tight break-words">
                  {topic.topicText}
                </h1>
                <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/40 -mx-2 -mb-2">
                  <div className="flex items-center gap-1 min-w-0">
                    <button
                      type="button"
                      onClick={handleRewhisp}
                      disabled={rewhisp.isPending}
                      aria-pressed={topic.viewerRewhisped}
                      className={`inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-full text-[13px] font-medium tabular-nums transition-colors duration-150 disabled:opacity-60 ${
                        topic.viewerRewhisped
                          ? "text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/15"
                          : "text-muted-foreground hover:text-emerald-400 hover:bg-emerald-400/10"
                      }`}
                      data-testid="button-rewhisp"
                    >
                      <Repeat2 className="w-4 h-4" />
                      {topic.rewhispCount}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWhispDialogOpen(true)}
                      className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-full text-[13px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors duration-150 whitespace-nowrap"
                      data-testid="button-whisper-topic"
                    >
                      <Share2 className="w-4 h-4" /> {t("debateTopicDetail.whisperButton")}
                    </button>
                  </div>
                  <div className="shrink-0">
                    {!topic.isOwnTopic && <ReportContentDialog contentType="debate_topic" contentId={topic.id} />}
                    {topic.isOwnTopic && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-full text-[13px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
                          >
                            <Trash2 className="w-4 h-4" /> {t("debateTopicDetail.retractTriggerButton")}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("debateTopicDetail.retractTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("debateTopicDetail.retractDescription")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("debateTopicDetail.cancelButton")}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleRetract}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              disabled={deleteTopic.isPending}
                            >
                              {deleteTopic.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                              {t("debateTopicDetail.retractConfirmButton")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </div>
            </article>

            {/* Anonymity explainer — signed-out only, always shown (not
                reactive to any action) since the whole point is setting
                expectations BEFORE someone starts typing: this is the one
                place on the page that says outright there's no account wall
                to post OR reply, and that creating one later is additive
                (a following, a persistent handle) rather than required. The
                "Become a Whisperer" CTA lives here too, next to the pitch it
                belongs to, instead of crowding the composer's action row. */}
            {!isSignedIn && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t("debateTopicDetail.anonymousExplainer.title")}</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{t("debateTopicDetail.anonymousExplainer.body")}</p>
                  <a
                    href="/sign-up"
                    className="flex items-start gap-1.5 py-2 sm:py-1 text-[13px] font-medium text-primary hover:underline underline-offset-2"
                  >
                    <UserPlus className="w-3.5 h-3.5 shrink-0 mt-[3px]" />
                    <span>{t("debateTopicDetail.becomeWhispererCta")}</span>
                  </a>
                </div>
              </div>
            )}

            {/* Comment composer */}
            <section className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
                <h2 className="font-sans text-sm font-semibold text-foreground flex items-center gap-2 tabular-nums">
                  <MessageCircle className="w-4 h-4 text-primary" />
                  {t("debateTopicDetail.commentCount", { count: topic.commentCount })}
                </h2>
                {myHandle && (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AvatarCircle avatarId={myAvatarId} handle={myHandle} size="sm" />
                    <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                      {t("debateTopicDetail.commentingAsPrefix")} <span className="font-medium text-foreground">{myHandle}</span>
                      <HandleRenameControl
                        topicId={id!}
                        visitorId={visitorId}
                        currentHandle={myHandle}
                        onRenamed={(handle) => {
                          if (!id) return;
                          queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
                            old
                              ? { ...old, comments: old.comments.map((c) => (c.isOwnComment ? { ...c, handle } : c)) }
                              : old,
                          );
                        }}
                      />
                      <AvatarPickerControl
                        topicId={id!}
                        visitorId={visitorId}
                        currentAvatarId={myAvatarId}
                        handle={myHandle}
                        onChanged={(avatarId) => {
                          if (!id) return;
                          queryClient.setQueryData<DebateTopicDetailResponse>(getGetDebateTopicQueryKey(id, { visitorId }), (old) =>
                            old
                              ? { ...old, comments: old.comments.map((c) => (c.isOwnComment ? { ...c, avatarId } : c)) }
                              : old,
                          );
                        }}
                      />
                    </p>
                  </div>
                )}
              </div>

              {replyTo && (
                <div className="flex items-center justify-between gap-2 text-[13px] bg-muted/40 rounded-xl pl-3 pr-1 py-1">
                  <span className="text-muted-foreground truncate">
                    {t("debateTopicDetail.replyingToPrefix")} <span className="text-foreground font-medium">@{replyTo.handle}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 shrink-0"
                    aria-label={t("debateTopicDetail.cancelReplyAria")}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value.slice(0, MAX_COMMENT_TEXT_LENGTH + 40))}
                placeholder={t("debateTopicDetail.commentPlaceholder")}
                rows={3}
                className="resize-none bg-background/60 border-border/50 rounded-xl text-[15px] leading-relaxed"
                data-testid="input-comment-text"
              />

              <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed">
                <HeartHandshake className="w-3.5 h-3.5 shrink-0 mt-px text-primary/70" />
                {t("debateTopicDetail.keepKindText")}
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_COMMENT_IMAGE_MIME_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  handleImageSelect(e.target.files?.[0]);
                  e.target.value = "";
                }}
                data-testid="input-comment-image"
              />

              {imagePreviewUrl && (
                <div className="relative inline-block">
                  <img
                    src={imagePreviewUrl}
                    alt={t("debateTopicDetail.altAttachmentPreview")}
                    className="max-h-40 rounded-xl border border-border/50"
                    data-testid="img-comment-preview"
                  />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                    aria-label={t("debateTopicDetail.ariaRemoveImage")}
                    data-testid="button-remove-image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 -ml-1 rounded-full text-[13px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors duration-150 whitespace-nowrap"
                  data-testid="button-attach-image"
                >
                  <ImagePlus className="w-4 h-4" />{" "}
                  {imageFile ? t("debateTopicDetail.changeImageButton") : t("debateTopicDetail.addImageButton")}
                </button>
                <span
                  className={`ml-auto text-xs tabular-nums ${remaining < 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}
                  aria-label={t("debateTopicDetail.charactersLeftAria", { count: remaining })}
                >
                  {remaining}
                </span>
                <Button
                  className={`rounded-full h-11 sm:h-9 px-5 ${canSubmit ? "shadow-[0_0_18px_rgba(124,92,252,0.35)]" : ""}`}
                  disabled={!canSubmit}
                  onClick={handlePostComment}
                  data-testid="button-post-comment"
                >
                  {postComment.isPending || isPostingWithImage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {t("debateTopicDetail.postButton")}
                </Button>
              </div>
            </section>

            {/* Fires once, right after that first successful anonymous post
                (see applyNewComment) — not a gate before Send, a follow-up
                after it, framed around the one thing an account concretely
                buys them for the comment they just made. Dismissible: this
                is a nudge, not a wall. */}
            {showPostSignupNudge && !isSignedIn && (
              <div
                className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3"
                data-testid="banner-post-signup-nudge"
              >
                <Bell className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="space-y-1.5 flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{t("debateTopicDetail.postSignupNudge.title")}</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{t("debateTopicDetail.postSignupNudge.body")}</p>
                  <a
                    href="/sign-up"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
                    data-testid="link-post-signup-nudge-cta"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> {t("debateTopicDetail.postSignupNudge.cta")}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPostSignupNudge(false)}
                  className="inline-flex items-center justify-center w-9 h-9 -mt-2 -mr-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 shrink-0"
                  aria-label={t("debateTopicDetail.postSignupNudge.dismissAria")}
                  data-testid="button-dismiss-post-signup-nudge"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Comment thread — X/Twitter-style: each root comment, then its
                direct replies grouped and indented beneath it. */}
            {threads.length > 0 && (
              <div className="flex flex-col gap-3 md:gap-4 pt-1">
                {threads.map(({ root, replies }) => (
                  <div key={root.id} className="flex flex-col gap-2">
                    <CommentCard
                      comment={root}
                      online={!!onlineMap[root.handle]}
                      onReply={() => setReplyTo({ id: root.id, handle: root.handle })}
                      onReact={(reaction) => handleReact(root.id, reaction)}
                      reactPending={pendingReactionCommentId === root.id}
                      onFollowToggle={(patch) => handleCommentFollowToggled(root.id, patch)}
                    />
                    {replies.length > 0 && (
                      <div className="ml-3 sm:ml-6 pl-3 sm:pl-4 border-l-2 border-border/40 flex flex-col gap-2">
                        {replies.map((reply) => (
                          <CommentCard
                            key={reply.id}
                            comment={reply}
                            parentHandle={
                              reply.parentCommentId ? commentsById.get(reply.parentCommentId)?.handle : undefined
                            }
                            online={!!onlineMap[reply.handle]}
                            onReply={() => setReplyTo({ id: reply.id, handle: reply.handle })}
                            onReact={(reaction) => handleReact(reply.id, reaction)}
                            reactPending={pendingReactionCommentId === reply.id}
                            onFollowToggle={(patch) => handleCommentFollowToggled(reply.id, patch)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {topic && (
        <SendDebateTopicWhispDialog
          topicId={topic.id}
          topicText={topic.topicText}
          open={whispDialogOpen}
          onOpenChange={setWhispDialogOpen}
        />
      )}
    </DebatePageShell>
  );
}
