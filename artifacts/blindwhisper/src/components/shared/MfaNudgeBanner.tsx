import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useUser } from "@clerk/react";
import { useGetUserProfile, useDismissMfaNudge } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, X } from "lucide-react";

// Nag cadence: dismissing the nudge hides it for two weeks, not forever —
// 2FA protects an account that otherwise has no second factor at all, so
// it's worth resurfacing periodically rather than a one-and-done skip. Two
// weeks is long enough not to feel nagging on every visit, short enough
// that the reminder doesn't effectively disappear.
const RENAG_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function shouldShowNudge(dismissedAt: string | null | undefined): boolean {
  if (!dismissedAt) return true;
  return Date.now() - new Date(dismissedAt).getTime() > RENAG_AFTER_MS;
}

export function MfaNudgeBanner() {
  const { t } = useTranslation("sharedB");
  const { isLoaded, user } = useUser();
  const { data: profile } = useGetUserProfile();
  const dismissMfaNudge = useDismissMfaNudge();
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  if (dismissedThisSession) return null;
  if (!isLoaded || !user || !profile) return null;
  if (user.twoFactorEnabled) return null;
  if (!shouldShowNudge(profile.mfaNudgeDismissedAt)) return null;

  function handleSkip() {
    // Optimistic: hide immediately rather than waiting on the mutation or a
    // profile refetch — a skip should feel instant, and worst case (the
    // request fails) the nudge just reappears on the next visit.
    setDismissedThisSession(true);
    dismissMfaNudge.mutate();
  }

  return (
    <Card className="rounded-2xl bg-primary/[0.06] border-primary/20 shadow-none" data-testid="card-mfa-nudge">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12">
            <ShieldCheck className="w-4 h-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t("mfaNudgeBanner.title")}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("mfaNudgeBanner.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0">
          <Button variant="ghost" size="sm" className="h-9 rounded-full px-3 text-muted-foreground" onClick={handleSkip} data-testid="button-skip-mfa-nudge">
            <X className="w-3.5 h-3.5 mr-1" /> {t("mfaNudgeBanner.skipForNow")}
          </Button>
          {/* Outline, not filled — a nudge shouldn't outrank the page's own
              primary action. */}
          <Button asChild variant="outline" size="sm" className="h-9 rounded-full px-4 border-primary/40 text-foreground hover:bg-primary/10">
            <Link href="/account/security" data-testid="button-setup-mfa-nudge">
              {t("mfaNudgeBanner.setUpNow")}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
