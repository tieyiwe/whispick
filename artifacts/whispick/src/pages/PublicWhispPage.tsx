import { useParams } from "wouter";
import { useState } from "react";
import {
  useGetPublicWhisp,
  useTrackWhispEvent,
  usePublicReply,
  useRespondReveal,
  getGetPublicWhispQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MoodTag, MOOD_CONFIG } from "@/components/shared/MoodTag";
import { useToast } from "@/hooks/use-toast";
import { Send, Check, Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { VideoPlayer } from "@/components/shared/VideoPlayer";
import { QUICK_REPLIES } from "@/lib/quickReplies";

function WhispickLogoMark() {
  return (
    <div className="flex items-center gap-2">
      <Logo className="w-6 h-6 text-primary" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight">whispick</span>
    </div>
  );
}

export function PublicWhispPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replied, setReplied] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [hasTrackedOpen, setHasTrackedOpen] = useState(false);
  const [revealResponse, setRevealResponse] = useState<"accepted" | "declined" | null>(null);

  const { data: whisp, isLoading } = useGetPublicWhisp(token!, {
    query: {
      enabled: !!token,
      queryKey: getGetPublicWhispQueryKey(token!),
    },
  });

  const trackEvent = useTrackWhispEvent();
  const publicReply = usePublicReply();
  const respondReveal = useRespondReveal();

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
  }

  function submitReply(text: string) {
    publicReply.mutate(
      { token: token!, data: { replyText: text } },
      {
        onSuccess: () => {
          setReplied(true);
          queryClient.invalidateQueries({ queryKey: getGetPublicWhispQueryKey(token!) });
          toast({ title: "Reply sent anonymously" });
        },
        onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
      }
    );
  }

  function handleReply() {
    if (!replyText.trim()) return;
    submitReply(replyText.trim());
  }

  const moodColor = (whisp?.moodTag && MOOD_CONFIG[whisp.moodTag]?.color) || "#7C5CFC";

  return (
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
        <WhispickLogoMark />
        <a
          href="/sign-up"
          className="text-xs text-muted-foreground hover:text-primary transition-colors py-2"
        >
          Create your own whisp
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
            {/* Lead text */}
            <p className="text-center text-xl font-serif text-foreground leading-snug">
              Someone who cares about you thought you should see this 👀
            </p>

            {/* Video card */}
            <div className="rounded-2xl overflow-hidden bg-card border border-border/50 glow-card">
              <VideoPlayer
                platform={whisp.videoPlatform}
                embedUrl={whisp.videoEmbedUrl}
                videoUrl={whisp.videoUrl}
                thumbnail={whisp.videoThumbnail}
                title={whisp.videoTitle}
                onWatchEvent={handleWatchEvent}
              />

              <div className="p-5 space-y-3">
                {whisp.videoTitle && (
                  <p className="font-medium text-foreground">{whisp.videoTitle}</p>
                )}

                {whisp.moodTag && <MoodTag mood={whisp.moodTag} />}

                {whisp.anonymousNote && (
                  <div className="border-l-2 border-primary/40 pl-4">
                    <p className="text-foreground italic text-sm leading-relaxed">"{whisp.anonymousNote}"</p>
                    {whisp.senderAlias && (
                      <p className="text-xs text-muted-foreground mt-2">— {whisp.senderAlias}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Reply section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-xs text-muted-foreground">Want to reply anonymously?</span>
                <div className="flex-1 h-px bg-border/40" />
              </div>

              {replied ? (
                <div className="text-center py-4 space-y-2">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                    <Check className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground">Your reply was sent anonymously.</p>
                </div>
              ) : (
                <div className="space-y-3">
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
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{replyText.length}/300</span>
                    <Button
                      onClick={handleReply}
                      disabled={!replyText.trim() || publicReply.isPending}
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
              )}
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
          <a href="/" className="text-primary hover:underline">Whispick</a>
          {" "}— send what matters, without the awkward part.
        </p>
      </footer>
    </div>
  );
}
