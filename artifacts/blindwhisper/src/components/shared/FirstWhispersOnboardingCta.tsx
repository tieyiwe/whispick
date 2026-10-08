import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetUserProfile, useGetWhispStats } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsersRound, X } from "lucide-react";
import { hasDismissedFirstWhispersCta, dismissFirstWhispersCta } from "@/lib/firstWhispersOnboarding";

// Dashboard's cold-start growth nudge (the "send to a few friends at once"
// onboarding flow, FirstWhispersOnboarding.tsx) — a self-contained,
// additive block on purpose, same reasoning as the Whisper Box/Recap cards
// it sits alongside: Dashboard.tsx is shared with other in-flight work.
// Only ever shown to an account that hasn't sent a single Whisp yet
// (stats.totalSent === 0, the same "brand new" signal the rest of this app
// has no dedicated field for) and dismissible per-browser via
// lib/firstWhispersOnboarding.ts, same "dismiss once, don't nag again"
// contract as PhoneVerificationDialog.
export function FirstWhispersOnboardingCta() {
  const { t } = useTranslation("firstWhispers");
  const { data: profile } = useGetUserProfile();
  const { data: stats } = useGetWhispStats();
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  if (dismissedThisSession) return null;
  if (!profile) return null;
  if ((stats?.totalSent ?? 0) > 0) return null;
  if (hasDismissedFirstWhispersCta(profile.id)) return null;

  function handleDismiss() {
    // Optimistic, same as MfaNudgeBanner's skip: hide immediately rather
    // than waiting on anything, since this is purely a local preference.
    setDismissedThisSession(true);
    dismissFirstWhispersCta(profile!.id);
  }

  // Same compact side-card shape as the Dashboard's Recap/Whisper Box cards
  // (icon + title + one line, then one action). Outline, not filled: on a
  // brand-new account the Dashboard's welcome card already carries the
  // page's one primary action.
  return (
    <Card className="relative flex h-full flex-col overflow-hidden rounded-2xl border-border/50 bg-card/60 p-5 shadow-none" data-testid="card-first-whispers-nudge">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-9 w-9 rounded-full text-muted-foreground hover:text-foreground z-10"
        onClick={handleDismiss}
        aria-label={t("dashboardCard.dismiss")}
        data-testid="button-dismiss-first-whispers-cta"
      >
        <X className="w-4 h-4" />
      </Button>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-primary/90">{t("dashboardCard.title")}</p>
      <div className="mt-3 mb-4 flex items-start gap-3.5 pr-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <UsersRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-serif font-semibold leading-snug text-foreground">{t("dashboardCard.heading")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("dashboardCard.description")}</p>
        </div>
      </div>
      <Button asChild variant="outline" className="mt-auto h-10 w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-foreground">
        <Link href="/onboarding/first-whispers" data-testid="button-start-first-whispers">
          {t("dashboardCard.cta")}
        </Link>
      </Button>
    </Card>
  );
}
