import { useParams, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useGetPublicInvite, useRespondInviteReveal, getGetPublicInviteQueryKey } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Eye, Sparkles, ShieldCheck } from "lucide-react";
import confetti from "canvas-confetti";
import { LogoLockup } from "@/components/ui/logo";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { savePendingInvite } from "@/lib/pendingInvite";

function BlindWhisperLogoMark() {
  return (
    // A recipient's first and often only sight of the brand, so the lockup
    // gets its full form here — mark at a real size, with the strapline.
    <LogoLockup tagline />
  );
}

export function PublicInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [revealResponse, setRevealResponse] = useState<"accepted" | "declined" | null>(null);
  const { t } = useTranslation("account");

  // This is a private, single-recipient page — never indexable, even if a
  // link to it ends up publicly posted somewhere. robots.txt disallows
  // /invite/ for well-behaved crawlers, but a noindex tag also stops a page
  // from being indexed off a discovered backlink alone. Same treatment as
  // PublicWhispPage.tsx's /w/:token page.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const { refetch, data: invite, isLoading } = useGetPublicInvite(token!, {
    query: { enabled: !!token, queryKey: getGetPublicInviteQueryKey(token!) },
  });

  const respondReveal = useRespondInviteReveal();

  function handleJoin(e: React.MouseEvent<HTMLButtonElement>) {
    // The recipient's one celebratory moment on this page — they leave for
    // the Clerk sign-up flow immediately after, so there's no later
    // "success" screen to put this on instead. Same brand-colored burst,
    // fired from the button itself, as VideoPlayer.tsx's own confetti.
    const rect = e.currentTarget.getBoundingClientRect();
    confetti({
      particleCount: 80,
      spread: 70,
      startVelocity: 35,
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      },
      colors: ["#7C5CFC", "#FF6B6B", "#a78bfa", "#F5F0E8"],
      disableForReducedMotion: true,
    });

    // Carries this invite's token through the sign-up hop so the backend
    // can attribute the resulting account back to it — see
    // lib/pendingInvite.ts and ClaimPendingInvite.tsx.
    savePendingInvite(token!);
    // A brief pause so the confetti is actually visible before this page's
    // own DOM (canvas-confetti draws into) gets torn down by the route
    // change — an instant navigate would cut the burst off before it's seen.
    setTimeout(() => setLocation("/sign-up"), 450);
  }

  function handleRevealResponse(accepted: boolean) {
    if (!invite?.id) return;
    respondReveal.mutate(
      { id: invite.id, data: { accepted } },
      {
        onSuccess: () => setRevealResponse(accepted ? "accepted" : "declined"),
        onError: () => toast({ title: t("publicInvitePage.toastError"), variant: "destructive" }),
      }
    );
  }

  return (
    <PullToRefresh onRefresh={() => refetch()}>
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
        ) : !invite ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">{t("publicInvitePage.notFound")}</p>
          </div>
        ) : (
          <>
            {/* Lead text — required verbatim framing, keep in sync with
                api-server's lib/copy.ts INVITE_HOOK_LINE by hand. No name,
                no hint who sent it, ever. */}
            <p className="text-center text-xl font-serif text-foreground leading-snug">
              {t("publicInvitePage.leadText")}
            </p>

            <div className="rounded-2xl overflow-hidden bg-card border border-border/50 glow-card p-6 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6 text-primary" />
              </div>
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">{t("publicInvitePage.stayAnonymousHeading")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("publicInvitePage.stayAnonymousDescription")}
                </p>
              </div>
              <Button size="lg" className="rounded-full w-full" onClick={handleJoin} data-testid="button-join-blind-whisper">
                <Sparkles className="w-4 h-4 mr-2" /> {t("publicInvitePage.joinButton")}
              </Button>
            </div>

            {/* Reveal section — only ever present once the person behind this
                invite has requested one, mirroring PublicWhispPage.tsx's
                reveal section exactly. */}
            {invite.revealRequested && (
              <div className="bg-card border border-primary/20 rounded-2xl p-4 text-center space-y-2">
                {revealResponse || invite.revealAccepted !== null ? (
                  <p className="text-sm text-muted-foreground">
                    {(revealResponse ?? (invite.revealAccepted ? "accepted" : "declined")) === "accepted"
                      ? t("publicInvitePage.revealAccepted")
                      : t("publicInvitePage.revealDeclined")}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground flex items-center justify-center gap-1.5">
                      <Eye className="w-4 h-4 text-primary" /> {t("publicInvitePage.revealRequestHeading")}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("publicInvitePage.revealRequestQuestion")}</p>
                    <div className="flex gap-2 justify-center pt-1">
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleRevealResponse(true)}
                        disabled={respondReveal.isPending}
                        data-testid="button-accept-invite-reveal"
                      >
                        {t("publicInvitePage.accept")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => handleRevealResponse(false)}
                        disabled={respondReveal.isPending}
                        data-testid="button-decline-invite-reveal"
                      >
                        {t("publicInvitePage.decline")}
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
          {t("publicInvitePage.poweredByPrefix")}{" "}
          <a href="/" className="text-primary hover:underline">Blind Whisper</a>
          {" "}{t("publicInvitePage.poweredBySuffix")}
        </p>
      </footer>
      </div>
    </PullToRefresh>
  );
}
