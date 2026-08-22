import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import confetti from "canvas-confetti";
import { Send, Sparkles } from "lucide-react";
import { Logo } from "@/components/ui/logo";

// The Text Whisp "fold/unfurl" moment — the one deliberately crafted visual
// in this feature (see routes/textWhisps.ts for the plumbing). Used two
// ways from the same component so the send and open experiences feel like
// mirror images of each other:
//
//   mode="send" — after POST /text-whisps succeeds, the composed message
//   visually rolls itself up into a small tied scroll and confirms "Sent!".
//
//   mode="open" — the recipient sees a closed, tied scroll; tapping the bow
//   fires the confetti burst and reveals the message immediately (the click
//   handler does both synchronously — no setTimeout gating either one), and
//   the parchment card itself unrolls into view as a fast CSS transition
//   starting on the very next frame. That distinction matters: an earlier
//   version staged confetti behind a multi-hundred-ms untie-then-unroll
//   sequence, which read as a stall before the payoff rather than part of
//   it. Now nothing is gated behind the animation — the animation is just
//   the card's own reveal, playing alongside a confetti burst that already
//   fired.
//
// Deliberately plain CSS transitions/keyframes (no animation library) —
// consistent with this app's existing lightweight-dependency approach.
// Every phase uses the SVG `pathLength={1}` trick so stroke-dasharray/
// dashoffset math stays "0 to 1" regardless of the bow path's real length.

type SendPhase = "flat" | "rolling" | "tying" | "sent";
type OpenPhase = "closed" | "open";

const ROLL_MS = 550;
const TIE_MS = 450;
// How long the parchment card takes to unroll from a thin roll to full
// width once opened. Purely a mount-triggered CSS transition (see
// cardRevealed below) — it never delays the confetti or the message text
// itself, both of which are already on screen the instant this starts.
const CARD_UNROLL_MS = 500;

// Matches .logo-wave-twice's own 1.7s cycle in index.css, played twice, plus
// a buffer for the third arc's own 0.3s --wave-delay so the fade-out timer
// never cuts off the last arc mid-pulse.
const WAVE_CYCLE_MS = 1700;
const WAVE_ARC_MAX_DELAY_MS = 300;

// A little rope/bow, drawn as two loops crossed by a knot line. pathLength
// normalizes each element's own stroke-dasharray/dashoffset math to [0, 1]
// regardless of its real geometry, so "tied" vs "untied" is just dashoffset
// 0 vs 1 — no manual getTotalLength() bookkeeping needed.
function BowSvg({ progress, className }: { progress: number; className?: string }) {
  // progress: 0 = fully untied (invisible), 1 = fully tied (drawn in).
  const dash = 1 - progress;
  return (
    <svg viewBox="0 0 64 28" className={className} aria-hidden="true">
      <path
        d="M32 14 C 22 2, 4 4, 6 14 C 4 24, 22 26, 32 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: dash, transition: `stroke-dashoffset ${TIE_MS}ms ease` }}
      />
      <path
        d="M32 14 C 42 2, 60 4, 58 14 C 60 24, 42 26, 32 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: dash, transition: `stroke-dashoffset ${TIE_MS}ms ease ${TIE_MS * 0.15}ms` }}
      />
      <circle
        cx="32"
        cy="14"
        r="3.5"
        fill="currentColor"
        style={{ opacity: progress, transition: `opacity ${TIE_MS * 0.6}ms ease ${TIE_MS * 0.4}ms` }}
      />
    </svg>
  );
}

// The rolled-up cylinder — a horizontal pill with rounded "paper edge" caps.
// Its own scaleX is what animates between "flat sheet" and "tight roll".
function ScrollCylinder({ className }: { className?: string }) {
  return (
    <div className={`relative h-10 rounded-full ${className ?? ""}`}>
      <div className="absolute inset-0 rounded-full bg-[hsl(38_38%_82%)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.25),0_2px_10px_rgba(0,0,0,0.35)]" />
      <div className="absolute left-1 top-1 bottom-1 w-2 rounded-full bg-[hsl(38_45%_92%)]/80" />
      <div className="absolute right-1 top-1 bottom-1 w-2 rounded-full bg-[hsl(38_45%_92%)]/80" />
    </div>
  );
}

