import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetPublicTextWhisp, getGetPublicTextWhispQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Sparkles, ScrollText } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { TextWhispScroll } from "@/components/shared/TextWhispScroll";

function BlindWhisperLogoMark() {
  return (
    <div className="flex items-center gap-2">
      <Logo className="w-6 h-6 text-primary" />
      <span className="font-serif text-xl font-bold text-foreground tracking-tight">Blind Whisper</span>
    </div>
  );
}

// Unauthenticated guest landing page for a Text Whisp sent to a phone number
// that wasn't (yet) a verified Blind Whisper account — see
// lib/db/src/schema/text_whisps.ts's dual-path comment and
// routes/publicTextWhisps.ts. Deliberately view-only: unlike PublicWhispPage,
// there is no working reply box here — a guest can never reply without an
// account (see routes/publicTextWhisps.ts's own comment on why), so every
// "respond" affordance below is a sign-up CTA instead of a real control.
export function PublicTextWhisp() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();

  // Same "never indexable" treatment as PublicWhispPage.tsx / PublicInvitePage.tsx.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const { data: textWhisp, isLoading } = useGetPublicTextWhisp(token!, {
    query: { enabled: !!token, queryKey: getGetPublicTextWhispQueryKey(token!) },
  });

  function handleSignUp() {
    setLocation("/sign-up");
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute top-[-15%] left-[-15%] w-[70%] h-[45%] rounded-full blur-[110px] pointer-events-none bg-primary/16" />
      <div className="absolute bottom-[-10%] right-[-15%] w-[55%] h-[35%] rounded-full blur-[100px] pointer-events-none bg-secondary/10" />

      {/* Header */}
      <header
        className="px-5 pb-5 flex items-center justify-between border-b border-border/30 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <BlindWhisperLogoMark />
      </header>

      {/* Content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-5 py-10 space-y-7 relative z-10">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-48 mx-auto" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : !textWhisp ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">This Text Whisp could not be found — the link may have expired or is no longer valid.</p>
          </div>
        ) : (
          <>
            <p className="text-center text-xl font-serif text-foreground leading-snug flex items-center justify-center gap-2">
              <ScrollText className="w-5 h-5 text-primary shrink-0" /> You've received an anonymous Text Whisp
            </p>

            <div className="rounded-2xl bg-gradient-to-b from-background to-card/60 border border-border/30 py-8 px-4">
              <TextWhispScroll mode="open" messageText={textWhisp.messageText} senderAlias={textWhisp.senderAlias} createdAt={textWhisp.createdAt} />
            </div>

            {/* Reply CTA — replaces a working reply box entirely. Guests
                can't reply without an account (see routes/publicTextWhisps.ts). */}
            <div className="rounded-2xl overflow-hidden bg-card border border-border/50 glow-card p-6 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">Want to reply?</p>
                <p className="text-sm text-muted-foreground">
                  Sign up free to reply the same way — anonymous, fold-and-unfurl included.
                </p>
              </div>
              <Button size="lg" className="rounded-full w-full" onClick={handleSignUp} data-testid="button-sign-up-to-reply">
                <Sparkles className="w-4 h-4 mr-2" /> Sign up free
              </Button>
            </div>

            <div className="rounded-2xl border border-border/40 p-4 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Send an anonymous Text Whisp of your own —{" "}
                <button type="button" onClick={handleSignUp} className="text-primary hover:underline font-medium" data-testid="button-sign-up-to-send">
                  sign up free
                </button>
                .
              </p>
            </div>

            {/* Reveal section — same "sign up to respond" treatment as the
                reply box above: the real accept/decline control only exists
                for an authenticated recipient (TextWhispDetail.tsx), once
                they've signed up. */}
            {textWhisp.revealRequested && (
              <div className="bg-card border border-primary/20 rounded-2xl p-4 text-center space-y-2">
                <p className="text-sm font-medium text-foreground flex items-center justify-center gap-1.5">
                  <Eye className="w-4 h-4 text-primary" /> Whoever sent this wants to reveal themselves.
                </p>
                <p className="text-xs text-muted-foreground">Sign up free to accept or decline.</p>
                <Button size="sm" className="rounded-full" onClick={handleSignUp} data-testid="button-sign-up-to-respond-reveal">
                  Sign up free
                </Button>
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
          <a href="/" className="text-primary hover:underline">Blind Whisper</a>
          {" "}— send what matters, without the awkward part.
        </p>
      </footer>
    </div>
  );
}
