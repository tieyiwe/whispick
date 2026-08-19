import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { useListDebateTopics } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/ui/logo";
import { DebateTopicCard } from "@/components/shared/DebateTopicCard";
import { Swords, Users, Loader2 } from "lucide-react";

function BlindWhisperLogoMark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Logo className="w-6 h-6 text-primary" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight">Blind Whisper</span>
    </Link>
  );
}

export function DebateTopics() {
  const { isSignedIn } = useUser();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const { data, isLoading, isFetching } = useListDebateTopics(cursor ? { cursor } : undefined);
  const items = data?.items ?? [];

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
          <div className="flex items-center gap-2">
            <Link href="/debate-topics/following">
              <Button variant="outline" size="sm" className="rounded-full" data-testid="link-debate-following">
                <Users className="w-3.5 h-3.5 mr-1.5" /> Following
              </Button>
            </Link>
            <Link href="/debate-topics/new">
              <Button size="sm" className="rounded-full shadow-[0_0_16px_rgba(124,92,252,0.3)]">
                Post a Topic
              </Button>
            </Link>
          </div>
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
            {items.map((topic) => (
              <DebateTopicCard key={topic.id} topic={topic} />
            ))}
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
