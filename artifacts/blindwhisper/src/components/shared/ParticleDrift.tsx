import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

// Same palette VideoPlayer.tsx's "clicked" celebration burst uses (see its
// handlePlayClick) — kept consistent across the app's two confetti moments
// rather than introducing a second, different palette.
const CONFETTI_COLORS = ["#7B61FF", "#FF7B7B", "#a78bfa", "#F5F0E8"];

/**
 * The send-confirmation signature moment. Uses canvas-confetti (already a
 * dependency, already used for VideoPlayer.tsx's watch celebration)
 * instead of hand-rolled Framer Motion orbs — gravity gives it a real
 * upward launch that arcs and falls naturally, rather than particles that
 * only ever drifted up and faded to nothing. One-shot, fires once on
 * mount; canvas-confetti draws its own full-viewport overlay canvas, so
 * this still renders the same-height placeholder box the reduced-motion
 * branch uses, purely to preserve the surrounding layout's spacing.
 */
export function ParticleDrift({ className }: { className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const firedRef = useRef(false);

  useEffect(() => {
    if (reducedMotion || firedRef.current) return;
    firedRef.current = true;
    confetti({
      particleCount: 90,
      spread: 100,
      startVelocity: 40,
      gravity: 0.9,
      ticks: 260,
      origin: { x: 0.5, y: 0.45 },
      colors: CONFETTI_COLORS,
      disableForReducedMotion: true,
    });
  }, [reducedMotion]);

  return (
    <div className={`relative h-32 flex items-center justify-center pointer-events-none ${className ?? ""}`}>
      {reducedMotion && (
        <motion.div
          className="w-3 h-3 rounded-full bg-primary"
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
    </div>
  );
}
