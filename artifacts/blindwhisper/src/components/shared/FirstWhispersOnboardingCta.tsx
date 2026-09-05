import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetUserProfile, useGetWhispStats } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <>
      <h2 className="text-xl font-serif font-semibold pt-2">{t("dashboardCard.title")}</h2>
      <Card className="bg-card border-border/50 relative overflow-hidden" data-testid="card-first-whispers-nudge">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-7 w-7 rounded-full text-muted-foreground z-10"
          onClick={handleDismiss}
          aria-label={t("dashboardCard.dismiss")}
          data-testid="button-dismiss-first-whispers-cta"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
            <UsersRound className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">{t("dashboardCard.heading")}</h3>
          <p className="text-sm text-muted-foreground mb-6">{t("dashboardCard.description")}</p>
          <Link href="/onboarding/first-whispers">
            <Button className="w-full rounded-full" data-testid="button-start-first-whispers">
              {t("dashboardCard.cta")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
