import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { Logo } from "@/components/ui/logo";

// How long the pulse needs to actually finish: the arcs fire across the
// first ~0.6s (see logo-wave's keyframe timing), staggered 0.15s apart, and
// the last one completes its single cycle at 0.3s (its own delay) + 1.7s
// (one full logo-wave-once cycle) = 2.0s.
const PULSE_DURATION_MS = 2000;

/**
 * The moment a whisp finishes sending: the mark pulses through its arcs
 * once, then hands off to a settled checkmark — doubling as the actual
 * "yes, it sent" confirmation rather than a decorative flourish shown
 * alongside a separate success indicator. Mount this once, when the send
 * actually succeeds (not before); it runs on mount and doesn't need props
 * to control timing.
 */
export function WhispSentConfirmation() {
  const [pulsed, setPulsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setPulsed(true), PULSE_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative h-32 flex items-center justify-center" role="status">
      <span className="sr-only">Your whisp has been sent</span>
      <AnimatePresence mode="wait">
        {!pulsed ? (
          <motion.div
            key="pulse"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.15 }}
            transition={{ duration: 0.3 }}
          >
            <Logo waveOnce className="h-24 w-auto text-primary" aria-hidden />
          </motion.div>
        ) : (
          <motion.div
            key="settled"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center glow-card"
          >
            <Check className="w-10 h-10 text-primary" aria-hidden />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
