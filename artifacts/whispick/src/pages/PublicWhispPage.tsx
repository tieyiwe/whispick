import { useParams } from "wouter";
import { useState } from "react";
import {
  useGetPublicWhisp,
  useTrackWhispEvent,
  usePublicReply,
  getGetPublicWhispQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MoodTag } from "@/components/shared/MoodTag";
import { useToast } from "@/hooks/use-toast";
import { PlayCircle, Send, Check, Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";

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

  const { data: whisp, isLoading } = useGetPublicWhisp(token!, {
    query: {
      enabled: !!token,
      queryKey: getGetPublicWhispQueryKey(token!),
    },
  });

  const trackEvent = useTrackWhispEvent();
  const publicReply = usePublicReply();

  // Track "opened" on page load
  if (whisp && !hasTrackedOpen) {
    setHasTrackedOpen(true);
    trackEvent.mutate({ token: token!, data: { eventType: "opened" } });
  }

  function handleWatchClick() {
    trackEvent.mutate({ token: token!, data: { eventType: "clicked" } });
    if (whisp?.videoUrl) {
      window.open(whisp.videoUrl, "_blank", "noopener,noreferrer");
    }
  }

  function handleReply() {
    if (!replyText.trim()) return;
    publicReply.mutate(
      { token: token!, data: { replyText: replyText.trim() } },
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="p-5 flex items-center justify-between border-b border-border/30">
        <WhispickLogoMark />
        <a
          href="/sign-up"
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          Create your own whisp
        </a>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-5 py-10 space-y-7">
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
            <p className="text-center text-lg text-muted-foreground font-serif">
              Someone sent you something to see.
            </p>

            {/* Video card */}
            <div className="rounded-2xl overflow-hidden bg-card border border-border/50 glow-card">
              {whisp.videoThumbnail ? (
                <div className="relative">
                  <img
                    src={whisp.videoThumbnail}
                    alt={whisp.videoTitle ?? "Video"}
                    className="w-full object-cover max-h-64"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <button
                      onClick={handleWatchClick}
                      className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 active:scale-95 transition-all"
                      data-testid="button-watch-video"
                    >
                      <PlayCircle className="w-9 h-9 text-white" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleWatchClick}
                  className="w-full h-36 bg-muted flex flex-col items-center justify-center gap-2 hover:bg-muted/80 transition-colors"
                  data-testid="button-watch-video-no-thumb"
                >
                  <PlayCircle className="w-10 h-10 text-primary" />
                  <span className="text-sm text-muted-foreground">Watch the video</span>
                </button>
              )}

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

                <Button
                  onClick={handleWatchClick}
                  className="w-full rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
                  data-testid="button-watch-now"
                >
                  <PlayCircle className="w-4 h-4 mr-2" /> Watch Now
                </Button>
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
                <div className="space-y-2">
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
                <p className="text-sm font-medium text-foreground">
                  The person who sent this wants to reveal themselves.
                </p>
                <p className="text-xs text-muted-foreground">
                  Do you want to know who sent this to you?
                </p>
                <div className="flex gap-2 justify-center pt-1">
                  <Button size="sm" className="rounded-full" data-testid="button-accept-reveal">Accept</Button>
                  <Button size="sm" variant="outline" className="rounded-full" data-testid="button-decline-reveal">Decline</Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="p-5 text-center border-t border-border/30">
        <p className="text-xs text-muted-foreground">
          Powered by{" "}
          <a href="/" className="text-primary hover:underline">Whispick</a>
          {" "}— send what matters, without the awkward part.
        </p>
      </footer>
    </div>
  );
}