function formatWhen(when: string | Date | null | undefined): string {
  if (!when) return "";
  return new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface TextWhispScrollProps {
  mode: "send" | "open";
  messageText: string;
  senderAlias?: string | null;
  createdAt?: string | Date | null;
  /** send mode only — auto-plays the roll/tie sequence on mount. Default true. */
  autoPlay?: boolean;
  /** send mode only — fires once the "Sent!" end state is reached. */
  onSendAnimationComplete?: () => void;
  /** open mode only — fires once the scroll is fully unrolled and the message is visible. */
  onOpened?: () => void;
  /** open mode only — skip the closed/tied state entirely and render already
   *  unrolled. Used for the sender's own view of a Text Whisp they sent —
   *  there's no "moment" to unwrap for the person who wrote it. */
  initiallyOpen?: boolean;
  className?: string;
}

export function TextWhispScroll({
  mode,
  messageText,
  senderAlias,
  createdAt,
  autoPlay = true,
  onSendAnimationComplete,
  onOpened,
  initiallyOpen = false,
  className,
}: TextWhispScrollProps) {
  const { t } = useTranslation("sharedB");
  const [sendPhase, setSendPhase] = useState<SendPhase>("flat");
  const [logoWaveDone, setLogoWaveDone] = useState(false);
  const [openPhase, setOpenPhase] = useState<OpenPhase>(initiallyOpen ? "open" : "closed");
  // Starts the card's unroll transition (scaleX 0.12 → 1) already true when
  // the sender's own view mounts pre-opened (initiallyOpen) — there's no
  // "reveal" for the person who wrote it, so it should just render flat, not
  // animate from rolled every time they revisit their own sent message.
  const [cardRevealed, setCardRevealed] = useState(initiallyOpen);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (openPhase !== "open" || cardRevealed) return;
    // One frame, not a setTimeout — this is what lets the CSS transition
    // below actually transition (mounting already-at-scaleX-1 wouldn't
    // animate anything) without introducing any perceptible gap: the
    // confetti and the message text both already rendered synchronously in
    // handleUntie, before this even runs.
    const raf = requestAnimationFrame(() => setCardRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, [openPhase, cardRevealed]);

  useEffect(() => {
    if (mode !== "send" || !autoPlay) return;
    // Beat 1: hold the flat sheet for a breath so the sender registers what
    // they just sent, then roll → tie → confirm. Each setTimeout chains off
    // the previous phase's own duration (see ROLL_MS/TIE_MS above).
    timers.current.push(setTimeout(() => setSendPhase("rolling"), 250));
    timers.current.push(setTimeout(() => setSendPhase("tying"), 250 + ROLL_MS));
    timers.current.push(
      setTimeout(() => {
        setSendPhase("sent");
        onSendAnimationComplete?.();
        // The logo mounts fresh right here (see the conditional render
        // below) rather than sitting in the DOM the whole time with its
        // opacity toggled — mounting is what makes its CSS wave animation
        // actually start now instead of back at component-mount time, which
        // used to run the pulse to completion while the mark was still
        // hidden behind opacity:0. Fading it back out is scheduled the same
        // way: relative to this moment, not to mount.
        timers.current.push(
          setTimeout(() => setLogoWaveDone(true), 2 * WAVE_CYCLE_MS + WAVE_ARC_MAX_DELAY_MS),
        );
      }, 250 + ROLL_MS + TIE_MS),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoPlay]);

  function handleUntie(e: React.MouseEvent<HTMLButtonElement>) {
    if (openPhase !== "closed") return;
    // Captured now, before the state update swaps the button out for the
    // parchment card in this same tick — by the next render there's no
    // currentTarget left to read a position from.
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenPhase("open");
    // The reveal payoff — same brand-colored burst as PublicInvitePage's own
    // celebratory moment, fired synchronously with the tap rather than after
    // an untie/unroll animation plays out, so there's no gap between
    // "clicked" and "confetti + message."
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
    onOpened?.();
  }

  if (mode === "send") {
    const rolled = sendPhase === "rolling" || sendPhase === "tying" || sendPhase === "sent";
    const tied = sendPhase === "tying" || sendPhase === "sent";
    return (
      <div className={`flex flex-col items-center gap-4 ${className ?? ""}`} data-testid="text-whisp-send-scroll">
        <div className="relative w-full max-w-sm h-32 flex items-center justify-center">
          {/* The flat parchment sheet, scaling down to a thin roll. transform-origin
              stays centered so it reads as "rolling inward" from both edges. */}
          <div
            className="absolute inset-x-0 rounded-2xl bg-[hsl(38_42%_88%)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] p-4 flex items-center justify-center overflow-hidden"
            style={{
              height: rolled ? "2.5rem" : "8rem",
              transform: `scaleX(${rolled ? 0.12 : 1})`,
              opacity: rolled ? 0 : 1,
              transition: `transform ${ROLL_MS}ms cubic-bezier(0.4,0,0.2,1), height ${ROLL_MS}ms ease, opacity ${ROLL_MS * 0.7}ms ease ${ROLL_MS * 0.3}ms`,
            }}
          >
            <p className="font-serif text-[hsl(30_35%_20%)] text-sm text-center line-clamp-4">{messageText}</p>
          </div>

          <div
            className="absolute inset-x-8"
            style={{
              opacity: rolled ? 1 : 0,
              transform: `scale(${rolled ? 1 : 0.6})`,
              transition: `opacity ${ROLL_MS * 0.6}ms ease ${ROLL_MS * 0.5}ms, transform ${ROLL_MS * 0.6}ms ease ${ROLL_MS * 0.5}ms`,
            }}
          >
            <ScrollCylinder />
            {/* Centered on the cylinder itself (top-1/2 + -translate-y-1/2),
                not offset above it — a "-top-2" nudge here used to leave the
                knot noticeably off-center inside the frame. */}
            <BowSvg progress={tied ? 1 : 0} className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-8 w-full text-primary" />
          </div>
        </div>

        <div
          className="flex items-center gap-2 text-primary font-medium"
          style={{ opacity: sendPhase === "sent" ? 1 : 0, transition: "opacity 300ms ease" }}
          data-testid="text-whisp-sent-confirmation"
        >
          <Send className="w-4 h-4" />
          <span>{t("textWhispScroll.sent")}</span>
          <Sparkles className="w-3.5 h-3.5" />
        </div>

        {/* The same mark-pulse payoff WhispSentConfirmation gives the video-whisp
            send flow, reused here as the scroll's own last beat — mounted only
            once "Sent!" appears (not hidden-but-present earlier) so its two
            wave pulses are actually visible instead of finishing off-screen,
            then fades away smoothly once they're done. */}
        {sendPhase === "sent" && (
          <div style={{ opacity: logoWaveDone ? 0 : 1, transition: "opacity 600ms ease" }} aria-hidden="true">
            <Logo waveTwice className="h-16 w-auto text-primary" />
          </div>
        )}
      </div>
    );
  }

  // mode === "open" — a plain two-state swap, button or card, never both:
  // no shared "stage" box and no transition between them, since there's
  // nothing left to overlap or animate once the reveal is instant.
  const opened = openPhase === "open";

  return (
    <div className={`flex flex-col items-center gap-5 ${className ?? ""}`} data-testid="text-whisp-open-scroll">
      {!opened ? (
        <button
          type="button"
          onClick={handleUntie}
          className="relative w-full max-w-sm h-28 flex items-center justify-center group"
          data-testid="button-untie-scroll"
          aria-label={t("textWhispScroll.tapToOpenAriaLabel")}
        >
          <div className="relative w-40">
            <ScrollCylinder className="transition-transform group-hover:scale-[1.03] group-active:scale-95" />
            <BowSvg progress={1} className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-8 w-full text-primary" />
          </div>
          <span className="absolute -bottom-6 text-xs text-muted-foreground">{t("textWhispScroll.tapTheBowToOpen")}</span>
        </button>
      ) : (
        <div
          // scaleX-from-a-thin-roll, same technique (and easing) the send-mode
          // sheet above uses — but here it's a pure mount transition (see
          // cardRevealed), never something the confetti or the message text
          // waits behind. overflow-hidden keeps the squished text from
          // visibly spilling past the edges during the brief thin phase.
          className="relative w-full max-w-sm rounded-2xl bg-gradient-to-b from-[hsl(38_48%_94%)] via-[hsl(38_42%_88%)] to-[hsl(38_35%_82%)] shadow-[0_8px_28px_rgba(0,0,0,0.4)] p-5 overflow-hidden"
          style={{
            transform: `scaleX(${cardRevealed ? 1 : 0.12})`,
            transition: `transform ${CARD_UNROLL_MS}ms cubic-bezier(0.16,1,0.3,1)`,
          }}
          data-testid="text-whisp-parchment-card"
        >
          {/* Rolled-paper edge highlights, top and bottom — the same pale
              paper-edge tone ScrollCylinder's own caps use on the closed
              scroll, so the unrolled card still reads as the same physical
              piece of parchment rather than a plain card that happens to
              hold the message. */}
          <div className="absolute inset-x-0 top-0 h-2 bg-[hsl(38_50%_95%)]/70" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 h-2 bg-[hsl(38_30%_76%)]/60" aria-hidden="true" />
          <p className="relative font-serif text-[hsl(30_35%_20%)] text-base leading-relaxed whitespace-pre-wrap">{messageText}</p>
          <div className="relative mt-3 pt-3 border-t border-[hsl(35_25%_65%)] flex items-center justify-between text-xs text-[hsl(30_20%_38%)]">
            <span>— {senderAlias?.trim() || t("textWhispScroll.someoneAnonymous")}</span>
            {createdAt && <span>{formatWhen(createdAt)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
