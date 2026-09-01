import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Eye, CheckCircle2, XCircle } from "lucide-react";

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// How long the result (aborted or revealed) sits inside the dialog itself
// before it closes on its own — long enough to register as a deliberate
// confirmation, short enough that nobody has to act to dismiss it. This
// replaced a corner toast for the same message: a toast is easy to miss
// since attention is already on the dialog, while showing the result in the
// exact spot the countdown was just occupying can't be missed.
const RESULT_DISPLAY_MS = 1000;

type Phase = "counting" | "aborted" | "revealed";

// Three zones instead of one flat primary-colored ring, so the ring itself
// communicates urgency without anyone having to read the number: calm green
// for the first half, gilded yellow as it gets closer, destructive red (with
// the app's existing danger pulse) for the final stretch where backing out
// is still possible but not for much longer. Both --success and --gilded
// are already tuned as violet's complements (see index.css), so the zones
// read as part of the same palette rather than a stock red/yellow/green.
const GREEN_UNTIL = 0.5;
const YELLOW_UNTIL = 0.75;

function ringColorVar(progress: number): string {
  if (progress < GREEN_UNTIL) return "--success";
  if (progress < YELLOW_UNTIL) return "--gilded";
  return "--destructive";
}

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
  const [phase, setPhase] = useState<Phase>("counting");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clear() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (!open) {
      clear();
      clearCloseTimer();
      return;
    }
    setPhase("counting");
    setRemaining(seconds);
    timerRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          clear();
          // Fired the moment it hits 0, same as before — only the dialog's
          // own close is delayed, never the actual reveal request.
          onConfirm();
          setPhase("revealed");
          closeTimerRef.current = setTimeout(() => onOpenChange(false), RESULT_DISPLAY_MS);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      clear();
      clearCloseTimer();
    };
    // Deliberately re-armed only by `open` toggling, not by onConfirm/
    // onOpenChange identity — a parent re-render passing new (but
    // behaviorally identical) callback props must not restart the countdown
    // a viewer is already watching tick down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seconds]);

  function handleCancel() {
    // Already resolving (revealed just fired, or a previous cancel already
    // did) — the pending closeTimerRef will finish the job; a second Escape
    // or outside-click here shouldn't restart or double-schedule anything.
    if (phase !== "counting") return;
    clear();
    setPhase("aborted");
    closeTimerRef.current = setTimeout(() => onOpenChange(false), RESULT_DISPLAY_MS);
  }

  const progress = (seconds - remaining) / seconds;
  const ringColor = `hsl(var(${ringColorVar(progress)}))`;
  const inDangerZone = phase === "counting" && progress >= YELLOW_UNTIL;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? handleCancel() : undefined)}>
      <DialogContent className="sm:max-w-sm text-center">
        <DialogHeader>
          <DialogTitle className="text-center flex items-center justify-center gap-1.5">
            {phase === "counting" && (
              <>
                <Eye className="w-4 h-4 text-primary" /> {t("revealCountdownDialog.title")}
              </>
            )}
            {phase === "aborted" && t("revealCountdownDialog.abortedMessage")}
            {phase === "revealed" && t("revealCountdownDialog.revealedMessage")}
          </DialogTitle>
          {phase === "counting" && (
            <DialogDescription className="text-center">{t("revealCountdownDialog.description")}</DialogDescription>
          )}
        </DialogHeader>

        <div className="py-2 flex flex-col items-center gap-4">
          <div
            className={`relative w-24 h-24 rounded-full flex items-center justify-center ${inDangerZone ? "policy-pulse" : ""}`}
            data-testid="reveal-countdown-ring"
          >
            {phase === "counting" ? (
              <>
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
                  <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
                  <circle
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
                    style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s ease" }}
                  />
                </svg>
                <span className="text-3xl font-serif font-bold text-foreground tabular-nums" data-testid="text-reveal-countdown-seconds">
                  {remaining}
                </span>
              </>
            ) : phase === "aborted" ? (
              <XCircle className="w-12 h-12 text-muted-foreground" aria-hidden data-testid="reveal-aborted-icon" />
            ) : (
              <CheckCircle2
                className="w-12 h-12"
                style={{ color: "hsl(var(--success))" }}
                aria-hidden
                data-testid="reveal-confirmed-icon"
              />
            )}
          </div>
          {phase === "counting" && (
            <p className="text-sm text-muted-foreground" data-testid="text-reveal-countdown-message">
              {t("revealCountdownDialog.message", { seconds: remaining })}
            </p>
          )}
        </div>

        {phase === "counting" && (
          <Button variant="outline" className="w-full rounded-full" onClick={handleCancel} data-testid="button-stop-reveal">
            {t("revealCountdownDialog.stopButton")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
