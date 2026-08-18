import { useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetDebateTopic,
  usePostDebateTopicComment,
  useDeleteDebateTopic,
  getGetDebateTopicQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/ui/logo";
import { useToast } from "@/hooks/use-toast";
import { getVisitorId } from "@/lib/anonymousVisitor";
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
import { Swords, MessageCircle, Send, Loader2, X, Trash2, HeartHandshake } from "lucide-react";

const MAX_COMMENT_TEXT_LENGTH = 500;

function BlindWhisperLogoMark() {
  return (
    <Link href="/debate-topics" className="flex items-center gap-2">
      <Logo className="w-6 h-6 text-primary" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight">Blind Whisper</span>
    </Link>
  );
}

export function DebateTopicDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isSignedIn } = useUser();
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; excerpt: string } | null>(null);
  const [justPostedIds, setJustPostedIds] = useState<Set<string>>(new Set());

  const { data: topic, isLoading } = useGetDebateTopic(id);
  const postComment = usePostDebateTopicComment();
  const deleteTopic = useDeleteDebateTopic();

  const visitorId = useMemo(() => getVisitorId(), []);
  const commentsById = useMemo(() => {
    const map = new Map<string, { commentText: string }>();
    for (const c of topic?.comments ?? []) map.set(c.id, c);
    return map;
  }, [topic]);

  const remaining = MAX_COMMENT_TEXT_LENGTH - commentText.length;
  const canSubmit = commentText.trim().length > 0 && remaining >= 0 && !postComment.isPending;

  function handlePostComment() {
    const text = commentText.trim();
    if (!text || !id) return;
    postComment.mutate(
      { id, data: { commentText: text, visitorId, parentCommentId: replyTo?.id ?? null } },
      {
        onSuccess: (comment) => {
          setCommentText("");
          setReplyTo(null);
          setJustPostedIds((prev) => new Set(prev).add(comment.id));
          queryClient.invalidateQueries({ queryKey: getGetDebateTopicQueryKey(id) });
        },
        onError: (err: any) => {
          if (err?.data?.code === "comment_limit_reached") {
            toast({ title: err.data.error, variant: "destructive" });
            return;
          }
          toast({ title: "Couldn't post that comment", variant: "destructive" });
        },
      },
    );
  }

  function handleRetract() {
    if (!id) return;
    deleteTopic.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Topic retracted" });
          setLocation("/debate-topics");
        },
        onError: () => toast({ title: "Couldn't retract that topic", variant: "destructive" }),
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
            Become a Whisperer
          </a>
        )}
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-5 py-10 space-y-8 relative z-10">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : !topic ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">This debate topic could not be found — it may have been retracted.</p>
          </div>
        ) : (
          <>
            {/* Topic headline card */}
            <div className="relative rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-8 overflow-hidden glow-card">
              <div className="absolute -top-8 -left-4 text-[8rem] font-serif select-none pointer-events-none opacity-[0.07] leading-none" aria-hidden>
                &ldquo;
              </div>
              <div className="relative space-y-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                  <Swords className="w-3.5 h-3.5" /> Debate Topic
                </div>
                <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-[1.15] tracking-tight">
                  {topic.topicText}
                </h1>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-muted-foreground">
                    Posted anonymously · {formatDistanceToNowStrict(new Date(topic.createdAt))} ago
                  </span>
                  {topic.isOwnTopic && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:text-destructive h-7 px-2.5">
                          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Retract
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Retract this topic?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes it from the public feed and its own page. Comments already posted stay
                            recorded, but nobody will be able to read or add to this thread again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleRetract}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteTopic.isPending}
                          >
                            {deleteTopic.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Retract topic
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
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-primary" />
                {topic.commentCount} {topic.commentCount === 1 ? "comment" : "comments"}
              </p>

              {replyTo && (
                <div className="flex items-center justify-between gap-2 text-xs bg-muted/40 rounded-lg px-3 py-2">
                  <span className="text-muted-foreground truncate">
                    Replying to: <span className="italic">"{replyTo.excerpt}"</span>
                  </span>
                  <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value.slice(0, MAX_COMMENT_TEXT_LENGTH + 40))}
                placeholder="Weigh in — where do you stand?"
                rows={3}
                className="resize-none bg-background/60 border-border/50 rounded-xl"
                data-testid="input-comment-text"
              />

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-sm">
                  <HeartHandshake className="w-3.5 h-3.5 shrink-0 text-primary/70" />
                  Keep it kind — genuine, productive debate, not a fight.
                </p>
                <span className={`text-xs ${remaining < 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {remaining}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                {!isSignedIn && (
                  <a href="/sign-up" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                    Become a Whisperer — comment anytime, no limits.
                  </a>
                )}
                <Button
                  size="sm"
                  className="rounded-full ml-auto"
                  disabled={!canSubmit}
                  onClick={handlePostComment}
                  data-testid="button-post-comment"
                >
                  {postComment.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                  Post
                </Button>
              </div>
            </div>

            {/* Comment thread */}
            {topic.comments.length > 0 && (
              <div className="space-y-3">
                {topic.comments.map((comment) => {
                  const parent = comment.parentCommentId ? commentsById.get(comment.parentCommentId) : null;
                  const isMine = justPostedIds.has(comment.id);
                  return (
                    <div
                      key={comment.id}
                      className={`rounded-2xl border p-4 space-y-2 ${
                        comment.isPoster ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card"
                      }`}
                      data-testid={`comment-${comment.id}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {comment.isPoster && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary px-2 py-0.5 rounded-full bg-primary/10">
                            Topic Author
                          </span>
                        )}
                        {isMine && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-0.5 rounded-full bg-muted/50">
                            You
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNowStrict(new Date(comment.createdAt))} ago
                        </span>
                      </div>
                      {parent && (
                        <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2 line-clamp-1">
                          "{parent.commentText}"
                        </p>
                      )}
                      <p className="text-sm text-foreground leading-relaxed">{comment.commentText}</p>
                      <button
                        onClick={() => setReplyTo({ id: comment.id, excerpt: comment.commentText.slice(0, 60) })}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        Reply
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
