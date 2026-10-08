import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useUser } from "@clerk/react";
import { useListDebateTopics } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/ui/logo";
import { DebateTopicCard } from "@/components/shared/DebateTopicCard";
import { Swords, Users, Loader2, ShieldCheck, Plus } from "lucide-react";

function BlindWhisperLogoMark({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 shrink-0 min-h-11">
      <Logo className="w-6 h-6 text-primary shrink-0" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight whitespace-nowrap">Blind Whisper</span>
    </Link>
  );
}

// Debate Now is public (visitors can read, post and reply anonymously), but a
// signed-in Whisperer shouldn't lose the app's navigation the moment they
// open it. So both Debate Now pages render through this shell: inside the
// regular AppLayout (sidebar / bottom tab bar, its own header) when signed
// in, and the standalone public header otherwise. While Clerk is still
// loading we show the public chrome (minus its sign-up CTA) rather than a
// blank page, so the content is never held hostage to the auth script.
export function DebatePageShell({ children, logoHref = "/" }: { children: ReactNode; logoHref?: string }) {
  const { t } = useTranslation("debateTopics");
  const { isSignedIn, isLoaded } = useUser();

  if (isSignedIn) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto w-full">{children}</div>
      </AppLayout>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      <div className="absolute top-[-15%] left-[-15%] w-[60%] h-[45%] rounded-full blur-[120px] pointer-events-none bg-primary/10" />
      <div className="absolute bottom-[-10%] right-[-15%] w-[45%] h-[35%] rounded-full blur-[100px] pointer-events-none bg-secondary/10" />

      <header
        className="px-4 sm:px-6 pb-3 flex items-center justify-between gap-3 border-b border-border/30 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <BlindWhisperLogoMark href={logoHref} />
        {isLoaded && (
          <a
            href="/sign-up"
            className="inline-flex items-center min-h-11 px-1 text-sm font-medium text-muted-foreground hover:text-primary transition-colors whitespace-nowrap"
          >
            {t("debateTopics.becomeWhisperer")}
          </a>
        )}
      </header>

      <main
        className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 pt-6 sm:pt-10 relative z-10"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2.5rem)" }}
      >
        {children}
      </main>
    </div>
  );
}

function DebateTopicCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 sm:p-6 space-y-3" aria-hidden>
      <div className="flex items-center gap-2.5">
        <Skeleton className="w-6 h-6 rounded-full" />
        <Skeleton className="h-3.5 w-36" />
      </div>
      <Skeleton className="h-6 w-11/12" />
      <Skeleton className="h-6 w-2/3" />
      <div className="flex items-center gap-3 pt-2">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-10" />
      </div>
    </div>
  );
}

export function DebateTopics() {
  const { t } = useTranslation("debateTopics");
  const { isSignedIn } = useUser();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const { data, isLoading, isFetching } = useListDebateTopics(cursor ? { cursor } : undefined);
  const items = data?.items ?? [];

  return (
    <DebatePageShell>
      <div className="space-y-6 sm:space-y-8">
        <section className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
            <Swords className="w-3.5 h-3.5" />
            <span>{t("debateTopics.pillLabel")}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground leading-tight tracking-tight">
            {t("debateTopics.heading")}
          </h1>
          <p className="text-[15px] text-muted-foreground max-w-md mx-auto leading-relaxed">{t("debateTopics.description")}</p>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {isSignedIn ? (
              <>
                <Button
                  asChild
                  className="rounded-full h-11 px-5 shadow-[0_0_20px_rgba(124,92,252,0.35)]"
                >
                  <Link href="/debate-topics/new" data-testid="link-post-debate-topic">
                    <Plus className="w-4 h-4" /> {t("debateTopics.postTopicButton")}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full h-11 px-5 border-border/60 text-foreground/90">
                  <Link href="/debate-topics/following" data-testid="link-debate-following">
                    <Users className="w-4 h-4" /> {t("debateTopics.followingButton")}
                  </Link>
                </Button>
              </>
            ) : (
              <Button asChild variant="outline" className="rounded-full h-11 px-5 border-border/60">
                <a href="/sign-up">{t("debateTopics.becomeWhispererToPost")}</a>
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            <Link
              href="/community-guidelines"
              className="inline-flex items-center gap-1 min-h-11 hover:text-primary transition-colors underline underline-offset-2 decoration-muted-foreground/40"
              data-testid="link-community-guidelines"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> {t("debateTopics.guidelinesLink")}
            </Link>
          </p>
        </section>

        {isLoading ? (
          <div className="flex flex-col gap-3 md:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <DebateTopicCardSkeleton key={i} />
            ))}
          </div>
        ) : items.length ? (
          <div className="flex flex-col gap-3 md:gap-4">
            {items.map((topic) => (
              <DebateTopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 py-14 px-6 text-center bg-card/50">
            <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">{t("debateTopics.emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">{t("debateTopics.emptyDescription")}</p>
          </div>
        )}

        {(cursors.length > 0 || data?.nextCursor) && (
          <div className="flex items-center justify-center gap-3">
            {cursors.length > 0 && (
              <Button variant="outline" className="rounded-full h-11 px-5" onClick={() => setCursors((c) => c.slice(0, -1))}>
                {t("debateTopics.newerButton")}
              </Button>
            )}
            {data?.nextCursor && (
              <Button
                variant="outline"
                className="rounded-full h-11 px-5"
                disabled={isFetching}
                onClick={() => setCursors((c) => [...c, data.nextCursor!])}
              >
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t("debateTopics.moreButton")}
              </Button>
            )}
          </div>
        )}
      </div>
    </DebatePageShell>
  );
}
