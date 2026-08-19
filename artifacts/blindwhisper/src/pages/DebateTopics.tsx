import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { useListDebateTopics } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/ui/logo";
import { useToast } from "@/hooks/use-toast";
import { Swords, MessageCircle, Repeat2, Share2, ArrowRight, Loader2 } from "lucide-react";

function BlindWhisperLogoMark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Logo className="w-6 h-6 text-primary" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight">Blind Whisper</span>
    </Link>
  );
}

// Deterministic-ish "randomness" (by id) so the same topic doesn't jump
// between accent colors on every re-render/refetch — purely decorative, a
// little visual variety across the feed instead of one flat repeating card.
const ACCENTS = [
  { glow: "rgba(124,92,252,0.18)", text: "text-primary" },
  { glow: "rgba(236,72,153,0.16)", text: "text-[#EC4899]" },
  { glow: "rgba(45,212,191,0.16)", text: "text-[#2DD4BF]" },
  { glow: "rgba(251,191,36,0.16)", text: "text-[#FBBF24]" },
];
function accentFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length]!;
}

export function DebateTopics() {
  const { isSignedIn } = useUser();
  const { toast } = useToast();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const { data, isLoading, isFetching } = useListDebateTopics(cursor ? { cursor } : undefined);
  const items = data?.items ?? [];

  // Distinct from "rewhisp" (the retweet-style boost on the detail page) —
  // this just gets the topic's link in front of someone so they can join the
  // debate, same clipboard-copy pattern as MyCircles.tsx's invite code copy.
  function handleShareTopic(e: React.MouseEvent, topicId: string) {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/debate-topics/${topicId}`;
    if (navigator.share) {
      navigator.share({ title: "Blind Whisper — Debate Topic", url }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied — send it to bring someone into the debate" }));
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
        {isSignedIn ? (
          <Link href="/debate-topics/new">
            <Button size="sm" className="rounded-full shadow-[0_0_16px_rgba(124,92,252,0.3)]">
              Post a Topic
            </Button>
          </Link>
        ) : (
          <a href="/sign-up" className="text-xs text-muted-foreground hover:text-primary transition-colors py-2">
            Become a Whisperer
          </a>
        )}
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-5 py-10 space-y-8 relative z-10">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
            <Swords className="w-3.5 h-3.5" />
            <span>Debate Topics</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground leading-tight tracking-tight">
            Where do you stand?
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Short, anonymous prompts from Whisperers. Read, weigh in, or post your own — no account needed to
            join the conversation.
          </p>
          {!isSignedIn && (
            <div className="pt-1">
              <a href="/sign-up">
                <Button variant="outline" size="sm" className="rounded-full">
                  Become a Whisperer to post a topic
                </Button>
              </a>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : items.length ? (
          <div className="space-y-4">
            {items.map((topic) => {
              const accent = accentFor(topic.id);
              return (
                <Link key={topic.id} href={`/debate-topics/${topic.id}`}>
                  {/* Gilded frame (see index.css's --gilded token, same one
                      WhispsList.tsx uses for its pin ring) around every topic
                      card, on top of the per-topic accent glow. */}
                  <article
                    className="group relative rounded-2xl border border-gilded/40 bg-card hover:bg-card/80 transition-all cursor-pointer p-6 overflow-hidden"
                    style={{ boxShadow: `0 0 28px ${accent.glow}` }}
                    data-testid={`debate-topic-${topic.id}`}
                  >
                    <div
                      className="absolute -top-6 -right-4 text-7xl font-serif select-none pointer-events-none opacity-[0.06] leading-none"
                      aria-hidden
                    >
                      &rdquo;
                    </div>
                    <p className="relative font-serif text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight pr-6">
                      {topic.topicText}
                    </p>
                    <div className="relative flex items-center justify-between gap-3 mt-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${accent.text}`}>
                          <MessageCircle className="w-3.5 h-3.5" />
                          {topic.commentCount} {topic.commentCount === 1 ? "comment" : "comments"}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Repeat2 className="w-3.5 h-3.5" />
                          {topic.rewhispCount}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleShareTopic(e, topic.id)}
                          aria-label="Whisper this topic"
                          className="p-1.5 -m-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          data-testid={`button-share-${topic.id}`}
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                          Join the debate <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center bg-card/50">
            <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-medium text-foreground mb-2">No debates yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Be the first to post a topic — a question, an opinion, anything worth arguing about.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-2">
          {cursors.length > 0 && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setCursors((c) => c.slice(0, -1))}>
              Newer
            </Button>
          )}
          {data?.nextCursor && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={isFetching}
              onClick={() => setCursors((c) => [...c, data.nextCursor!])}
            >
              {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              More topics
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
