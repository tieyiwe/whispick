import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Logo } from "@/components/ui/logo";

// How long the fading dots show before handing off to the logo pulse —
// long enough to read as "sending", short enough not to feel like a delay
// now that it's purely decorative (the send itself already finished by the
// time this mounts).
const DOTS_DURATION_MS = 900;

const DOT_INDEXES = [0, 1, 2];

function SendingDots() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {DOT_INDEXES.map((i) => (
        <motion.span
          key={i}
          className="h-3 w-3 rounded-full bg-primary"
          animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1, 0.8] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/**
 * The moment a whisp finishes sending: the same fading "sending…" dots that
 * used to run alone now hand off to the mark pulsing through its arcs once
 * — that pulse doubles as the actual "yes, it sent" confirmation, so it's
 * the sequence's last beat rather than a decorative flourish shown
 * alongside a separate success indicator. Mount this once, when the send
 * actually succeeds (not before); it runs on mount and doesn't need props
 * to control timing.
 */
export function WhispSentConfirmation() {
  const [phase, setPhase] = useState<"dots" | "pulse">("dots");

  useEffect(() => {
    const timer = setTimeout(() => setPhase("pulse"), DOTS_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative h-32 flex items-center justify-center" role="status">
      <span className="sr-only">Your whisp has been sent</span>
      <AnimatePresence mode="wait">
        {phase === "dots" ? (
          <motion.div
            key="dots"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <SendingDots />
          </motion.div>
        ) : (
          <motion.div
            key="pulse"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Logo waveOnce className="h-24 w-auto text-primary" aria-hidden />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
