import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUser } from "@clerk/react";
import { useReportContent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Flag, Loader2 } from "lucide-react";

// Mirrors routes/contentReports.ts's REPORT_REASONS — the ORDER here is the
// display order (everyday reasons first, rarer/graver ones after), while the
// backend derives each one's triage priority independently, so re-ordering
// this list is purely cosmetic. The translation keys resolve against
// debateTopics.json's reportDialog.reasons.*.
const REASONS = [
  "inappropriate",
  "sexual_content",
  "harassment",
  "hate_speech",
  "threat_or_violence",
  "child_safety",
  "self_harm",
  "misinformation",
  "spam_or_scam",
  "other",
] as const;
type Reason = (typeof REASONS)[number];

// Matches MAX_DETAIL_WORDS server-side (routes/contentReports.ts) — words,
// not characters, per the product spec for this box.
const MAX_DETAIL_WORDS = 300;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// The community "flag this" affordance on Debate Now topics and comments.
// Renders its own trigger (a small flag button) plus the dialog: reason
// picker, optional detail box capped at 300 words, and a pointer to the
// Community Guidelines. Signed-out viewers get a sign-in prompt instead of
// the form — reporting requires an account because the admin team's
// resolution is delivered back to the reporter as an in-app notification
// (see routes/contentReports.ts).
export function ReportContentDialog({
  contentType,
  contentId,
  compact = false,
}: {
  contentType: "debate_topic" | "debate_topic_comment";
  contentId: string;
  /** Text-link-sized trigger for comment action rows; pill button otherwise. */
  compact?: boolean;
}) {
  const { t } = useTranslation("debateTopics");
  const { toast } = useToast();
  const { isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [detail, setDetail] = useState("");
  const report = useReportContent();

  const words = countWords(detail);
  const overLimit = words > MAX_DETAIL_WORDS;
  const canSubmit = !!reason && !overLimit && !report.isPending;

  function resetAndClose() {
    setOpen(false);
    setReason(null);
    setDetail("");
  }

  function handleSubmit() {
    if (!reason) return;
    report.mutate(
      { data: { contentType, contentId, reason, detail: detail.trim() || null } },
      {
        onSuccess: () => {
          resetAndClose();
          toast({ title: t("reportDialog.toastSubmittedTitle"), description: t("reportDialog.toastSubmittedDescription") });
        },
        onError: (err: any) => {
          // 409 = this user already has an open report on this content —
          // that's a "we heard you" situation, not a failure.
          if (err?.status === 409) {
            resetAndClose();
            toast({ title: t("reportDialog.toastAlreadyReported") });
            return;
          }
          toast({ title: err?.data?.error ?? t("reportDialog.toastFailed"), variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            data-testid={`button-report-${contentId}`}
            aria-label={t("reportDialog.triggerLabel")}
          >
            <Flag className="w-3.5 h-3.5" />
          </button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full h-7 px-2.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            data-testid={`button-report-${contentId}`}
          >
            <Flag className="w-3.5 h-3.5 mr-1.5" /> {t("reportDialog.triggerLabel")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        {!isSignedIn ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("reportDialog.title")}</DialogTitle>
              <DialogDescription>{t("reportDialog.signInPrompt")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="rounded-full" onClick={resetAndClose}>
                {t("reportDialog.cancelButton")}
              </Button>
              <a href="/sign-in">
                <Button className="rounded-full w-full">{t("reportDialog.signInButton")}</Button>
              </a>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("reportDialog.title")}</DialogTitle>
              <DialogDescription>{t("reportDialog.description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{t("reportDialog.reasonLabel")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {REASONS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setReason(key)}
                      data-testid={`report-reason-${key}`}
                      aria-pressed={reason === key}
                      className={`p-2 rounded-xl text-xs text-left border transition-all ${
                        reason === key
                          ? "border-destructive bg-destructive/10 text-foreground"
                          : "border-border/50 text-muted-foreground hover:border-border"
                      }`}
                    >
                      {t(`reportDialog.reasons.${key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">{t("reportDialog.detailLabel")}</p>
                <Textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder={t("reportDialog.detailPlaceholder")}
                  rows={4}
                  className="bg-input/50 border-border/50 rounded-xl resize-none"
                  data-testid="textarea-report-detail"
                />
                <p className={`text-xs text-right ${overLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {t("reportDialog.wordCount", { used: words, max: MAX_DETAIL_WORDS })}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("reportDialog.guidelinesPrefix")}{" "}
                <a href="/community-guidelines" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {t("reportDialog.guidelinesLinkText")}
                </a>
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" className="rounded-full" onClick={resetAndClose}>
                {t("reportDialog.cancelButton")}
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                disabled={!canSubmit}
                onClick={handleSubmit}
                data-testid="button-submit-report"
              >
                {report.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Flag className="w-4 h-4 mr-2" />}
                {t("reportDialog.submitButton")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
