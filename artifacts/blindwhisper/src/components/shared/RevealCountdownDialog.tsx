import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Shared confirm-with-a-countdown step for every "Reveal Yourself" button in
 * the app (a whisp sender on WhispDetail.tsx, a Text Whisp sender on
 * TextWhispDetail.tsx, an inviter on InvitePage.tsx) — clicking Reveal no
 * longer fires the request immediately. Instead this opens, ticks down from
 * `seconds`, and only calls `onConfirm` (the page's own existing
 * requestReveal.mutate() call, unchanged) once it hits 0 — a last chance to
 * back out of something that can't be undone once the other party sees it.
 *
 * Dismissing ANY way — the Stop button, Escape, clicking outside — cancels
 * safely: the countdown is just a timer that hasn't fired yet, nothing on
 * the server has happened at any point before onConfirm actually runs, so
 * there's nothing to "undo." That symmetry is what keeps this component
 * simple: every close path routes through the same handleCancel.
 *
 * All three reveal endpoints (POST /whisps/:id/reveal, /text-whisps/:id/reveal,
 * /invites/:id/reveal) are a single idempotent "set revealRequested=true +
 * notify the other party" — delaying the call client-side has no server-side
 * side effect to account for.
 */
export function RevealCountdownDialog({
  open,
  onOpenChange,
  onConfirm,
  seconds = 20,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called exactly once, when the countdown reaches 0 — the page's own
   *  existing reveal mutation, invoked here instead of on click. */
  onConfirm: () => void;
  /** How long the countdown runs before firing. 20-30s per product ask —
   *  defaults to the lower end so the pause reads as deliberate without
   *  becoming tedious for someone who's already sure. */
  seconds?: number;
}) {
  const { t } = useTranslation("sharedB");
  const [remaining, setRemaining] = useState(seconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clear() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    if (!open) {
      clear();
      return;
    }
    setRemaining(seconds);
    timerRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          clear();
          onConfirm();
          onOpenChange(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return clear;
    // Deliberately re-armed only by `open` toggling, not by onConfirm/
    // onOpenChange identity — a parent re-render passing new (but
    // behaviorally identical) callback props must not restart the countdown
    // a viewer is already watching tick down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seconds]);

  function handleCancel() {
    clear();
    onOpenChange(false);
  }

  const progress = (seconds - remaining) / seconds;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? handleCancel() : undefined)}>
      <DialogContent className="sm:max-w-sm text-center">
        <DialogHeader>
          <DialogTitle className="text-center flex items-center justify-center gap-1.5">
            <Eye className="w-4 h-4 text-primary" /> {t("revealCountdownDialog.title")}
          </DialogTitle>
          <DialogDescription className="text-center">{t("revealCountdownDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="py-2 flex flex-col items-center gap-4">
          <div className="relative w-24 h-24 flex items-center justify-center" data-testid="reveal-countdown-ring">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>
            <span className="text-3xl font-serif font-bold text-foreground tabular-nums" data-testid="text-reveal-countdown-seconds">
              {remaining}
            </span>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="text-reveal-countdown-message">
            {t("revealCountdownDialog.message", { seconds: remaining })}
          </p>
        </div>

        <Button variant="outline" className="w-full rounded-full" onClick={handleCancel} data-testid="button-stop-reveal">
          {t("revealCountdownDialog.stopButton")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
