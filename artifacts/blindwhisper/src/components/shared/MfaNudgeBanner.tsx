import { useState } from "react";
import { Link } from "wouter";
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
    <Card className="bg-primary/5 border-primary/20" data-testid="card-mfa-nudge">
      <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Set up two-factor authentication for extra security</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add a second step to sign-in so your account stays protected even if your password leaks.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={handleSkip} data-testid="button-skip-mfa-nudge">
            <X className="w-3.5 h-3.5 mr-1" /> Skip for now
          </Button>
          <Link href="/account/security">
            <Button size="sm" className="rounded-full" data-testid="button-setup-mfa-nudge">
              Set up now
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
