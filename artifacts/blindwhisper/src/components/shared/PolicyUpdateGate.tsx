import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMyPolicyStatus, useAcceptPolicies, getGetMyPolicyStatusQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, ExternalLink, Loader2, Check } from "lucide-react";

// Polls at a relaxed cadence — the prompt appearing within a few minutes of
// an admin hitting Publish satisfies "while they're on the app", and every
// refresh/next-login fetches immediately anyway.
const POLICY_POLL_MS = 5 * 60 * 1000;

const DOC_ROUTES: Record<string, string> = {
  privacy: "/privacy",
  terms: "/terms",
};

// The re-consent prompt for published policy updates (see api-server's
// policy_versions.ts). Mounted once in AppLayout, so it covers every
// signed-in surface: the dialog opens as soon as a pending update is seen —
// live mid-session via the poll, or immediately on refresh/next sign-in.
// "Review later" closes the dialog for this page-view but leaves the
// ambient pulsing reminder pinned at the bottom of the screen (the
// eye-catcher), which reopens it — and the dialog returns on the next
// refresh regardless. Agreement is recorded per user per version.
export function PolicyUpdateGate() {
  const { t } = useTranslation("sharedA");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useGetMyPolicyStatus({
    query: { refetchInterval: POLICY_POLL_MS, refetchOnWindowFocus: true },
  } as any);
  const accept = useAcceptPolicies();
  const [dismissed, setDismissed] = useState(false);

  const pending = data?.pending ?? [];

  // A newly-arriving update (mid-session publish) reopens the dialog even
  // if an earlier one was dismissed — it's a different thing to agree to.
  const pendingKey = pending.map((p) => p.id).sort().join(",");
  useEffect(() => {
    setDismissed(false);
  }, [pendingKey]);

  if (pending.length === 0) return null;

  function handleAgree() {
    accept.mutate(
      { data: { policyVersionIds: pending.map((p) => p.id) } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMyPolicyStatusQueryKey() });
          toast({ title: t("policyUpdate.toastThanks") });
        },
        onError: () => toast({ title: t("policyUpdate.toastError"), variant: "destructive" }),
      },
    );
  }

  return (
    <>
      <Dialog open={!dismissed} onOpenChange={(open) => !open && setDismissed(true)}>
        <DialogContent className="max-w-md" data-testid="dialog-policy-update">
          <DialogHeader>
            <div className="mx-auto policy-pulse rounded-full p-3 bg-destructive/10 text-destructive w-fit" aria-hidden="true">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <DialogTitle className="text-center">{t("policyUpdate.heading")}</DialogTitle>
            <DialogDescription className="text-center">{t("policyUpdate.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {pending.map((p) => (
              <div key={p.id} className="rounded-2xl border border-border/50 bg-card/50 p-4 space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {p.docType === "privacy" ? t("policyUpdate.privacyLabel") : t("policyUpdate.termsLabel")}
                </p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{p.summary}</p>
                <a
                  href={DOC_ROUTES[p.docType] ?? "/terms"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("policyUpdate.readLink")} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:flex-col">
            <Button
              className="rounded-full w-full"
              onClick={handleAgree}
              disabled={accept.isPending}
              data-testid="button-agree-policies"
            >
              {accept.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {t("policyUpdate.agreeButton")}
            </Button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
              data-testid="button-policy-later"
            >
              {t("policyUpdate.laterButton")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The ambient reminder while dismissed — deliberately impossible to
          not notice, per product ask: a pinned pill breathing red until
          agreement happens. */}
      {dismissed && (
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="policy-pulse fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-destructive text-destructive-foreground text-xs font-medium shadow-lg"
          data-testid="button-policy-reminder"
        >
          <ShieldAlert className="w-3.5 h-3.5" /> {t("policyUpdate.reminderPill")}
        </button>
      )}
    </>
  );
}
