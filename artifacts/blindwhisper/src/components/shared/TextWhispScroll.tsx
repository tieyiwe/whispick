import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Sparkles } from "lucide-react";

// The Text Whisp "fold/unfurl" moment — the one deliberately crafted visual
// in this feature (see routes/textWhisps.ts for the plumbing). Used two
// ways from the same component so the send and open experiences feel like
// mirror images of each other:
//
//   mode="send" — after POST /text-whisps succeeds, the composed message
//   visually rolls itself up into a small tied scroll and confirms "Sent!".
//
//   mode="open" — the recipient sees a closed, tied scroll; tapping the bow
//   unties it, the scroll unrolls, and the message fades in on a warm
//   parchment card underneath.
//
// Deliberately plain CSS transitions/keyframes (no animation library) —
// consistent with this app's existing lightweight-dependency approach.
// Every phase uses the SVG `pathLength={1}` trick so stroke-dasharray/
// dashoffset math stays "0 to 1" regardless of the bow path's real length.

type SendPhase = "flat" | "rolling" | "tying" | "sent";
type OpenPhase = "closed" | "untying" | "unrolling" | "open";

const ROLL_MS = 550;
const TIE_MS = 450;
const UNROLL_MS = 600;

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
  const [openPhase, setOpenPhase] = useState<OpenPhase>(initiallyOpen ? "open" : "closed");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

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
      }, 250 + ROLL_MS + TIE_MS),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoPlay]);

  function handleUntie() {
    if (openPhase !== "closed") return;
    setOpenPhase("untying");
    timers.current.push(setTimeout(() => setOpenPhase("unrolling"), TIE_MS));
    timers.current.push(
      setTimeout(() => {
        setOpenPhase("open");
        onOpened?.();
      }, TIE_MS + UNROLL_MS),
    );
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
            <BowSvg progress={tied ? 1 : 0} className="absolute inset-x-0 -top-2 h-8 w-full text-primary" />
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
      </div>
    );
  }

  // mode === "open"
  const untied = openPhase === "untying" || openPhase === "unrolling" || openPhase === "open";
  const unrolled = openPhase === "unrolling" || openPhase === "open";
  const opened = openPhase === "open";

  return (
    <div className={`flex flex-col items-center gap-5 ${className ?? ""}`} data-testid="text-whisp-open-scroll">
      {!opened && (
        <button
          type="button"
          onClick={handleUntie}
          disabled={openPhase !== "closed"}
          className="relative w-full max-w-sm h-28 flex items-center justify-center group"
          data-testid="button-untie-scroll"
          aria-label={t("textWhispScroll.tapToOpenAriaLabel")}
        >
          <div
            className="w-40"
            style={{
              opacity: unrolled ? 0 : 1,
              transform: `scale(${openPhase === "closed" ? 1 : 0.9})`,
              transition: `opacity ${UNROLL_MS * 0.4}ms ease, transform ${TIE_MS}ms ease`,
            }}
          >
            <ScrollCylinder className="transition-transform group-hover:scale-[1.03] group-active:scale-95" />
            <BowSvg progress={untied ? 0 : 1} className="absolute inset-x-0 -top-2 h-8 w-full text-primary mx-auto left-1/2 -translate-x-1/2" />
          </div>
          {openPhase === "closed" && (
            <span className="absolute -bottom-6 text-xs text-muted-foreground">{t("textWhispScroll.tapTheBowToOpen")}</span>
          )}
        </button>
      )}

      {/* The unrolling sheet + revealed message — starts as the same thin
          roll, scales back out to full width, and the parchment message
          card fades in once it's flat again. */}
      {unrolled && (
        <div
          className="relative w-full max-w-sm rounded-2xl bg-[hsl(38_42%_88%)] shadow-[0_8px_28px_rgba(0,0,0,0.4)] p-5"
          style={{
            transform: `scaleX(${opened ? 1 : 0.12})`,
            transition: `transform ${UNROLL_MS}ms cubic-bezier(0.16,1,0.3,1)`,
          }}
          data-testid="text-whisp-parchment-card"
        >
          <div
            style={{
              opacity: opened ? 1 : 0,
              transition: `opacity 400ms ease ${opened ? UNROLL_MS * 0.5 : 0}ms`,
            }}
          >
            <p className="font-serif text-[hsl(30_35%_20%)] text-base leading-relaxed whitespace-pre-wrap">{messageText}</p>
            <div className="mt-3 pt-3 border-t border-[hsl(35_25%_65%)] flex items-center justify-between text-xs text-[hsl(30_20%_38%)]">
              <span>— {senderAlias?.trim() || t("textWhispScroll.someoneAnonymous")}</span>
              {createdAt && <span>{formatWhen(createdAt)}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
