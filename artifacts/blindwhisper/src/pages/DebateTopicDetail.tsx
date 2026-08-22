import { useMemo, useRef, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
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
  getGetDebateTopicQueryKey,
  getAuthToken,
  type DebateTopicComment,
  type DebateTopicDetail as DebateTopicDetailResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/ui/logo";
import { useToast } from "@/hooks/use-toast";
import { getVisitorId } from "@/lib/anonymousVisitor";
import { FollowButton } from "@/components/shared/FollowButton";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { ReportContentDialog } from "@/components/shared/ReportContentDialog";
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
} from "lucide-react";

const MAX_COMMENT_TEXT_LENGTH = 500;
const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024;
// Mirrors artifacts/api-server/src/lib/commentImages.ts — keep in sync if the
// allowed types ever change. The server re-enforces this; this is purely so
// a bad file gets rejected before spending a round trip on it.
const ALLOWED_COMMENT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function BlindWhisperLogoMark() {
  return (
    <Link href="/debate-topics" className="flex items-center gap-2">
      <Logo className="w-6 h-6 text-primary" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight">Blind Whisper</span>
    </Link>
  );
}

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
          toast({ title: err?.data?.error ?? t("debateTopicDetail.toast.handleUpdateErrorDefault"), variant: "destructive" });
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
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
          aria-label={t("debateTopicDetail.handleRename.ariaLabel")}
          data-testid="button-edit-handle"
        >
          <Pencil className="w-3 h-3" />
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
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
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
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
          aria-label={t("debateTopicDetail.avatarPicker.ariaLabel")}
          data-testid="button-edit-avatar"
        >
          <Palette className="w-3 h-3" />
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
  onReply,
  onReact,
  reactPending,
  onFollowToggle,
}: {
  comment: DebateTopicComment;
  parentHandle?: string;
  onReply: () => void;
  onReact: (reaction: "like" | "dislike") => void;
  reactPending: boolean;
  onFollowToggle: (patch: { following: boolean; followerCount?: number }) => void;
}) {
  const { t } = useTranslation("debateTopics");
  return (
    <div
      className={`rounded-2xl border p-4 ${
        comment.isPoster ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card"
      }`}
      data-testid={`comment-${comment.id}`}
    >
      {/* X/Twitter-style: avatar in the top-left, handle/meta beside it,
          body text spanning the full width below. */}
      <div className="flex items-start gap-3">
        <AvatarCircle avatarId={comment.avatarId} handle={comment.handle} size="sm" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground" data-testid={`text-handle-${comment.id}`}>
              {comment.handle}
            </span>
            {/* commentAuthorFollowed is null when there's nothing followable here —
                purely anonymous commenter, caller not signed in, or it's the
                caller's own comment. No affordance shows in any of those cases. */}
            {comment.commentAuthorFollowed !== null && (
              <FollowButton
                handle={comment.handle}
                following={comment.commentAuthorFollowed}
                compact
                onToggled={onFollowToggle}
              />
            )}
            {comment.isPoster && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary px-2 py-0.5 rounded-full bg-primary/10">
                {t("debateTopicDetail.topicAuthorBadge")}
              </span>
            )}
            {comment.isOwnComment && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-0.5 rounded-full bg-muted/50">
                {t("debateTopicDetail.youBadge")}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {t("debateTopicDetail.timeAgo", { time: formatDistanceToNowStrict(new Date(comment.createdAt)) })}
            </span>
          </div>

          {parentHandle && (
            <p className="text-xs text-muted-foreground">
              {t("debateTopicDetail.replyingToPrefix")} <span className="text-primary/80">@{parentHandle}</span>
            </p>
          )}

          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{comment.commentText}</p>

          {comment.imageUrl && (
            <img
              src={comment.imageUrl}
              alt={t("debateTopicDetail.altAttachedImage")}
              className="max-h-64 rounded-xl border border-border/50 object-cover"
              data-testid={`img-comment-${comment.id}`}
            />
          )}

          <div className="flex items-center gap-4 pt-0.5">
            <button
              type="button"
              onClick={() => onReact("like")}
              disabled={reactPending}
              aria-pressed={comment.viewerReaction === "like"}
              className={`inline-flex items-center gap-1.5 text-xs transition-colors disabled:opacity-60 ${
                comment.viewerReaction === "like" ? "text-primary" : "text-muted-foreground hover:text-primary"
              }`}
              data-testid={`button-like-${comment.id}`}
            >
              <ThumbsUp className={`w-3.5 h-3.5 ${comment.viewerReaction === "like" ? "fill-primary/25" : ""}`} />
              {comment.likeCount}
            </button>
            <button
              type="button"
              onClick={() => onReact("dislike")}
              disabled={reactPending}
              aria-pressed={comment.viewerReaction === "dislike"}
              className={`inline-flex items-center gap-1.5 text-xs transition-colors disabled:opacity-60 ${
                comment.viewerReaction === "dislike" ? "text-destructive" : "text-muted-foreground hover:text-destructive"
              }`}
              data-testid={`button-dislike-${comment.id}`}
            >
              <ThumbsDown className={`w-3.5 h-3.5 ${comment.viewerReaction === "dislike" ? "fill-destructive/25" : ""}`} />
              {comment.dislikeCount}
            </button>
            <button
              onClick={onReply}
              className="text-xs text-muted-foreground hover:text-primary transition-colors ml-auto"
              data-testid={`button-reply-${comment.id}`}
            >
              {t("debateTopicDetail.replyButton")}
            </button>
            {/* No flag on your own comment — the report queue isn't a
                self-service delete button (the author has no retraction
                path for comments by design; see debate_topic_comments.ts). */}
            {!comment.isOwnComment && <ReportContentDialog contentType="debate_topic_comment" contentId={comment.id} compact />}
          </div>
        </div>
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visitorId = useMemo(() => getVisitorId(), []);
  const { data: topic, isLoading } = useGetDebateTopic(id, { visitorId });
  const postComment = usePostDebateTopicComment();
  const deleteTopic = useDeleteDebateTopic();
  const reactToComment = useReactToDebateTopicComment();
  const rewhisp = useRewhispDebateTopic();

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

  function handleReact(commentId: string, reaction: "like" | "dislike") {
    if (!id) return;
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

  function handleShareTopic() {
    if (!id) return;
    const url = `${window.location.origin}/debate-topics/${id}`;
    if (navigator.share) {
      navigator.share({ title: t("debateTopicDetail.shareTitle"), text: topic?.topicText, url }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(url).then(() => toast({ title: t("debateTopicDetail.toast.linkCopied") }));
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
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      <div className="absolute top-[-15%] left-[-15%] w-[60%] h-[45%] rounded-full blur-[120px] pointer-events-none bg-primary/10" />
      <div className="absolute bottom-[-10%] right-[-15%] w-[45%] h-[35%] rounded-full blur-[100px] pointer-events-none bg-secondary/10" />

      <header
        className="px-5 pb-5 flex items-center justify-between border-b border-border/30 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <BlindWhisperLogoMark />
        {!isSignedIn && (
          <a href="/sign-up" className="text-xs text-muted-foreground hover:text-primary transition-colors py-2">
            {t("debateTopicDetail.becomeWhisperer")}
          </a>
        )}
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-5 py-10 space-y-8 relative z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/debate-topics")}
          className="-ml-2 text-muted-foreground hover:text-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" /> {t("debateTopicDetail.backButton")}
        </Button>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : !topic ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">{t("debateTopicDetail.notFound")}</p>
          </div>
        ) : (
          <>
            {/* Topic headline card — the primary/violet identity styling stays,
                with an added gilded ring so every topic card (feed + here)
                reads as framed the same way. */}
            <div className="relative rounded-3xl border border-primary/30 ring-1 ring-gilded/30 bg-gradient-to-br from-primary/10 via-card to-card p-8 overflow-hidden glow-card">
              <div className="absolute -top-8 -left-4 text-[8rem] font-serif select-none pointer-events-none opacity-[0.07] leading-none" aria-hidden>
                &ldquo;
              </div>
              <div className="relative space-y-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                  <Swords className="w-3.5 h-3.5" /> {t("debateTopicDetail.topicBadge")}
                </div>
                {/* X/Twitter-style: avatar + handle/meta above the post
                    text, which then spans the full card width. */}
                <div className="flex items-center gap-3 flex-wrap" data-testid="text-topic-author">
                  <AvatarCircle avatarId={topic.authorAvatarId} handle={topic.authorHandle} size="md" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{topic.authorHandle}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("debateTopicDetail.timeAgo", { time: formatDistanceToNowStrict(new Date(topic.createdAt)) })}
                      {topic.authorFollowerCount > 0 &&
                        ` · ${t("debateTopicDetail.followerCount", { count: topic.authorFollowerCount })}`}
                    </p>
                  </div>
                  {topic.authorFollowed !== null && (
                    <FollowButton
                      handle={topic.authorHandle}
                      following={topic.authorFollowed}
                      followerCount={topic.authorFollowerCount}
                      onToggled={handleAuthorFollowToggled}
                    />
                  )}
                </div>
                <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-[1.15] tracking-tight">
                  {topic.topicText}
                </h1>
                <div className="flex items-center justify-end gap-1.5 pt-1 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRewhisp}
                      disabled={rewhisp.isPending}
                      aria-pressed={topic.viewerRewhisped}
                      className={`rounded-full h-7 px-2.5 ${
                        topic.viewerRewhisped
                          ? "text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/15"
                          : "text-muted-foreground hover:text-emerald-400 hover:bg-emerald-400/10"
                      }`}
                      data-testid="button-rewhisp"
                    >
                      <Repeat2 className="w-3.5 h-3.5 mr-1.5" />
                      {topic.rewhispCount}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleShareTopic}
                      className="rounded-full h-7 px-2.5 text-muted-foreground hover:text-primary hover:bg-primary/10"
                      data-testid="button-whisper-topic"
                    >
                      <Share2 className="w-3.5 h-3.5 mr-1.5" /> {t("debateTopicDetail.whisperButton")}
                    </Button>
                    {!topic.isOwnTopic && <ReportContentDialog contentType="debate_topic" contentId={topic.id} />}
                    {topic.isOwnTopic && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-destructive h-7 px-2.5">
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t("debateTopicDetail.retractTriggerButton")}
                          </Button>
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

            {/* Comment composer */}
            <div className="rounded-2xl border border-border/50 bg-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-primary" />
                  {t("debateTopicDetail.commentCount", { count: topic.commentCount })}
                </p>
                {myHandle && (
                  <div className="flex items-center gap-1.5">
                    <AvatarCircle avatarId={myAvatarId} handle={myHandle} size="sm" />
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
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
                <div className="flex items-center justify-between gap-2 text-xs bg-muted/40 rounded-lg px-3 py-2">
                  <span className="text-muted-foreground truncate">
                    {t("debateTopicDetail.replyingToPrefix")} <span className="text-foreground font-medium">@{replyTo.handle}</span>
                  </span>
                  <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value.slice(0, MAX_COMMENT_TEXT_LENGTH + 40))}
                placeholder={t("debateTopicDetail.commentPlaceholder")}
                rows={3}
                className="resize-none bg-background/60 border-border/50 rounded-xl"
                data-testid="input-comment-text"
              />

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
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                    aria-label={t("debateTopicDetail.ariaRemoveImage")}
                    data-testid="button-remove-image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-sm">
                  <HeartHandshake className="w-3.5 h-3.5 shrink-0 text-primary/70" />
                  {t("debateTopicDetail.keepKindText")}
                </p>
                <span className={`text-xs ${remaining < 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {remaining}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors rounded-full border border-border/50 px-2.5 py-1.5"
                    data-testid="button-attach-image"
                  >
                    <ImagePlus className="w-3.5 h-3.5" /> {imageFile ? t("debateTopicDetail.changeImageButton") : t("debateTopicDetail.addImageButton")}
                  </button>
                  {!isSignedIn && (
                    <a href="/sign-up" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                      {t("debateTopicDetail.becomeWhispererCta")}
                    </a>
                  )}
                </div>
                <Button
                  size="sm"
                  className="rounded-full ml-auto"
                  disabled={!canSubmit}
                  onClick={handlePostComment}
                  data-testid="button-post-comment"
                >
                  {postComment.isPending || isPostingWithImage ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {t("debateTopicDetail.postButton")}
                </Button>
              </div>
            </div>

            {/* Comment thread — X/Twitter-style: each root comment, then its
                direct replies grouped and indented beneath it. */}
            {threads.length > 0 && (
              <div className="space-y-4">
                {threads.map(({ root, replies }) => (
                  <div key={root.id} className="space-y-2">
                    <CommentCard
                      comment={root}
                      onReply={() => setReplyTo({ id: root.id, handle: root.handle })}
                      onReact={(reaction) => handleReact(root.id, reaction)}
                      reactPending={reactToComment.isPending}
                      onFollowToggle={(patch) => handleCommentFollowToggled(root.id, patch)}
                    />
                    {replies.length > 0 && (
                      <div className="ml-4 sm:ml-8 pl-3 sm:pl-4 border-l-2 border-border/40 space-y-2">
                        {replies.map((reply) => (
                          <CommentCard
                            key={reply.id}
                            comment={reply}
                            parentHandle={
                              reply.parentCommentId ? commentsById.get(reply.parentCommentId)?.handle : undefined
                            }
                            onReply={() => setReplyTo({ id: reply.id, handle: reply.handle })}
                            onReact={(reaction) => handleReact(reply.id, reaction)}
                            reactPending={reactToComment.isPending}
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
      </main>
    </div>
  );
}
